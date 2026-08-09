import { describe, it, expect } from "vitest";
import {
  selectRunbook,
  listRunbookToolDescriptors,
  INCIDENT_RUNBOOKS,
} from "../src/agent/IncidentRunbooks.js";
import type { DriftReport } from "../src/observe/DriftDetector.js";
import { getIncidentMcpTools } from "../src/mcp/tools.js";
import { verifyPostState } from "../src/observe/verifyPostState.js";
import type { ObservedState } from "../src/observe/ReadLayer.js";

const contract = "0x0000000000000000000000000000000000000001";

function drift(partial: Partial<DriftReport> & Pick<DriftReport, "severity" | "findings">): DriftReport {
  return {
    proposedAction: null,
    counterfactual: {
      expectedLossIfNoAction: "x",
      simulatedImpactOfAction: "y",
    },
    ...partial,
  };
}

describe("IncidentRunbooks", () => {
  it("selects pause for high HF breach", () => {
    const { runbook, action } = selectRunbook(
      drift({
        severity: "high",
        findings: [
          {
            code: "HEALTH_FACTOR_BREACH",
            severity: "high",
            message: "hf low",
            observed: 10000,
            threshold: 11000,
          },
        ],
      }),
      contract,
    );
    expect(runbook?.id).toBe("incident.pause");
    expect(action?.functionName).toBe("pause");
  });

  it("selects heartbeat repair for stale oracle", () => {
    const { runbook, action } = selectRunbook(
      drift({
        severity: "medium",
        findings: [
          {
            code: "ORACLE_STALE_MEDIUM",
            severity: "medium",
            message: "stale",
            observed: 8000,
            threshold: 7200,
          },
        ],
      }),
      contract,
    );
    expect(runbook?.id).toBe("incident.repair_heartbeat");
    expect(action?.functionName).toBe("setHeartbeat");
    expect(typeof action?.args?.[0]).toBe("string");
  });

  it("exposes MCP tool descriptors for every runbook", () => {
    const tools = listRunbookToolDescriptors();
    expect(tools.length).toBe(Object.keys(INCIDENT_RUNBOOKS).length);
    const all = getIncidentMcpTools();
    expect(all.some((t) => t.name === "incident_run_cycle")).toBe(true);
    expect(all.length).toBeGreaterThan(tools.length);
  });
});

describe("verifyPostState", () => {
  const pre: ObservedState = {
    source: "mock",
    mockLabeled: true,
    timestamp: new Date().toISOString(),
    contract,
    heartbeatSeconds: 3600,
    lastUpdated: 100,
    paused: false,
    maxDeviationBps: 200,
  };

  it("verifies pause", () => {
    const post = { ...pre, paused: true };
    const v = verifyPostState(pre, post, {
      contract,
      functionName: "pause",
      valueWei: "0",
      severity: "high",
    });
    expect(v.ok).toBe(true);
  });

  it("fails when pause did not stick", () => {
    const v = verifyPostState(pre, pre, {
      contract,
      functionName: "pause",
      valueWei: "0",
      severity: "high",
    });
    expect(v.ok).toBe(false);
  });

  it("verifies heartbeat arg", () => {
    const post = { ...pre, heartbeatSeconds: 1800, lastUpdated: 200 };
    const v = verifyPostState(pre, post, {
      contract,
      functionName: "setHeartbeat",
      valueWei: "0",
      args: ["1800"],
      severity: "medium",
    });
    expect(v.ok).toBe(true);
  });
});
