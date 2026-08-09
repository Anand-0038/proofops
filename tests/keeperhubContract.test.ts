import { describe, expect, it, vi } from "vitest";
import { KeeperHubClient } from "../src/keeperhub/client.js";

const CONTRACT = "0x0000000000000000000000000000000000000001";

describe("KeeperHub direct execution request contract", () => {
  it("uses numeric chainId and omits deprecated network", () => {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      chainId: 11_155_111,
    });

    const body = client.buildContractBody(
      {
        contractAddress: CONTRACT,
        functionName: "setHeartbeat",
        functionArgs: [3600],
      },
      true,
    );

    expect(body).toMatchObject({
      contractAddress: CONTRACT,
      chainId: 11_155_111,
      functionName: "setHeartbeat",
      functionArgs: "[3600]",
      simulate: true,
    });
    expect(body).not.toHaveProperty("network");
    expect(typeof body.simulate).toBe("boolean");
  });

  it("keeps simulated and broadcast call intent byte-equivalent", () => {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      chainId: 11_155_111,
    });
    const action = {
      contractAddress: CONTRACT,
      functionName: "setMaxDeviationBps",
      functionArgs: [250],
      abi: '[{"type":"function","name":"setMaxDeviationBps"}]',
      value: "0",
      gasLimitMultiplier: "1.2",
    };

    const simulation = client.buildContractBody(action, true);
    const broadcast = client.buildContractBody(action, false);
    const { simulate: simulationFlag, ...simulatedIntent } = simulation;

    expect(simulationFlag).toBe(true);
    expect(broadcast).not.toHaveProperty("simulate");
    expect(broadcast).toEqual(simulatedIntent);
  });

  it("uses numeric chainId for transfer simulation", async () => {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      chainId: 11_155_111,
    });
    const request = vi.spyOn(client, "request").mockResolvedValue({
      status: 200,
      data: {
        success: true,
        status: "simulated",
        wouldRevert: false,
        gasEstimate: "21000",
      },
      meta: {},
    });

    await client.transfer({
      recipientAddress: CONTRACT,
      amount: "0.001",
      simulate: true,
    });

    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/execute/transfer",
      expect.objectContaining({
        chainId: 11_155_111,
        simulate: true,
      }),
    );
    expect(request.mock.calls[0]?.[2]).not.toHaveProperty("network");
  });
});
