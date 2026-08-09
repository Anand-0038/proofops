import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { PolicyDecision, PolicyVerdict } from "../agent/PolicyEngine.js";
import type { Severity } from "../agent/policy.config.js";

/** Canonical persisted evidence schema for an incident-response run. */
export interface EvidenceRecord {
  evidenceMode: "fixture" | "live" | "mixed";
  runId: string;
  workflowId: string;
  workflowVersion: string;
  triggerType: "manual" | "schedule" | "webhook" | "blockchain_event" | "scenario" | "failure_injection";
  agentVersion: string;
  policyVersion: string;
  observedInputs: Record<string, unknown>;
  dataSourceTimestamps: Record<string, string>;
  selectedAction: {
    contract: string;
    functionName: string;
    valueWei: string;
    args?: unknown[];
    label?: string;
  } | null;
  decisionRationale: string;
  policyDecision: PolicyVerdict | "blocked_by_simulation" | "skipped_no_action";
  policyReason: string;
  policyReasonCode?: string;
  simulationResult: {
    status:
      | "ok"
      | "condition_not_met"
      | "would_revert"
      | "error"
      | "skipped";
    wouldRevert?: boolean;
    gasEstimate?: string;
    revertReason?: string;
    error?: string;
    raw?: unknown;
    condition?: {
      met: boolean;
      observedValue?: string;
      targetValue?: string;
      operator?: string;
    };
  } | null;
  conditionRecheck?: {
    strategy: "keeperhub_atomic" | "independent_read";
    met: boolean;
    checkedAt: string;
    observedValue?: string;
    targetValue?: string;
    operator?: string;
  };
  submissionAttempts: number;
  retryReasons: string[];
  nonceChanges: Array<{ attempt: number; nonce?: string; note?: string }>;
  gasEstimateChanges: Array<{ attempt: number; gasEstimate?: string; gasLimitMultiplier?: string }>;
  txHash: string | null;
  chainId: number;
  network: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  gasUsed: string | null;
  status:
    | "proposed"
    | "policy_blocked"
    | "approval_required"
    | "simulation_blocked"
    | "submitted"
    | "confirmed"
    | "fixture_recovered"
    | "failed"
    | "skipped";
  preState: Record<string, unknown> | null;
  postState: Record<string, unknown> | null;
  keeperhubExecutionId: string | null;
  keeperhubAuditReference: string | null;
  explorerUrl: string | null;
  counterfactual?: {
    expectedLossIfNoAction?: string;
    simulatedImpactOfAction?: string;
  };
  scenarioId?: string;
  createdAt: string;
}

const SelectedActionSchema = z
  .object({
    contract: z.string(),
    functionName: z.string(),
    valueWei: z.string(),
    args: z.array(z.unknown()).optional(),
    label: z.string().optional(),
  })
  .strict();

export const EvidenceRecordSchema: z.ZodType<EvidenceRecord> = z
  .object({
    evidenceMode: z.enum(["fixture", "live", "mixed"]),
    runId: z.string().min(1),
    workflowId: z.string(),
    workflowVersion: z.string(),
    triggerType: z.enum([
      "manual",
      "schedule",
      "webhook",
      "blockchain_event",
      "scenario",
      "failure_injection",
    ]),
    agentVersion: z.string(),
    policyVersion: z.string(),
    observedInputs: z.record(z.unknown()),
    dataSourceTimestamps: z.record(z.string()),
    selectedAction: SelectedActionSchema.nullable(),
    decisionRationale: z.string(),
    policyDecision: z.enum([
      "allowed",
      "approval_required",
      "blocked",
      "blocked_by_simulation",
      "skipped_no_action",
    ]),
    policyReason: z.string(),
    policyReasonCode: z.string().optional(),
    simulationResult: z
      .object({
        status: z.enum([
          "ok",
          "condition_not_met",
          "would_revert",
          "error",
          "skipped",
        ]),
        wouldRevert: z.boolean().optional(),
        gasEstimate: z.string().optional(),
        revertReason: z.string().optional(),
        error: z.string().optional(),
        raw: z.unknown().optional(),
        condition: z
          .object({
            met: z.boolean(),
            observedValue: z.string().optional(),
            targetValue: z.string().optional(),
            operator: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullable(),
    conditionRecheck: z
      .object({
        strategy: z.enum(["keeperhub_atomic", "independent_read"]),
        met: z.boolean(),
        checkedAt: z.string().datetime(),
        observedValue: z.string().optional(),
        targetValue: z.string().optional(),
        operator: z.string().optional(),
      })
      .strict()
      .optional(),
    submissionAttempts: z.number().int().nonnegative(),
    retryReasons: z.array(z.string()),
    nonceChanges: z.array(
      z
        .object({
          attempt: z.number().int().positive(),
          nonce: z.string().optional(),
          note: z.string().optional(),
        })
        .strict(),
    ),
    gasEstimateChanges: z.array(
      z
        .object({
          attempt: z.number().int().positive(),
          gasEstimate: z.string().optional(),
          gasLimitMultiplier: z.string().optional(),
        })
        .strict(),
    ),
    txHash: z.string().nullable(),
    chainId: z.number().int().positive(),
    network: z.string().min(1),
    submittedAt: z.string().datetime().nullable(),
    confirmedAt: z.string().datetime().nullable(),
    gasUsed: z.string().nullable(),
    status: z.enum([
      "proposed",
      "policy_blocked",
      "approval_required",
      "simulation_blocked",
      "submitted",
      "confirmed",
      "fixture_recovered",
      "failed",
      "skipped",
    ]),
    preState: z.record(z.unknown()).nullable(),
    postState: z.record(z.unknown()).nullable(),
    keeperhubExecutionId: z.string().nullable(),
    keeperhubAuditReference: z.string().nullable(),
    explorerUrl: z.string().nullable(),
    counterfactual: z
      .object({
        expectedLossIfNoAction: z.string().optional(),
        simulatedImpactOfAction: z.string().optional(),
      })
      .strict()
      .optional(),
    scenarioId: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.evidenceMode === "fixture") {
      const claimedLiveFields = [
        record.txHash,
        record.explorerUrl,
        record.keeperhubExecutionId,
        record.keeperhubAuditReference,
      ].filter((value) => value !== null);
      if (claimedLiveFields.length > 0 || record.status === "confirmed") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Fixture evidence cannot claim a confirmed transaction, KeeperHub execution, audit reference, or explorer link",
        });
      }
    }
    if (
      record.status === "fixture_recovered" &&
      record.evidenceMode !== "fixture"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fixture_recovered status requires fixture evidence mode",
      });
    }
    if (record.status === "confirmed" && !isVerifiedLiveExecution(record)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Confirmed evidence requires a complete live KeeperHub execution receipt",
      });
    }
  });

export interface EvidenceReadIssue {
  line: number;
  code: "malformed_json" | "schema_invalid";
  message: string;
}

export interface EvidenceReadResult {
  records: EvidenceRecord[];
  issues: EvidenceReadIssue[];
}

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export function deriveEvidenceMode(input: {
  observationIsFixture: boolean;
  hasLiveExecution: boolean;
}): EvidenceRecord["evidenceMode"] {
  if (input.observationIsFixture && input.hasLiveExecution) return "mixed";
  return input.observationIsFixture ? "fixture" : "live";
}

export function isVerifiedLiveExecution(record: EvidenceRecord): boolean {
  if (record.evidenceMode === "fixture") return false;
  return (
    record.status === "confirmed" &&
    typeof record.keeperhubExecutionId === "string" &&
    record.keeperhubExecutionId.length > 0 &&
    typeof record.txHash === "string" &&
    /^0x[a-fA-F0-9]{64}$/.test(record.txHash) &&
    typeof record.explorerUrl === "string" &&
    isHttpsUrl(record.explorerUrl) &&
    typeof record.keeperhubAuditReference === "string" &&
    isHttpsUrl(record.keeperhubAuditReference)
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function createEmptyEvidence(
  partial: Partial<EvidenceRecord> &
    Pick<
      EvidenceRecord,
      | "runId"
      | "workflowId"
      | "workflowVersion"
      | "triggerType"
      | "agentVersion"
      | "policyVersion"
      | "chainId"
      | "network"
    >,
): EvidenceRecord {
  return {
    evidenceMode: "fixture",
    observedInputs: {},
    dataSourceTimestamps: {},
    selectedAction: null,
    decisionRationale: "",
    policyDecision: "skipped_no_action",
    policyReason: "",
    simulationResult: null,
    submissionAttempts: 0,
    retryReasons: [],
    nonceChanges: [],
    gasEstimateChanges: [],
    txHash: null,
    submittedAt: null,
    confirmedAt: null,
    gasUsed: null,
    status: "proposed",
    preState: null,
    postState: null,
    keeperhubExecutionId: null,
    keeperhubAuditReference: null,
    explorerUrl: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export function applyPolicyToEvidence(
  evidence: EvidenceRecord,
  decision: PolicyDecision,
  severity: Severity,
): void {
  evidence.policyDecision = decision.verdict;
  evidence.policyReason = decision.reason;
  evidence.policyReasonCode = decision.reasonCode;
  if (decision.verdict === "blocked") {
    evidence.status = "policy_blocked";
  } else if (decision.verdict === "approval_required") {
    evidence.status = "approval_required";
  }
  evidence.observedInputs = {
    ...evidence.observedInputs,
    severity,
  };
}

export class EvidenceStore {
  constructor(private readonly path: string) {}

  append(record: EvidenceRecord): void {
    const parsed = EvidenceRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new EvidenceValidationError(
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(parsed.data)}\n`, "utf8");
  }

  readAll(): EvidenceReadResult {
    if (!existsSync(this.path)) return { records: [], issues: [] };
    const raw = readFileSync(this.path, "utf8").trim();
    if (!raw) return { records: [], issues: [] };
    const records: EvidenceRecord[] = [];
    const issues: EvidenceReadIssue[] = [];
    for (const [index, line] of raw.split("\n").entries()) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        issues.push({
          line: index + 1,
          code: "malformed_json",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const parsed = EvidenceRecordSchema.safeParse(value);
      if (!parsed.success) {
        issues.push({
          line: index + 1,
          code: "schema_invalid",
          message: parsed.error.issues
            .map((issue) => issue.message)
            .join("; "),
        });
        continue;
      }
      records.push(parsed.data);
    }
    return { records, issues };
  }

  clear(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, "", "utf8");
  }

  removeFixtureRecords(): number {
    if (!existsSync(this.path)) return 0;
    const raw = readFileSync(this.path, "utf8");
    const kept: string[] = [];
    let removed = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = EvidenceRecordSchema.safeParse(JSON.parse(line));
        if (parsed.success && parsed.data.evidenceMode === "fixture") {
          removed += 1;
          continue;
        }
      } catch {
        // Preserve malformed rows for quarantine/forensics.
      }
      kept.push(line);
    }
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.path,
      kept.length ? `${kept.join("\n")}\n` : "",
      "utf8",
    );
    return removed;
  }
}

/** Human-readable Markdown for one evidence record. */
export function formatEvidenceMarkdown(r: EvidenceRecord): string {
  const lines = [
    `# Evidence Run \`${r.runId}\``,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Status | **${r.status}** |`,
    `| Evidence mode | **${r.evidenceMode}** |`,
    `| Trigger | ${r.triggerType} |`,
    `| Workflow | ${r.workflowId || "(none)"} @ v${r.workflowVersion} |`,
    `| Agent / Policy | ${r.agentVersion} / ${r.policyVersion} |`,
    `| Chain | ${r.network} (${r.chainId}) |`,
    `| Policy | ${r.policyDecision} — ${r.policyReason} |`,
    `| Simulation | ${r.simulationResult?.status ?? "n/a"}${r.simulationResult?.revertReason ? ` — ${r.simulationResult.revertReason}` : ""} |`,
    `| Attempts | ${r.submissionAttempts} |`,
    `| Retry reasons | ${r.retryReasons.length ? r.retryReasons.join("; ") : "—"} |`,
    `| Tx | ${r.txHash ?? "—"} |`,
    `| Gas used | ${r.gasUsed ?? "—"} |`,
    `| KeeperHub execution | ${r.keeperhubExecutionId ?? "—"} |`,
    `| Audit ref | ${r.keeperhubAuditReference ?? "—"} |`,
    `| Explorer | ${r.explorerUrl ?? "—"} |`,
    `| Created | ${r.createdAt} |`,
    "",
    "## Selected action",
    "",
    r.selectedAction
      ? `- \`${r.selectedAction.contract}.${r.selectedAction.functionName}\` value=${r.selectedAction.valueWei} wei`
      : "- (none)",
    "",
    "## Decision rationale",
    "",
    r.decisionRationale || "_(empty)_",
    "",
    "## Pre-state",
    "",
    "```json",
    JSON.stringify(r.preState, null, 2),
    "```",
    "",
    "## Post-state",
    "",
    "```json",
    JSON.stringify(r.postState, null, 2),
    "```",
  ];

  if (r.counterfactual) {
    lines.push(
      "",
      "## Counterfactual",
      "",
      `- Expected loss if no action: ${r.counterfactual.expectedLossIfNoAction ?? "n/a"}`,
      `- Simulated impact of action: ${r.counterfactual.simulatedImpactOfAction ?? "n/a"}`,
    );
  }

  if (r.gasEstimateChanges.length) {
    lines.push("", "## Gas estimate changes", "");
    for (const g of r.gasEstimateChanges) {
      lines.push(
        `- attempt ${g.attempt}: estimate=${g.gasEstimate ?? "?"} multiplier=${g.gasLimitMultiplier ?? "?"}`,
      );
    }
  }

  if (r.nonceChanges.length) {
    lines.push("", "## Nonce changes", "");
    for (const n of r.nonceChanges) {
      lines.push(
        `- attempt ${n.attempt}: nonce=${n.nonce ?? "?"} ${n.note ?? ""}`,
      );
    }
  }

  return lines.join("\n");
}
