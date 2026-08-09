import {
  DEFAULT_DRIFT_THRESHOLDS,
  type DriftThresholds,
} from "../observe/DriftDetector.js";
import {
  defaultPolicyConfig,
  type PolicyConfig,
  withTargetContract,
} from "../agent/policy.config.js";
import { env } from "./env.js";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Load drift thresholds from env — no magic numbers at call sites. */
export function loadDriftThresholds(): DriftThresholds {
  return {
    oracleStaleLowSeconds: num(
      "DRIFT_ORACLE_STALE_LOW_SEC",
      DEFAULT_DRIFT_THRESHOLDS.oracleStaleLowSeconds,
    ),
    oracleStaleMediumSeconds: num(
      "DRIFT_ORACLE_STALE_MEDIUM_SEC",
      DEFAULT_DRIFT_THRESHOLDS.oracleStaleMediumSeconds,
    ),
    oracleStaleHighSeconds: num(
      "DRIFT_ORACLE_STALE_HIGH_SEC",
      DEFAULT_DRIFT_THRESHOLDS.oracleStaleHighSeconds,
    ),
    healthFactorMediumBps: num(
      "DRIFT_HF_MEDIUM_BPS",
      DEFAULT_DRIFT_THRESHOLDS.healthFactorMediumBps,
    ),
    healthFactorHighBps: num(
      "DRIFT_HF_HIGH_BPS",
      DEFAULT_DRIFT_THRESHOLDS.healthFactorHighBps,
    ),
    deviationMediumBps: num(
      "DRIFT_DEVIATION_MEDIUM_BPS",
      DEFAULT_DRIFT_THRESHOLDS.deviationMediumBps,
    ),
    expectedMaxDeviationBps: num(
      "DRIFT_EXPECTED_MAX_DEVIATION_BPS",
      DEFAULT_DRIFT_THRESHOLDS.expectedMaxDeviationBps,
    ),
  };
}

export function loadPolicyConfig(): PolicyConfig {
  const base: PolicyConfig = {
    ...defaultPolicyConfig,
    version: env.POLICY_VERSION,
    chainId: env.CHAIN_ID,
    network: env.NETWORK,
    cooldownSeconds: num("POLICY_COOLDOWN_SEC", defaultPolicyConfig.cooldownSeconds),
    globalMaxValueWei:
      process.env.POLICY_GLOBAL_MAX_VALUE_WEI ??
      defaultPolicyConfig.globalMaxValueWei,
  };
  return withTargetContract(base, env.TARGET_CONTRACT_ADDRESS);
}
