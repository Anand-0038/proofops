#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  RunCycleOptions,
  RunCycleResult,
} from "../../src/agent/runCycle.js";
import { ApprovalQueue } from "../../src/agent/ApprovalQueue.js";
import type {
  PolicyDecision,
  ProposedAction,
} from "../../src/agent/PolicyEngine.js";
import { createProofOpsServer } from "../../src/demo/server.js";
import {
  createEmptyEvidence,
  EvidenceStore,
  type EvidenceRecord,
} from "../../src/evidence/EvidenceRecord.js";

const tempDir = process.env.BROWSER_TEST_DIR;
const operatorToken = process.env.PROOFOPS_OPERATOR_TOKEN;
const origin = process.env.PROOFOPS_ALLOWED_ORIGIN;
const port = Number(process.env.PORT);
if (!tempDir || !operatorToken || !origin || !Number.isInteger(port)) {
  throw new Error("Browser fixture server requires isolated test environment");
}

const CONTRACT = "0x0000000000000000000000000000000000000001";
const FIXTURE_TIME = "2026-07-30T04:00:00.000Z";
const ACTION: ProposedAction = {
  contract: CONTRACT,
  functionName: "pause",
  valueWei: "0",
  severity: "high",
  rationale: "Health factor below the 1.10 safety boundary",
};
const store = new EvidenceStore(join(tempDir, "evidence.jsonl"));
const approvals = new ApprovalQueue(join(tempDir, "approvals.jsonl"), {
  nowMs: () => Date.parse(FIXTURE_TIME),
});
const staticDir = join(process.cwd(), "app", "dashboard");
const proofDir = join(tempDir, "proof");

function evidence(
  runId: string,
  status: EvidenceRecord["status"],
): EvidenceRecord {
  const record = createEmptyEvidence({
    runId,
    workflowId: "proofops-browser-fixture",
    workflowVersion: "1",
    triggerType: "scenario",
    agentVersion: "0.1.0",
    policyVersion: "0.1.0",
    chainId: 11155111,
    network: "sepolia",
    createdAt: FIXTURE_TIME,
  });
  record.status = status;
  record.observedInputs = {
    severity: "high",
    runbookId: "incident.pause",
    healthFactorBps: 10420,
    fixture: true,
  };
  record.dataSourceTimestamps = {
    observe: record.createdAt,
    source: "mock",
  };
  record.selectedAction = {
    contract: CONTRACT,
    functionName: "pause",
    valueWei: "0",
    label: "Emergency pause",
  };
  record.decisionRationale =
    "Health factor 1.042 is below the bounded 1.10 pause threshold";
  record.policyDecision = "allowed";
  record.policyReason = "Allowlisted incident pause within zero-value cap";
  record.policyReasonCode = "ALLOWLIST_OK";
  record.preState = {
    source: "mock",
    healthFactorBps: 10420,
    paused: false,
  };
  return record;
}

const proposed = evidence("browser-proposal", "proposed");
store.append(proposed);

const simulationBlocked = evidence(
  "browser-simulation-blocked",
  "simulation_blocked",
);
simulationBlocked.policyDecision = "blocked_by_simulation";
simulationBlocked.policyReason = "KeeperHub simulation would revert";
simulationBlocked.policyReasonCode = "SIMULATION_REVERT";
simulationBlocked.simulationResult = {
  status: "would_revert",
  wouldRevert: true,
  revertReason: "Error(NotOwner())",
};
store.append(simulationBlocked);

const recovered = evidence("browser-retry-recovery", "fixture_recovered");
recovered.simulationResult = {
  status: "ok",
  wouldRevert: false,
  gasEstimate: "48211",
  condition: {
    met: true,
    observedValue: "10420",
    targetValue: "11000",
    operator: "lt",
  },
};
recovered.conditionRecheck = {
  strategy: "keeperhub_atomic",
  met: true,
  checkedAt: recovered.createdAt,
  observedValue: "10420",
  targetValue: "11000",
  operator: "lt",
};
recovered.submissionAttempts = 2;
recovered.retryReasons = ["transport timeout; original execution reconciled"];
recovered.nonceChanges = [
  { attempt: 1, nonce: "17", note: "original intent" },
  { attempt: 2, nonce: "17", note: "same-body replay" },
];
recovered.gasEstimateChanges = [
  { attempt: 1, gasEstimate: "48211", gasLimitMultiplier: "1.00" },
  { attempt: 2, gasEstimate: "48211", gasLimitMultiplier: "1.00" },
];
recovered.submittedAt = recovered.createdAt;
recovered.confirmedAt = recovered.createdAt;
recovered.postState = { source: "mock", paused: true };
store.append(recovered);

const policyBlocked = evidence("browser-policy-blocked", "policy_blocked");
policyBlocked.policyDecision = "blocked";
policyBlocked.policyReason = "Function is outside the incident allowlist";
policyBlocked.policyReasonCode = "NOT_ALLOWLISTED";
store.append(policyBlocked);

const approvalEvidence = evidence(
  "browser-approval-evidence",
  "approval_required",
);
approvalEvidence.policyDecision = "approval_required";
approvalEvidence.policyReason = "High severity requires a bound human approval";
approvalEvidence.policyReasonCode = "SEVERITY_REQUIRES_APPROVAL";
approvals.enqueue({
  id: "browser-approval",
  runId: approvalEvidence.runId,
  action: ACTION,
  rationale: ACTION.rationale!,
  evidenceSnapshot: approvalEvidence,
});

mkdirSync(proofDir, { recursive: true });
writeFileSync(
  join(proofDir, "proof-bundle.json"),
  `${JSON.stringify({ evidenceMode: "fixture", records: 4 }, null, 2)}\n`,
);
writeFileSync(
  join(proofDir, "proof-bundle.md"),
  "# ProofOps browser fixture\n\nNo live transaction is claimed.\n",
);
writeFileSync(
  join(proofDir, "manifest.json"),
  `${JSON.stringify({ algorithm: "sha256", fixture: true }, null, 2)}\n`,
);
writeFileSync(
  join(proofDir, "verification.json"),
  `${JSON.stringify({ verified: true, fixture: true }, null, 2)}\n`,
);

let generated = 0;
function policyDecision(
  verdict: PolicyDecision["verdict"],
  approved: boolean,
): PolicyDecision {
  return {
    verdict,
    reason: approved
      ? "Exact action fingerprint approved"
      : "High severity requires approval",
    reasonCode: approved
      ? "APPROVAL_SATISFIED"
      : "SEVERITY_REQUIRES_APPROVAL",
    incidentSeverity: "high",
    approvalRequired: true,
    approvalState: approved ? "approved" : "pending",
    matchedAllowlistLabel: "incident-pause",
  };
}

function result(
  record: EvidenceRecord,
  policy: PolicyDecision,
): RunCycleResult {
  return {
    evidence: record,
    state: {
      source: "mock",
      mockLabeled: true,
      timestamp: record.createdAt,
      contract: CONTRACT,
      healthFactorBps: 10420,
      paused: record.status === "fixture_recovered",
    },
    drift: {
      severity: "high",
      findings: [],
      proposedAction: ACTION,
      counterfactual: {
        expectedLossIfNoAction: "Liquidation exposure remains open",
        simulatedImpactOfAction: "Fixture pause contains the exposure",
      },
    },
    policy,
    simulation: null,
    execution: null,
  };
}

async function fixtureCycle(
  options: RunCycleOptions = {},
): Promise<RunCycleResult> {
  generated += 1;
  if (options.execute) {
    const applied = evidence(
      `browser-applied-${generated}`,
      "fixture_recovered",
    );
    applied.triggerType = "manual";
    applied.policyReasonCode = "APPROVAL_SATISFIED";
    applied.simulationResult = {
      status: "ok",
      wouldRevert: false,
      gasEstimate: "48211",
    };
    applied.submissionAttempts = 2;
    applied.retryReasons = ["fixture timeout recovery"];
    applied.submittedAt = applied.createdAt;
    applied.confirmedAt = applied.createdAt;
    applied.postState = { source: "mock", paused: true };
    store.append(applied);
    return result(applied, policyDecision("allowed", true));
  }

  const proposal = evidence(
    `browser-generated-proposal-${generated}`,
    "approval_required",
  );
  proposal.triggerType = "webhook";
  proposal.policyDecision = "approval_required";
  proposal.policyReason = "High severity requires a bound human approval";
  proposal.policyReasonCode = "SEVERITY_REQUIRES_APPROVAL";
  store.append(proposal);
  approvals.enqueue({
    id: `browser-generated-approval-${generated}`,
    runId: proposal.runId,
    action: ACTION,
    rationale: ACTION.rationale!,
    evidenceSnapshot: proposal,
  });
  return result(proposal, policyDecision("approval_required", false));
}

const server = createProofOpsServer({
  operatorToken,
  allowedOrigins: [origin],
  evidenceStore: store,
  approvalQueue: approvals,
  runCycleFn: fixtureCycle,
  staticDir,
  proofDir,
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
