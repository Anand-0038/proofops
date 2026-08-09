import { describe, it, expect } from "vitest";
import {
  DriftDetector,
  DEFAULT_DRIFT_THRESHOLDS,
} from "../src/observe/DriftDetector.js";
import type { ObservedState } from "../src/observe/ReadLayer.js";

function baseState(over: Partial<ObservedState> = {}): ObservedState {
  return {
    source: "mock",
    mockLabeled: true,
    timestamp: new Date().toISOString(),
    contract: "0x0000000000000000000000000000000000000001",
    heartbeatSeconds: 3600,
    lastUpdated: Math.floor(Date.now() / 1000),
    oracleAgeSeconds: 0,
    price: "2000",
    maxDeviationBps: 100,
    paused: false,
    healthFactorBps: 15000,
    ...over,
  };
}

describe("DriftDetector", () => {
  it("returns none for healthy state", () => {
    const d = new DriftDetector();
    const r = d.classify(baseState());
    expect(r.severity).toBe("none");
    expect(r.proposedAction).toBeNull();
  });

  it("flags medium oracle staleness with configurable threshold", () => {
    const d = new DriftDetector({
      ...DEFAULT_DRIFT_THRESHOLDS,
      oracleStaleMediumSeconds: 1000,
      oracleStaleHighSeconds: 10_000,
    });
    const r = d.classify(baseState({ oracleAgeSeconds: 2000 }));
    expect(r.severity).toBe("medium");
    expect(r.findings.some((f) => f.code === "ORACLE_STALE_MEDIUM")).toBe(true);
    expect(r.proposedAction?.functionName).toBe("setHeartbeat");
  });

  it("flags high health-factor breach → pause proposal", () => {
    const d = new DriftDetector();
    const r = d.classify(baseState({ healthFactorBps: 10000 }));
    expect(r.severity).toBe("high");
    expect(r.proposedAction?.functionName).toBe("pause");
  });

  it("does not propose action when already paused", () => {
    const d = new DriftDetector();
    const r = d.classify(
      baseState({ paused: true, healthFactorBps: 9000, oracleAgeSeconds: 99999 }),
    );
    expect(r.proposedAction).toBeNull();
  });

  it("includes counterfactual fields", () => {
    const d = new DriftDetector();
    const r = d.classify(baseState({ healthFactorBps: 9000 }));
    expect(r.counterfactual.expectedLossIfNoAction.length).toBeGreaterThan(0);
    expect(r.counterfactual.simulatedImpactOfAction.length).toBeGreaterThan(0);
  });
});
