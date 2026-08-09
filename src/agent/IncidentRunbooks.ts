import type { Severity } from "./policy.config.js";
import type { ProposedAction } from "./PolicyEngine.js";
import type { DriftFinding, DriftReport } from "../observe/DriftDetector.js";
import { serializeArgsForKeeperHub } from "../contracts/IncidentOracle.js";
import type { ObservedState } from "../observe/ReadLayer.js";

/**
 * Typed incident runbooks — reusable, deterministic playbooks.
 * Designed to map 1:1 to per-workflow MCP tools later.
 */
export type RunbookId =
  | "incident.pause"
  | "incident.repair_heartbeat"
  | "incident.reset_deviation"
  | "incident.unpause";

export interface IncidentRunbook {
  id: RunbookId;
  title: string;
  description: string;
  /** Minimum severity that justifies this runbook. */
  minSeverity: Severity;
  functionName: ProposedAction["functionName"];
  buildArgs: (ctx: RunbookContext) => unknown[];
  /** Human rationale template. */
  rationale: (ctx: RunbookContext) => string;
}

export interface RunbookContext {
  contract: string;
  severity: Severity;
  findings: DriftFinding[];
  heartbeatSeconds?: number;
  expectedMaxDeviationBps?: number;
}

export type ConditionalOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";

export interface ConditionalRunbookIntent {
  checkFunctionName: string;
  checkArgs: unknown[];
  operator: ConditionalOperator;
  targetValue: string;
}

export function buildConditionalRunbookIntent(
  action: ProposedAction,
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
): ConditionalRunbookIntent | null {
  if (action.functionName === "pause") {
    return {
      checkFunctionName: "healthFactorBps",
      checkArgs: [],
      operator: "lt",
      targetValue: "11000",
    };
  }
  if (
    action.functionName === "setMaxDeviationBps" &&
    action.args?.[0] !== undefined
  ) {
    return {
      checkFunctionName: "maxDeviationBps",
      checkArgs: [],
      operator: "neq",
      targetValue: String(action.args[0]),
    };
  }
  if (action.functionName === "setHeartbeat") {
    return {
      checkFunctionName: "lastUpdated",
      checkArgs: [],
      operator: "lt",
      targetValue: String(nowEpochSeconds - 3_600),
    };
  }
  if (action.functionName === "unpause") {
    return {
      checkFunctionName: "paused",
      checkArgs: [],
      operator: "eq",
      targetValue: "true",
    };
  }
  return null;
}

export function incidentConditionStillMet(
  action: ProposedAction,
  state: ObservedState,
): boolean {
  if (action.functionName === "pause") {
    return state.paused !== true && (state.healthFactorBps ?? Infinity) < 11_000;
  }
  if (action.functionName === "setMaxDeviationBps") {
    const target = Number(action.args?.[0]);
    return (
      Number.isFinite(target) &&
      state.maxDeviationBps !== undefined &&
      state.maxDeviationBps !== target
    );
  }
  if (action.functionName === "setHeartbeat") {
    return (state.oracleAgeSeconds ?? 0) >= 3_600;
  }
  if (action.functionName === "unpause") {
    return state.paused === true;
  }
  return false;
}

export const INCIDENT_RUNBOOKS: Record<RunbookId, IncidentRunbook> = {
  "incident.pause": {
    id: "incident.pause",
    title: "Emergency pause",
    description:
      "Pause the incident surface when health-factor or critical drift is present.",
    minSeverity: "high",
    functionName: "pause",
    buildArgs: () => [],
    rationale: (ctx) =>
      `Runbook incident.pause: ${ctx.findings.map((f) => f.code).join(", ") || "high severity"}`,
  },
  "incident.repair_heartbeat": {
    id: "incident.repair_heartbeat",
    title: "Repair oracle heartbeat",
    description: "Refresh heartbeat after oracle staleness drift.",
    minSeverity: "low",
    functionName: "setHeartbeat",
    buildArgs: (ctx) => [
      Math.max(ctx.heartbeatSeconds ?? 3600, 1800).toString(),
    ],
    rationale: (ctx) =>
      `Runbook incident.repair_heartbeat: age-related findings ${ctx.findings
        .filter((f) => f.code.startsWith("ORACLE_STALE"))
        .map((f) => f.code)
        .join(", ")}`,
  },
  "incident.reset_deviation": {
    id: "incident.reset_deviation",
    title: "Reset max deviation",
    description: "Restore maxDeviationBps to expected protocol baseline.",
    minSeverity: "medium",
    functionName: "setMaxDeviationBps",
    buildArgs: (ctx) => [(ctx.expectedMaxDeviationBps ?? 100).toString()],
    rationale: () => "Runbook incident.reset_deviation: PARAM_DEVIATION",
  },
  "incident.unpause": {
    id: "incident.unpause",
    title: "Unpause after recovery",
    description: "Human-gated unpause once incident is cleared.",
    minSeverity: "low",
    functionName: "unpause",
    buildArgs: () => [],
    rationale: () => "Runbook incident.unpause: operator recovery",
  },
};

const SEVERITY_RANK: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function runbookToAction(
  runbook: IncidentRunbook,
  ctx: RunbookContext,
): ProposedAction {
  return {
    contract: ctx.contract,
    functionName: runbook.functionName,
    valueWei: "0",
    args: serializeArgsForKeeperHub(runbook.buildArgs(ctx)),
    severity: ctx.severity,
    rationale: runbook.rationale(ctx),
    actionKey: `${ctx.contract.toLowerCase()}:${runbook.id}`,
  };
}

/**
 * Deterministic action selection from drift — no LLM.
 * Priority: pause (HF/critical) > heartbeat repair > deviation reset.
 */
export function selectRunbook(drift: DriftReport, contract: string): {
  runbook: IncidentRunbook | null;
  action: ProposedAction | null;
} {
  if (drift.severity === "none" || !drift.findings.length) {
    return { runbook: null, action: null };
  }

  // Already paused handled by detector (no action) — belt and suspenders
  if (drift.findings.some((f) => f.code === "ALREADY_PAUSED")) {
    return { runbook: null, action: null };
  }

  const ctx: RunbookContext = {
    contract,
    severity: drift.severity,
    findings: drift.findings,
  };

  const hasHf = drift.findings.some((f) => f.code.startsWith("HEALTH_FACTOR"));
  const hasStale = drift.findings.some((f) => f.code.startsWith("ORACLE_STALE"));
  const hasDev = drift.findings.some((f) => f.code === "PARAM_DEVIATION");

  let chosen: IncidentRunbook | null = null;

  if (hasHf && SEVERITY_RANK[drift.severity] >= SEVERITY_RANK.high) {
    chosen = INCIDENT_RUNBOOKS["incident.pause"];
  } else if (hasStale) {
    chosen = INCIDENT_RUNBOOKS["incident.repair_heartbeat"];
    const ageFinding = drift.findings.find((f) =>
      f.code.startsWith("ORACLE_STALE"),
    );
    ctx.heartbeatSeconds = 3600;
    if (ageFinding) {
      // keep detector's proposed heartbeat semantics
    }
  } else if (hasDev) {
    chosen = INCIDENT_RUNBOOKS["incident.reset_deviation"];
    ctx.expectedMaxDeviationBps = 100;
  }

  if (!chosen) return { runbook: null, action: null };
  if (SEVERITY_RANK[drift.severity] < SEVERITY_RANK[chosen.minSeverity]) {
    return { runbook: null, action: null };
  }

  return { runbook: chosen, action: runbookToAction(chosen, ctx) };
}

/** MCP-tool-shaped descriptors for per-workflow exposure. */
export function listRunbookToolDescriptors(): Array<{
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Object.values(INCIDENT_RUNBOOKS).map((r) => ({
    name: r.id.replace(".", "_"),
    title: r.title,
    description: r.description,
    inputSchema: {
      type: "object",
      properties: {
        contract: { type: "string", description: "IncidentOracle address" },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
        approvalId: {
          type: "string",
          description: "A queue-issued approval bound to the exact action",
        },
      },
      required: ["contract", "severity"],
    },
  }));
}
