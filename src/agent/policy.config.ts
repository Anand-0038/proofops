/**
 * Typed policy configuration.
 * All limits are enforced in deterministic code — never by an LLM.
 */

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export interface AllowlistedCall {
  /** Contract address (checksummed or lowercase). Compared case-insensitively. */
  contract: string;
  /** Solidity function name (or signature). */
  functionName: string;
  /** Max native value in wei (string decimal). */
  maxValueWei: string;
  /** Human label for evidence/logs. */
  label: string;
}

export interface PolicyConfig {
  version: string;
  chainId: number;
  network: string;
  /** Allowlisted contract+function pairs. Anything else is blocked. */
  allowlist: AllowlistedCall[];
  /** Global per-action native value cap (wei). */
  globalMaxValueWei: string;
  /** Minimum seconds between identical actions (contract+fn). */
  cooldownSeconds: number;
  /**
   * Severity at or above this level requires human approval
   * even if the call is otherwise allowlisted.
   */
  humanApprovalSeverityThreshold: Severity;
  /** Absolute block list (e.g. selfdestruct, upgradeAdmin). */
  blockedFunctions: string[];
}

export const SEVERITY_RANK: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Default Sepolia testnet policy — update addresses after Foundry deploy. */
export const defaultPolicyConfig: PolicyConfig = {
  version: "0.1.0",
  chainId: 11155111,
  network: "sepolia",
  allowlist: [
    {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "setHeartbeat",
      maxValueWei: "0",
      label: "oracle-heartbeat-update",
    },
    {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "pause",
      maxValueWei: "0",
      label: "incident-pause",
    },
    {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "unpause",
      maxValueWei: "0",
      label: "incident-unpause",
    },
    {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "setMaxDeviationBps",
      maxValueWei: "0",
      label: "oracle-deviation-cap",
    },
  ],
  globalMaxValueWei: "10000000000000000", // 0.01 ETH
  cooldownSeconds: 60,
  humanApprovalSeverityThreshold: "high",
  blockedFunctions: [
    "selfdestruct",
    "upgradeTo",
    "upgradeToAndCall",
    "changeAdmin",
    "transferOwnership",
  ],
};

export function withTargetContract(
  base: PolicyConfig,
  target: string,
): PolicyConfig {
  if (!target) return base;
  return {
    ...base,
    allowlist: base.allowlist.map((a) => ({ ...a, contract: target })),
  };
}
