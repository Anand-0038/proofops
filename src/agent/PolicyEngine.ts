import {
  type PolicyConfig,
  type Severity,
  SEVERITY_RANK,
  defaultPolicyConfig,
} from "./policy.config.js";
import { createHash } from "node:crypto";

export type PolicyVerdict = "allowed" | "approval_required" | "blocked";

export interface ProposedAction {
  contract: string;
  functionName: string;
  /** Native value in wei (decimal string). */
  valueWei: string;
  args?: unknown[];
  /** Drift / incident severity that motivated this action. */
  severity: Severity;
  /** Optional agent rationale (informational only — never authoritative). */
  rationale?: string;
  /** Stable key for cooldown (defaults to contract+fn). */
  actionKey?: string;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  reason: string;
  reasonCode:
    | "ALLOWLIST_OK"
    | "VALUE_CAP_EXCEEDED"
    | "GLOBAL_CAP_EXCEEDED"
    | "NOT_ALLOWLISTED"
    | "BLOCKED_FUNCTION"
    | "COOLDOWN_ACTIVE"
    | "SEVERITY_REQUIRES_APPROVAL"
    | "APPROVAL_SATISFIED"
    | "APPROVAL_MISMATCH"
    | "APPROVAL_EXPIRED"
    | "APPROVAL_REJECTED"
    | "APPROVAL_CONSUMED"
    | "INVALID_ACTION";
  incidentSeverity: Severity;
  approvalRequired: boolean;
  approvalState: ApprovalState;
  approvalId?: string;
  matchedAllowlistLabel?: string;
  cooldownRemainingSeconds?: number;
}

export type ApprovalState =
  | "not_required"
  | "missing"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "consumed"
  | "invalid";

export interface ApprovalContext {
  approvalId?: string;
  state: Exclude<ApprovalState, "not_required">;
  actionFingerprint?: string;
}

export interface PolicyEngineOptions {
  config?: PolicyConfig;
  /** Injected clock for tests. */
  nowMs?: () => number;
  /** Pre-seeded last-action timestamps (actionKey → epoch ms). */
  lastActionAt?: Map<string, number>;
}

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

function parseWei(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid wei value: ${value}`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("Proposed action must be JSON serializable");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function fingerprintProposedAction(action: ProposedAction): string {
  const authorityBinding = {
    contract: normalizeAddress(action.contract),
    functionName: action.functionName.trim().toLowerCase(),
    valueWei: action.valueWei || "0",
    args: action.args ?? [],
    severity: action.severity,
    actionKey: action.actionKey,
  };
  return createHash("sha256")
    .update(canonicalJson(authorityBinding))
    .digest("hex");
}

/**
 * Deterministic policy gate. Pure code — no LLM, no network I/O.
 * LLM recommendations must pass through decide() before KeeperHub execute.
 */
export class PolicyEngine {
  readonly config: PolicyConfig;
  private readonly nowMs: () => number;
  private readonly lastActionAt: Map<string, number>;

  constructor(options: PolicyEngineOptions = {}) {
    this.config = options.config ?? defaultPolicyConfig;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.lastActionAt = options.lastActionAt ?? new Map();
  }

  decide(
    action: ProposedAction,
    approval?: ApprovalContext,
  ): PolicyDecision {
    const approvalRequired =
      SEVERITY_RANK[action.severity] >=
      SEVERITY_RANK[this.config.humanApprovalSeverityThreshold];
    const decisionMeta = {
      incidentSeverity: action.severity,
      approvalRequired,
      approvalState: approvalRequired
        ? (approval?.state ?? "missing")
        : ("not_required" as const),
      approvalId: approval?.approvalId,
    };

    if (!action.contract || !action.functionName) {
      return {
        verdict: "blocked",
        reason: "Action missing contract or functionName",
        reasonCode: "INVALID_ACTION",
        ...decisionMeta,
      };
    }

    const fn = action.functionName.trim();
    const contract = normalizeAddress(action.contract);

    if (
      this.config.blockedFunctions.some(
        (b) => b.toLowerCase() === fn.toLowerCase(),
      )
    ) {
      return {
        verdict: "blocked",
        reason: `Function "${fn}" is on the absolute block list`,
        reasonCode: "BLOCKED_FUNCTION",
        ...decisionMeta,
      };
    }

    const allow = this.config.allowlist.find(
      (a) =>
        normalizeAddress(a.contract) === contract &&
        a.functionName.toLowerCase() === fn.toLowerCase(),
    );

    if (!allow) {
      return {
        verdict: "blocked",
        reason: `Call ${contract}.${fn} is not on the allowlist`,
        reasonCode: "NOT_ALLOWLISTED",
        ...decisionMeta,
      };
    }

    let valueWei: bigint;
    try {
      valueWei = parseWei(action.valueWei || "0");
    } catch {
      return {
        verdict: "blocked",
        reason: `Invalid valueWei: ${action.valueWei}`,
        reasonCode: "INVALID_ACTION",
        ...decisionMeta,
      };
    }

    const perActionCap = parseWei(allow.maxValueWei);
    if (valueWei > perActionCap) {
      return {
        verdict: "blocked",
        reason: `Value ${valueWei} wei exceeds per-action cap ${perActionCap} wei for ${allow.label}`,
        reasonCode: "VALUE_CAP_EXCEEDED",
        ...decisionMeta,
      };
    }

    const globalCap = parseWei(this.config.globalMaxValueWei);
    if (valueWei > globalCap) {
      return {
        verdict: "blocked",
        reason: `Value ${valueWei} wei exceeds global cap ${globalCap} wei`,
        reasonCode: "GLOBAL_CAP_EXCEEDED",
        ...decisionMeta,
      };
    }

    const actionKey =
      action.actionKey ?? `${contract}:${fn.toLowerCase()}`;
    const last = this.lastActionAt.get(actionKey);
    if (last !== undefined) {
      const elapsedSec = (this.nowMs() - last) / 1000;
      const remaining = this.config.cooldownSeconds - elapsedSec;
      if (remaining > 0) {
        return {
          verdict: "blocked",
          reason: `Cooldown active for ${actionKey}; ${Math.ceil(remaining)}s remaining`,
          reasonCode: "COOLDOWN_ACTIVE",
          ...decisionMeta,
          cooldownRemainingSeconds: Math.ceil(remaining),
          matchedAllowlistLabel: allow.label,
        };
      }
    }

    if (approvalRequired) {
      if (
        approval?.state === "approved" &&
        approval.actionFingerprint === fingerprintProposedAction(action)
      ) {
        return {
          verdict: "allowed",
          reason: `Approval ${approval.approvalId ?? "(unlabeled)"} is bound to this exact action`,
          reasonCode: "APPROVAL_SATISFIED",
          matchedAllowlistLabel: allow.label,
          ...decisionMeta,
        };
      }

      if (
        approval?.state === "invalid" ||
        (approval?.state === "approved" &&
          approval.actionFingerprint !== fingerprintProposedAction(action))
      ) {
        return {
          verdict: "blocked",
          reason: "Approval is not bound to this exact action",
          reasonCode: "APPROVAL_MISMATCH",
          matchedAllowlistLabel: allow.label,
          ...decisionMeta,
          approvalState: "invalid",
        };
      }

      if (approval?.state === "expired") {
        return {
          verdict: "blocked",
          reason: "Approval has expired",
          reasonCode: "APPROVAL_EXPIRED",
          matchedAllowlistLabel: allow.label,
          ...decisionMeta,
        };
      }
      if (approval?.state === "rejected") {
        return {
          verdict: "blocked",
          reason: "Approval was rejected",
          reasonCode: "APPROVAL_REJECTED",
          matchedAllowlistLabel: allow.label,
          ...decisionMeta,
        };
      }
      if (approval?.state === "consumed") {
        return {
          verdict: "blocked",
          reason: "Approval was already consumed",
          reasonCode: "APPROVAL_CONSUMED",
          matchedAllowlistLabel: allow.label,
          ...decisionMeta,
        };
      }

      return {
        verdict: "approval_required",
        reason: `Severity "${action.severity}" meets/exceeds human-approval threshold "${this.config.humanApprovalSeverityThreshold}"`,
        reasonCode: "SEVERITY_REQUIRES_APPROVAL",
        matchedAllowlistLabel: allow.label,
        ...decisionMeta,
      };
    }

    return {
      verdict: "allowed",
      reason: `Allowlisted as ${allow.label}; within caps; cooldown clear`,
      reasonCode: "ALLOWLIST_OK",
      matchedAllowlistLabel: allow.label,
      ...decisionMeta,
    };
  }

  /** Call after a successful on-chain execution to start cooldown. */
  recordExecution(action: ProposedAction): void {
    const key =
      action.actionKey ??
      `${normalizeAddress(action.contract)}:${action.functionName.toLowerCase()}`;
    this.lastActionAt.set(key, this.nowMs());
  }
}

export { defaultPolicyConfig };
