import type { Severity } from "../agent/policy.config.js";
import type { ObservedState } from "./ReadLayer.js";
import type { ProposedAction } from "../agent/PolicyEngine.js";
import { selectRunbook } from "../agent/IncidentRunbooks.js";

/**
 * Configurable drift thresholds — documented, not magic numbers.
 * Override via DriftThresholds or env-driven config later.
 */
export interface DriftThresholds {
  /** Oracle age (seconds) at which severity becomes low. Default 1h. */
  oracleStaleLowSeconds: number;
  /** Oracle age → medium. Default 2h. */
  oracleStaleMediumSeconds: number;
  /** Oracle age → high. Default 6h. */
  oracleStaleHighSeconds: number;
  /** Health factor (bps, 10000 = 1.0) below which → medium. */
  healthFactorMediumBps: number;
  /** Health factor below which → high / critical. */
  healthFactorHighBps: number;
  /** Parameter deviation from expected maxDeviationBps → medium. */
  deviationMediumBps: number;
  /** Expected maxDeviationBps baseline (protocol config). */
  expectedMaxDeviationBps: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  oracleStaleLowSeconds: 3600,
  oracleStaleMediumSeconds: 7200,
  oracleStaleHighSeconds: 21600,
  healthFactorMediumBps: 12000, // 1.20
  healthFactorHighBps: 11000, // 1.10
  deviationMediumBps: 50,
  expectedMaxDeviationBps: 100,
};

export interface DriftFinding {
  code: string;
  severity: Severity;
  message: string;
  observed: unknown;
  threshold: unknown;
}

export interface DriftReport {
  severity: Severity;
  findings: DriftFinding[];
  proposedAction: ProposedAction | null;
  counterfactual: {
    expectedLossIfNoAction: string;
    simulatedImpactOfAction: string;
  };
}

const RANK: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

export class DriftDetector {
  constructor(private readonly thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS) {}

  classify(state: ObservedState): DriftReport {
    const findings: DriftFinding[] = [];
    let severity: Severity = "none";

    if (state.paused) {
      findings.push({
        code: "ALREADY_PAUSED",
        severity: "low",
        message: "Protocol already paused — no incident action needed",
        observed: true,
        threshold: false,
      });
      severity = maxSeverity(severity, "low");
    }

    const age = state.oracleAgeSeconds ?? 0;
    const heartbeat = state.heartbeatSeconds ?? this.thresholds.oracleStaleLowSeconds;

    if (age >= this.thresholds.oracleStaleHighSeconds) {
      findings.push({
        code: "ORACLE_STALE_HIGH",
        severity: "high",
        message: `Oracle age ${age}s exceeds high threshold ${this.thresholds.oracleStaleHighSeconds}s (heartbeat ${heartbeat}s)`,
        observed: age,
        threshold: this.thresholds.oracleStaleHighSeconds,
      });
      severity = maxSeverity(severity, "high");
    } else if (age >= this.thresholds.oracleStaleMediumSeconds) {
      findings.push({
        code: "ORACLE_STALE_MEDIUM",
        severity: "medium",
        message: `Oracle age ${age}s exceeds medium threshold ${this.thresholds.oracleStaleMediumSeconds}s`,
        observed: age,
        threshold: this.thresholds.oracleStaleMediumSeconds,
      });
      severity = maxSeverity(severity, "medium");
    } else if (age >= this.thresholds.oracleStaleLowSeconds) {
      findings.push({
        code: "ORACLE_STALE_LOW",
        severity: "low",
        message: `Oracle age ${age}s exceeds low threshold ${this.thresholds.oracleStaleLowSeconds}s`,
        observed: age,
        threshold: this.thresholds.oracleStaleLowSeconds,
      });
      severity = maxSeverity(severity, "low");
    }

    const hf = state.healthFactorBps;
    if (hf !== undefined) {
      if (hf < this.thresholds.healthFactorHighBps) {
        findings.push({
          code: "HEALTH_FACTOR_BREACH",
          severity: "high",
          message: `Health factor ${hf} bps < high threshold ${this.thresholds.healthFactorHighBps} bps`,
          observed: hf,
          threshold: this.thresholds.healthFactorHighBps,
        });
        severity = maxSeverity(severity, "high");
      } else if (hf < this.thresholds.healthFactorMediumBps) {
        findings.push({
          code: "HEALTH_FACTOR_WARN",
          severity: "medium",
          message: `Health factor ${hf} bps < medium threshold ${this.thresholds.healthFactorMediumBps} bps`,
          observed: hf,
          threshold: this.thresholds.healthFactorMediumBps,
        });
        severity = maxSeverity(severity, "medium");
      }
    }

    const maxDev = state.maxDeviationBps;
    if (
      maxDev !== undefined &&
      Math.abs(maxDev - this.thresholds.expectedMaxDeviationBps) >=
        this.thresholds.deviationMediumBps
    ) {
      findings.push({
        code: "PARAM_DEVIATION",
        severity: "medium",
        message: `maxDeviationBps ${maxDev} drifts from expected ${this.thresholds.expectedMaxDeviationBps}`,
        observed: maxDev,
        threshold: this.thresholds.expectedMaxDeviationBps,
      });
      severity = maxSeverity(severity, "medium");
    }

    const counterfactual = this.counterfactualFor(severity, findings);
    let proposedAction: ProposedAction | null = null;

    if (severity !== "none" && !state.paused) {
      const { action: selected } = selectRunbook(
        {
          severity,
          findings,
          proposedAction: null,
          counterfactual,
        },
        state.contract,
      );
      proposedAction = selected;
      if (
        proposedAction?.functionName === "setHeartbeat" &&
        state.heartbeatSeconds
      ) {
        proposedAction = {
          ...proposedAction,
          args: [Math.max(state.heartbeatSeconds, 1800).toString()],
        };
      }
      if (proposedAction?.functionName === "setMaxDeviationBps") {
        proposedAction = {
          ...proposedAction,
          args: [this.thresholds.expectedMaxDeviationBps.toString()],
        };
      }
    }

    return { severity, findings, proposedAction, counterfactual };
  }

  private counterfactualFor(
    severity: Severity,
    findings: DriftFinding[],
  ): DriftReport["counterfactual"] {
    if (severity === "none") {
      return {
        expectedLossIfNoAction: "0 (healthy)",
        simulatedImpactOfAction: "n/a",
      };
    }
    if (RANK[severity] >= RANK.high) {
      return {
        expectedLossIfNoAction:
          "Material liquidation / bad-debt risk under continued oracle silence or HF breach",
        simulatedImpactOfAction:
          "Pause or heartbeat repair contains exposure; gas cost only if simulation passes",
      };
    }
    return {
      expectedLossIfNoAction: `Elevated operational risk: ${findings.map((f) => f.code).join(", ")}`,
      simulatedImpactOfAction: "Bounded parameter repair via allowlisted call",
    };
  }
}
