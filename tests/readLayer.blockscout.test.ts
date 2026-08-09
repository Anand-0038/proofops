import { describe, it, expect, vi, afterEach } from "vitest";
import { encodeFunctionData, type Hex } from "viem";
import { ReadLayer, INCIDENT_ORACLE_ABI } from "../src/observe/ReadLayer.js";

describe("ReadLayer blockscout fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes eth_call results from Blockscout proxy API", async () => {
    const responses: Record<string, Hex> = {
      heartbeat: encodeFunctionData({
        // use decode path — return abi-encoded uint256 3600
        abi: INCIDENT_ORACLE_ABI,
        functionName: "heartbeat",
      }),
    };
    // Proper return data for uint256(3600), uint256(1), etc via manual encoding
    const u256 = (n: bigint): Hex =>
      `0x${n.toString(16).padStart(64, "0")}` as Hex;
    const boolFalse = u256(0n);

    let call = 0;
    const sequence = [
      u256(3600n), // heartbeat
      u256(1n), // lastUpdated
      u256(2000n), // price
      u256(100n), // maxDeviationBps
      boolFalse, // paused
      u256(10500n), // healthFactorBps
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const result = sequence[call++]!;
        return {
          ok: true,
          json: async () => ({ result }),
        };
      }),
    );

    const layer = new ReadLayer({
      contractAddress: "0x00000000000000000000000000000000000000aa",
      allowMock: false,
      rpcUrl: "http://127.0.0.1:9", // force RPC fail
    });

    // Force RPC failure by mocking readViaRpc path — easiest: spy client
    const state = await (layer as unknown as {
      readViaBlockscout: (a: string) => Promise<unknown>;
    }).readViaBlockscout("0x00000000000000000000000000000000000000aa");

    expect(state).toBeTruthy();
    const s = state as {
      source: string;
      heartbeatSeconds: number;
      healthFactorBps: number;
      paused: boolean;
    };
    expect(s.source).toBe("blockscout");
    expect(s.heartbeatSeconds).toBe(3600);
    expect(s.healthFactorBps).toBe(10500);
    expect(s.paused).toBe(false);
    expect(responses.heartbeat).toBeTruthy(); // silence unused
  });
});
