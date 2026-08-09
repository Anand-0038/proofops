import { PolicyEngine, type PolicyDecision, type ProposedAction } from "./PolicyEngine.js";
import { type DriftReport } from "../observe/DriftDetector.js";
import { ReadLayer, type ObservedState } from "../observe/ReadLayer.js";
import {
  KeeperHubClient,
  type ExecutionResult,
  type SimulationResult,
} from "../keeperhub/client.js";
import {
  applyPolicyToEvidence,
  createEmptyEvidence,
  deriveEvidenceMode,
  EvidenceStore,
  type EvidenceRecord,
} from "../evidence/EvidenceRecord.js";
import { fetchAuditTrail, mergeAuditIntoEvidenceFields } from "../keeperhub/auditTrail.js";
import { env } from "../config/env.js";
import { INCIDENT_ORACLE_ABI_JSON, serializeArgsForKeeperHub } from "../contracts/IncidentOracle.js";
import { verifyPostState } from "../observe/verifyPostState.js";
import {
  buildConditionalRunbookIntent,
  incidentConditionStillMet,
  INCIDENT_RUNBOOKS,
  runbookToAction,
  selectRunbook,
} from "./IncidentRunbooks.js";
import { ApprovalQueue } from "./ApprovalQueue.js";
import { loadDriftThresholds, loadPolicyConfig } from "../config/thresholds.js";
import { DriftDetector } from "../observe/DriftDetector.js";
import { randomUUID } from "node:crypto";
import { resolveIncidentById } from "../demo/routes.js";

export function buildCooldownIndex(
  records: EvidenceRecord[],
): Map<string, number> {
  const index = new Map<string, number>();
  for (const record of records) {
    if (record.status !== "confirmed") continue;
    if (!record.confirmedAt) continue;
    const action = record.selectedAction;
    if (!action) continue;

    const contract = action.contract?.trim().toLowerCase();
    const functionName = action.functionName?.trim().toLowerCase();
    if (!contract || !functionName) continue;

    const timestamp = Date.parse(record.confirmedAt);
    if (!Number.isFinite(timestamp)) continue;
    const key = `${contract}:${functionName}`;
    const previous = index.get(key) ?? 0;
    if (timestamp > previous) {
      index.set(key, timestamp);
    }
  }
  return index;
}

function resolveScenarioRunbook(
  contract: string,
  scenarioId?: string,
): {
  recognized: boolean;
  runbookId: keyof typeof INCIDENT_RUNBOOKS | null;
  action: ProposedAction | null;
} {
  if (!scenarioId) return { recognized: false, runbookId: null, action: null };
  const incident = resolveIncidentById(scenarioId);
  if (!incident) return { recognized: false, runbookId: null, action: null };
  if (incident.runbook === null) {
    return { recognized: true, runbookId: null, action: null };
  }

  const runbook = INCIDENT_RUNBOOKS[incident.runbook];
  const action = runbookToAction(runbook, {
    contract,
    severity: incident.severity,
    findings: [
      {
        code: `scenario.${incident.id}`,
        severity: incident.severity,
        message: incident.signal,
        observed: true,
        threshold: incident.signal,
      },
    ],
    heartbeatSeconds: incident.id === "oracle-stale" ? 3_600 : undefined,
    expectedMaxDeviationBps:
      incident.id === "parameter-drift" ? 100 : undefined,
  });
  return { recognized: true, runbookId: runbook.id, action };
}

export interface RunCycleOptions {
  execute?: boolean;
  triggerType?: EvidenceRecord["triggerType"];
  scenarioId?: string;
  approvalId?: string;
  /** Override proposed action (e.g. unsafe injection). */
  forceAction?: ProposedAction;
  readLayer?: ReadLayer;
  driftDetector?: DriftDetector;
  policyEngine?: PolicyEngine;
  keeperhub?: KeeperHubClient;
  evidenceStore?: EvidenceStore;
  approvalQueue?: ApprovalQueue;
  skipSimulate?: boolean;
  conditionalExecution?: boolean;
}

export interface RunCycleResult {
  evidence: EvidenceRecord;
  state: ObservedState;
  drift: DriftReport;
  policy: PolicyDecision | null;
  simulation: SimulationResult | null;
  execution: ExecutionResult | null;
}

/**
 * Detect → decide (+ optional simulate/execute).
 * With execute=false, no external state change occurs. Evidence and approval
 * queue records are still persisted locally.
 */
export async function runCycle(
  options: RunCycleOptions = {},
): Promise<RunCycleResult> {
  const readLayer = options.readLayer ?? new ReadLayer();
  const driftDetector =
    options.driftDetector ?? new DriftDetector(loadDriftThresholds());
  const store = options.evidenceStore ?? new EvidenceStore(env.EVIDENCE_STORE_PATH);
  const policyConfig = loadPolicyConfig();
  const policyEngine =
    options.policyEngine ??
    new PolicyEngine({
      config: policyConfig,
      lastActionAt: buildCooldownIndex(store.readAll().records),
    });
  const keeperhub = options.keeperhub ?? new KeeperHubClient();
  const approvals =
    options.approvalQueue ??
    new ApprovalQueue(
      process.env.APPROVAL_QUEUE_PATH ?? "./data/approvals.jsonl",
    );

  const runId = randomUUID();
  const evidence = createEmptyEvidence({
    runId,
    workflowId: env.WORKFLOW_ID || "incident-keeper-direct",
    workflowVersion: env.WORKFLOW_VERSION,
    triggerType: options.triggerType ?? "manual",
    agentVersion: env.AGENT_VERSION,
    policyVersion: env.POLICY_VERSION,
    chainId: env.CHAIN_ID,
    network: env.NETWORK,
    scenarioId: options.scenarioId,
  });

  const state = await readLayer.readLiveState();
  evidence.preState = { ...state };
  evidence.dataSourceTimestamps = {
    observe: state.timestamp,
    source: state.source,
  };
  evidence.observedInputs = {
    mockLabeled: state.mockLabeled,
    contract: state.contract,
    oracleAgeSeconds: state.oracleAgeSeconds,
    healthFactorBps: state.healthFactorBps,
  };
  evidence.evidenceMode = deriveEvidenceMode({
    observationIsFixture: state.mockLabeled,
    hasLiveExecution: false,
  });

  if (state.mockLabeled) {
    console.log("[MOCK] Observed state is synthetic — label preserved in evidence");
  }

  const drift = driftDetector.classify(state);
  evidence.counterfactual = drift.counterfactual;

  // Prefer typed runbook selection; allow forceAction override
  const scenarioPick = options.scenarioId
    ? resolveScenarioRunbook(state.contract, options.scenarioId)
    : null;
  const runbookPick = options.forceAction
    ? selectRunbook(drift, state.contract)
    : scenarioPick?.recognized
      ? {
          runbook:
            scenarioPick.runbookId === null
              ? null
              : INCIDENT_RUNBOOKS[scenarioPick.runbookId],
          action: scenarioPick.action,
        }
      : selectRunbook(drift, state.contract);
  let action =
    options.forceAction ?? runbookPick.action ?? drift.proposedAction;
  if (action) {
    action = {
      ...action,
      args: serializeArgsForKeeperHub(action.args),
    };
  }
  if (runbookPick.runbook && !options.forceAction) {
    evidence.observedInputs = {
      ...evidence.observedInputs,
      runbookId: runbookPick.runbook.id,
    };
  }
  if (!action) {
    evidence.status = "skipped";
    evidence.policyDecision = "skipped_no_action";
    evidence.decisionRationale = "No drift requiring action";
    evidence.policyReason = "healthy / no proposed action";
    store.append(evidence);
    return {
      evidence,
      state,
      drift,
      policy: null,
      simulation: null,
      execution: null,
    };
  }

  evidence.selectedAction = {
    contract: action.contract,
    functionName: action.functionName,
    valueWei: action.valueWei,
    args: action.args,
  };
  evidence.decisionRationale =
    action.rationale ??
    drift.findings.map((f) => f.message).join("; ") ??
    "agent selected action";

  let approvalContext = options.approvalId
    ? approvals.contextFor(options.approvalId, action)
    : undefined;
  let policy = policyEngine.decide(action, approvalContext);
  applyPolicyToEvidence(evidence, policy, action.severity);
  if (options.approvalId) {
    evidence.observedInputs = {
      ...evidence.observedInputs,
      approvalId: options.approvalId,
      approvalState: approvalContext?.state ?? "missing",
    };
  }

  if (policy.verdict === "blocked") {
    store.append(evidence);
    return { evidence, state, drift, policy, simulation: null, execution: null };
  }

  if (policy.verdict === "approval_required") {
    const pending =
      approvalContext?.state === "pending" && options.approvalId
        ? { id: options.approvalId }
        : approvals.enqueue({
            id: randomUUID(),
            runId: evidence.runId,
            action,
            rationale: evidence.decisionRationale,
            evidenceSnapshot: evidence,
          });
    evidence.observedInputs = {
      ...evidence.observedInputs,
      approvalQueueId: pending.id,
      approvalState: approvalContext?.state ?? "pending",
    };
    console.log(
      `[approval] Queued ${pending.id} — inspect and apply with corepack pnpm run approve -- ${pending.id}`,
    );
    store.append(evidence);
    return { evidence, state, drift, policy, simulation: null, execution: null };
  }

  // From here the action is allowed, potentially by an exact bound approval.
  if (!options.execute) {
    evidence.status = "proposed";
    store.append(evidence);
    return { evidence, state, drift, policy, simulation: null, execution: null };
  }

  let simulation: SimulationResult | null = null;
  const keeperhubAction = {
    contractAddress: action.contract,
    chainId: env.CHAIN_ID,
    functionName: action.functionName,
    functionArgs: serializeArgsForKeeperHub(action.args),
    abi: INCIDENT_ORACLE_ABI_JSON,
  };
  const conditionalIntent = buildConditionalRunbookIntent(action);
  const useAtomicCondition =
    options.conditionalExecution !== false &&
    conditionalIntent !== null &&
    typeof keeperhub.simulateCheckAndExecute === "function" &&
    typeof keeperhub.executeCheckAndExecute === "function";
  if (!options.skipSimulate) {
    simulation =
      useAtomicCondition && conditionalIntent
        ? await keeperhub.simulateCheckAndExecute(
            keeperhubAction,
            conditionalIntent,
          )
        : await keeperhub.simulate(keeperhubAction);
    evidence.simulationResult = {
      status: simulation.status,
      wouldRevert: simulation.wouldRevert,
      gasEstimate: simulation.gasEstimate,
      revertReason: simulation.revertReason,
      error: simulation.error,
      condition: simulation.condition,
      raw: simulation.raw,
    };
    if (useAtomicCondition && simulation.condition) {
      evidence.conditionRecheck = {
        strategy: "keeperhub_atomic",
        met: simulation.condition.met,
        checkedAt: new Date().toISOString(),
        observedValue: simulation.condition.observedValue,
        targetValue: simulation.condition.targetValue,
        operator: simulation.condition.operator,
      };
    }

    if (simulation.status === "condition_not_met") {
      evidence.status = "skipped";
      evidence.policyReason =
        "KeeperHub atomic condition is no longer met; no transaction broadcast";
      evidence.submissionAttempts = 0;
      store.append(evidence);
      return { evidence, state, drift, policy, simulation, execution: null };
    }

    if (simulation.status === "would_revert") {
      evidence.policyDecision = "blocked_by_simulation";
      evidence.status = "simulation_blocked";
      evidence.policyReason = `Simulation would revert: ${simulation.revertReason ?? simulation.error}`;
      evidence.submissionAttempts = 0;
      store.append(evidence);
      console.log(
        `[SIM-GATE] Blocked unsafe action with ZERO gas spent: ${simulation.revertReason}`,
      );
      return { evidence, state, drift, policy, simulation, execution: null };
    }

    if (simulation.status === "error") {
      evidence.status = "failed";
      evidence.policyReason = `Simulation error: ${simulation.error}`;
      store.append(evidence);
      return { evidence, state, drift, policy, simulation, execution: null };
    }
  } else {
    evidence.simulationResult = { status: "skipped" };
  }

  // Re-evaluate policy and approval state immediately before the only external
  // state-changing call. A stale/replayed approval fails closed here.
  approvalContext = options.approvalId
    ? approvals.contextFor(options.approvalId, action)
    : undefined;
  policy = policyEngine.decide(action, approvalContext);
  applyPolicyToEvidence(evidence, policy, action.severity);
  if (policy.verdict !== "allowed") {
    store.append(evidence);
    return { evidence, state, drift, policy, simulation, execution: null };
  }

  if (!useAtomicCondition && conditionalIntent) {
    const recheckedState = await readLayer.readLiveState();
    const conditionMet = incidentConditionStillMet(action, recheckedState);
    evidence.conditionRecheck = {
      strategy: "independent_read",
      met: conditionMet,
      checkedAt: recheckedState.timestamp,
    };
    if (!conditionMet) {
      evidence.status = "skipped";
      evidence.policyReason =
        "Independent pre-execution recheck no longer justifies mitigation";
      store.append(evidence);
      return { evidence, state, drift, policy, simulation, execution: null };
    }
  }

  if (policy.approvalRequired) {
    const consumed =
      options.approvalId
        ? approvals.consume(options.approvalId, action)
        : null;
    if (!consumed) {
      evidence.status = "policy_blocked";
      evidence.policyDecision = "blocked";
      evidence.policyReasonCode = "APPROVAL_CONSUMED";
      evidence.policyReason =
        "Approval could not be consumed immediately before execution";
      evidence.observedInputs = {
        ...evidence.observedInputs,
        approvalId: options.approvalId,
        approvalState: "invalid",
      };
      store.append(evidence);
      return { evidence, state, drift, policy, simulation, execution: null };
    }
    evidence.observedInputs = {
      ...evidence.observedInputs,
      approvalId: consumed.id,
      approvalState: "consumed",
    };
  }

  const execution =
    useAtomicCondition && conditionalIntent
      ? await keeperhub.executeCheckAndExecute(
          keeperhubAction,
          conditionalIntent,
        )
      : await keeperhub.execute(keeperhubAction);

  evidence.submissionAttempts = execution.attempts.length;
  evidence.retryReasons = execution.attempts
    .map((a) => a.retryReason)
    .filter((x): x is string => Boolean(x));
  evidence.gasEstimateChanges = execution.attempts.map((a) => ({
    attempt: a.attempt,
    gasEstimate: a.gasEstimate,
    gasLimitMultiplier: a.gasLimitMultiplier,
  }));
  evidence.nonceChanges = execution.attempts.map((a) => ({
    attempt: a.attempt,
    nonce: a.nonce,
    note: a.retryReason,
  }));
  evidence.submittedAt = new Date().toISOString();
  evidence.keeperhubExecutionId = execution.executionId;
  evidence.keeperhubAuditReference = execution.auditReference;
  evidence.txHash = execution.txHash;
  evidence.explorerUrl = execution.explorerUrl;
  evidence.gasUsed = execution.gasUsed;
  if (useAtomicCondition && execution.condition) {
    evidence.conditionRecheck = {
      strategy: "keeperhub_atomic",
      met: execution.condition.met,
      checkedAt: new Date().toISOString(),
      observedValue: execution.condition.observedValue,
      targetValue: execution.condition.targetValue,
      operator: execution.condition.operator,
    };
  }
  if (execution.executionId) {
    evidence.evidenceMode = deriveEvidenceMode({
      observationIsFixture: state.mockLabeled,
      hasLiveExecution: true,
    });
  }

  if (execution.ok && execution.executed === false) {
    evidence.status = "skipped";
    evidence.policyReason =
      "KeeperHub atomic condition changed before broadcast; no transaction executed";
  } else if (execution.ok) {
    evidence.status = "confirmed";
    evidence.confirmedAt = new Date().toISOString();
    policyEngine.recordExecution(action);

    if (execution.executionId) {
      try {
        const audit = await fetchAuditTrail(keeperhub, execution.executionId);
        Object.assign(evidence, mergeAuditIntoEvidenceFields(audit));
      } catch (e) {
        console.warn(
          `[audit] could not merge get_execution: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    // Best-effort post-state + verification
    try {
      const post = await readLayer.readLiveState();
      const verification = verifyPostState(state, post, action);
      evidence.postState = {
        ...post,
        verification,
      };
      if (!verification.ok) {
        console.warn(`[verify] ${verification.summary}`);
      } else {
        console.log(`[verify] ${verification.summary}`);
      }
    } catch {
      evidence.postState = { note: "post-state read failed" };
    }
  } else {
    evidence.status = "failed";
    evidence.policyReason = execution.finalError ?? "execution failed";
  }

  store.append(evidence);
  return { evidence, state, drift, policy, simulation, execution };
}
