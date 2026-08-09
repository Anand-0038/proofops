import { describe, it, expect } from "vitest";
import {
  PolicyEngine,
  fingerprintProposedAction,
} from "../src/agent/PolicyEngine.js";
import { defaultPolicyConfig } from "../src/agent/policy.config.js";

const TARGET = "0x0000000000000000000000000000000000000001";

describe("PolicyEngine", () => {
  it("allows allowlisted call within caps and below approval severity", () => {
    const engine = new PolicyEngine({ config: defaultPolicyConfig });
    const d = engine.decide({
      contract: TARGET,
      functionName: "setHeartbeat",
      valueWei: "0",
      severity: "medium",
    });
    expect(d.verdict).toBe("allowed");
    expect(d.reasonCode).toBe("ALLOWLIST_OK");
  });

  it("blocks non-allowlisted contract/function", () => {
    const engine = new PolicyEngine();
    const d = engine.decide({
      contract: "0xdead000000000000000000000000000000000000",
      functionName: "setHeartbeat",
      valueWei: "0",
      severity: "low",
    });
    expect(d.verdict).toBe("blocked");
    expect(d.reasonCode).toBe("NOT_ALLOWLISTED");
  });

  it("blocks absolute blocked functions even if somehow listed", () => {
    const engine = new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        allowlist: [
          {
            contract: TARGET,
            functionName: "transferOwnership",
            maxValueWei: "0",
            label: "should-still-block",
          },
        ],
      },
    });
    const d = engine.decide({
      contract: TARGET,
      functionName: "transferOwnership",
      valueWei: "0",
      severity: "low",
    });
    expect(d.verdict).toBe("blocked");
    expect(d.reasonCode).toBe("BLOCKED_FUNCTION");
  });

  it("blocks when per-action value cap exceeded", () => {
    const engine = new PolicyEngine();
    const d = engine.decide({
      contract: TARGET,
      functionName: "setHeartbeat",
      valueWei: "1",
      severity: "low",
    });
    expect(d.verdict).toBe("blocked");
    expect(d.reasonCode).toBe("VALUE_CAP_EXCEEDED");
  });

  it("blocks when global value cap exceeded", () => {
    const engine = new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        allowlist: [
          {
            contract: TARGET,
            functionName: "setHeartbeat",
            maxValueWei: "100000000000000000",
            label: "pay-hb",
          },
        ],
        globalMaxValueWei: "10",
      },
    });
    const d = engine.decide({
      contract: TARGET,
      functionName: "setHeartbeat",
      valueWei: "11",
      severity: "low",
    });
    expect(d.verdict).toBe("blocked");
    expect(d.reasonCode).toBe("GLOBAL_CAP_EXCEEDED");
  });

  it("requires approval when severity meets threshold", () => {
    const engine = new PolicyEngine();
    const d = engine.decide({
      contract: TARGET,
      functionName: "pause",
      valueWei: "0",
      severity: "high",
    });
    expect(d.verdict).toBe("approval_required");
    expect(d.reasonCode).toBe("SEVERITY_REQUIRES_APPROVAL");
    expect(d).toMatchObject({
      incidentSeverity: "high",
      approvalRequired: true,
      approvalState: "missing",
    });
  });

  it("allows an exactly bound approval without changing incident severity", () => {
    const engine = new PolicyEngine();
    const action = {
      contract: TARGET,
      functionName: "pause",
      valueWei: "0",
      severity: "critical" as const,
    };

    const d = engine.decide(action, {
      approvalId: "approval-1",
      state: "approved",
      actionFingerprint: fingerprintProposedAction(action),
    });

    expect(d).toMatchObject({
      verdict: "allowed",
      reasonCode: "APPROVAL_SATISFIED",
      incidentSeverity: "critical",
      approvalRequired: true,
      approvalState: "approved",
      approvalId: "approval-1",
    });
  });

  it("blocks a mismatched, expired, rejected, or consumed approval", () => {
    const engine = new PolicyEngine();
    const action = {
      contract: TARGET,
      functionName: "pause",
      valueWei: "0",
      severity: "high" as const,
    };

    expect(
      engine.decide(action, {
        approvalId: "wrong",
        state: "approved",
        actionFingerprint: fingerprintProposedAction({
          ...action,
          functionName: "unpause",
        }),
      }).reasonCode,
    ).toBe("APPROVAL_MISMATCH");

    for (const state of ["expired", "rejected", "consumed"] as const) {
      expect(
        engine.decide(action, {
          approvalId: `approval-${state}`,
          state,
          actionFingerprint: fingerprintProposedAction(action),
        }).verdict,
      ).toBe("blocked");
    }
  });

  it("blocks during cooldown window", () => {
    let now = 1_000_000;
    const engine = new PolicyEngine({
      nowMs: () => now,
      config: { ...defaultPolicyConfig, cooldownSeconds: 60 },
    });
    const action = {
      contract: TARGET,
      functionName: "setHeartbeat",
      valueWei: "0",
      severity: "low" as const,
    };
    expect(engine.decide(action).verdict).toBe("allowed");
    engine.recordExecution(action);
    now += 10_000; // 10s later
    const d = engine.decide(action);
    expect(d.verdict).toBe("blocked");
    expect(d.reasonCode).toBe("COOLDOWN_ACTIVE");
    now += 60_000;
    expect(engine.decide(action).verdict).toBe("allowed");
  });

  it("blocks invalid / empty action", () => {
    const engine = new PolicyEngine();
    const d = engine.decide({
      contract: "",
      functionName: "",
      valueWei: "0",
      severity: "low",
    });
    expect(d.verdict).toBe("blocked");
    expect(d.reasonCode).toBe("INVALID_ACTION");
  });
});
