import { describe, expect, it, vi } from "vitest";
import {
  buildConditionalRunbookIntent,
  incidentConditionStillMet,
} from "../src/agent/IncidentRunbooks.js";
import { KeeperHubClient } from "../src/keeperhub/client.js";

const CONTRACT = "0x0000000000000000000000000000000000000001";

describe("conditional incident execution", () => {
  it("maps emergency pause to an atomic health-factor check", () => {
    const intent = buildConditionalRunbookIntent({
      contract: CONTRACT,
      functionName: "pause",
      valueWei: "0",
      severity: "high",
      args: [],
    });

    expect(intent).toEqual({
      checkFunctionName: "healthFactorBps",
      checkArgs: [],
      operator: "lt",
      targetValue: "11000",
    });
  });

  it("maps bounded parameter reset to a not-equal recheck", () => {
    expect(
      buildConditionalRunbookIntent({
        contract: CONTRACT,
        functionName: "setMaxDeviationBps",
        valueWei: "0",
        severity: "medium",
        args: ["100"],
      }),
    ).toEqual({
      checkFunctionName: "maxDeviationBps",
      checkArgs: [],
      operator: "neq",
      targetValue: "100",
    });
  });

  it("recognizes when a fallback recheck no longer justifies execution", () => {
    expect(
      incidentConditionStillMet(
        {
          contract: CONTRACT,
          functionName: "pause",
          valueWei: "0",
          severity: "high",
        },
        {
          source: "rpc",
          mockLabeled: false,
          timestamp: "2026-07-30T00:00:00.000Z",
          contract: CONTRACT,
          paused: false,
          healthFactorBps: 12_500,
        },
      ),
    ).toBe(false);
  });

  it("simulates check-and-execute with the current KeeperHub body shape", async () => {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      chainId: 11_155_111,
    });
    const request = vi.spyOn(client, "request").mockResolvedValue({
      status: 200,
      data: {
        success: true,
        status: "simulated",
        executed: true,
        wouldRevert: false,
        conditionResult: {
          met: true,
          observedValue: "10500",
          targetValue: "11000",
          operator: "lt",
        },
      },
      meta: { requestId: "req-sim" },
    });
    const action = {
      contractAddress: CONTRACT,
      functionName: "pause",
      functionArgs: [],
    };
    const intent = {
      checkFunctionName: "healthFactorBps",
      checkArgs: [],
      operator: "lt" as const,
      targetValue: "11000",
    };

    const result = await client.simulateCheckAndExecute(action, intent);

    expect(result.status).toBe("ok");
    expect(result.condition?.met).toBe(true);
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/execute/check-and-execute",
      expect.objectContaining({
        contractAddress: CONTRACT,
        chainId: 11_155_111,
        functionName: "healthFactorBps",
        functionArgs: "[]",
        condition: { operator: "lt", value: "11000" },
        action: expect.objectContaining({
          contractAddress: CONTRACT,
          functionName: "pause",
          functionArgs: "[]",
        }),
        simulate: true,
      }),
    );
  });

  it("returns condition_not_met with zero status polls and no transaction", async () => {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      chainId: 11_155_111,
    });
    vi.spyOn(client, "request").mockResolvedValue({
      status: 200,
      data: {
        executed: false,
        condition: {
          met: false,
          observedValue: "12500",
          targetValue: "11000",
          operator: "lt",
        },
      },
      meta: { requestId: "req-noop" },
    });
    const status = vi.spyOn(client, "getDirectExecutionStatusResponse");

    const result = await client.executeCheckAndExecute(
      {
        contractAddress: CONTRACT,
        functionName: "pause",
        functionArgs: [],
      },
      {
        checkFunctionName: "healthFactorBps",
        checkArgs: [],
        operator: "lt",
        targetValue: "11000",
      },
      { idempotencyKey: "conditional-key" },
    );

    expect(result).toMatchObject({
      ok: true,
      executed: false,
      status: "condition_not_met",
      executionId: null,
      txHash: null,
      condition: {
        met: false,
        observedValue: "12500",
      },
    });
    expect(status).not.toHaveBeenCalled();
  });
});
