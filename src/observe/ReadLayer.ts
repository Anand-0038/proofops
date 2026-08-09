import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  parseAbi,
  encodeFunctionData,
  decodeFunctionResult,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { env } from "../config/env.js";

/** Incident oracle / parameter surface we monitor. */
export const INCIDENT_ORACLE_ABI = parseAbi([
  "function heartbeat() view returns (uint256)",
  "function lastUpdated() view returns (uint256)",
  "function price() view returns (uint256)",
  "function maxDeviationBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "function healthFactorBps() view returns (uint256)",
]);

export interface ObservedState {
  source: "rpc" | "blockscout" | "mock";
  mockLabeled: boolean;
  timestamp: string;
  blockNumber?: string;
  contract: string;
  heartbeatSeconds?: number;
  lastUpdated?: number;
  oracleAgeSeconds?: number;
  price?: string;
  maxDeviationBps?: number;
  paused?: boolean;
  healthFactorBps?: number;
  raw?: Record<string, unknown>;
}

export interface ReadLayerOptions {
  rpcUrl?: string;
  contractAddress?: string;
  blockscoutApiUrl?: string;
  /** Force mock when no contract deployed yet. */
  allowMock?: boolean;
}

/**
 * Independent read layer. Never writes. Prefer Blockscout API / RPC —
 * KeeperHub is execute-only for this agent.
 */
export class ReadLayer {
  private readonly client: PublicClient;
  private readonly contractAddress: string;
  private readonly blockscoutApiUrl: string;
  private readonly allowMock: boolean;

  constructor(options: ReadLayerOptions = {}) {
    const rpcUrl = options.rpcUrl ?? env.RPC_URL;
    this.contractAddress =
      options.contractAddress ?? env.TARGET_CONTRACT_ADDRESS ?? "";
    this.blockscoutApiUrl =
      options.blockscoutApiUrl ?? env.BLOCKSCOUT_API_URL;
    this.allowMock = options.allowMock ?? true;

    this.client = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });
  }

  async readLiveState(): Promise<ObservedState> {
    if (!this.contractAddress) {
      return this.mockState("no TARGET_CONTRACT_ADDRESS configured");
    }

    try {
      return await this.readViaRpc(this.contractAddress as Address);
    } catch (rpcErr) {
      try {
        const viaBs = await this.readViaBlockscout(this.contractAddress);
        if (viaBs) return viaBs;
      } catch (bsErr) {
        console.warn(
          `[blockscout] fallback failed: ${bsErr instanceof Error ? bsErr.message : bsErr}`,
        );
      }
      if (this.allowMock) {
        return this.mockState(
          `RPC+Blockscout failed: ${rpcErr instanceof Error ? rpcErr.message : String(rpcErr)}`,
        );
      }
      throw rpcErr;
    }
  }

  private async readViaRpc(address: Address): Promise<ObservedState> {
    const now = Math.floor(Date.now() / 1000);
    const blockNumber = await this.client.getBlockNumber();

    const [heartbeat, lastUpdated, price, maxDeviationBps, paused, healthFactorBps] =
      await Promise.all([
        this.client.readContract({
          address,
          abi: INCIDENT_ORACLE_ABI,
          functionName: "heartbeat",
        }),
        this.client.readContract({
          address,
          abi: INCIDENT_ORACLE_ABI,
          functionName: "lastUpdated",
        }),
        this.client.readContract({
          address,
          abi: INCIDENT_ORACLE_ABI,
          functionName: "price",
        }),
        this.client.readContract({
          address,
          abi: INCIDENT_ORACLE_ABI,
          functionName: "maxDeviationBps",
        }),
        this.client.readContract({
          address,
          abi: INCIDENT_ORACLE_ABI,
          functionName: "paused",
        }),
        this.client.readContract({
          address,
          abi: INCIDENT_ORACLE_ABI,
          functionName: "healthFactorBps",
        }),
      ]);

    const last = Number(lastUpdated);
    return {
      source: "rpc",
      mockLabeled: false,
      timestamp: new Date().toISOString(),
      blockNumber: blockNumber.toString(),
      contract: address,
      heartbeatSeconds: Number(heartbeat),
      lastUpdated: last,
      oracleAgeSeconds: Math.max(0, now - last),
      price: price.toString(),
      maxDeviationBps: Number(maxDeviationBps),
      paused: Boolean(paused),
      healthFactorBps: Number(healthFactorBps),
    };
  }

  /**
   * Blockscout eth_call fallback (read-only).
   * Uses module=proxy&action=eth_call for each view function, then ABI-decodes.
   */
  private async readViaBlockscout(
    address: string,
  ): Promise<ObservedState | null> {
    const fns = [
      "heartbeat",
      "lastUpdated",
      "price",
      "maxDeviationBps",
      "paused",
      "healthFactorBps",
    ] as const;

    const results: Record<string, unknown> = {};
    for (const fn of fns) {
      const data = encodeFunctionData({
        abi: INCIDENT_ORACLE_ABI,
        functionName: fn,
      });
      const url =
        `${this.blockscoutApiUrl}?module=proxy&action=eth_call` +
        `&to=${address}&data=${data}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const body = (await res.json()) as {
        result?: string;
        error?: { message?: string };
      };
      if (!body.result || body.result === "0x") return null;
      const decoded = decodeFunctionResult({
        abi: INCIDENT_ORACLE_ABI,
        functionName: fn,
        data: body.result as Hex,
      });
      results[fn] = decoded;
    }

    const now = Math.floor(Date.now() / 1000);
    const last = Number(results.lastUpdated);
    return {
      source: "blockscout",
      mockLabeled: false,
      timestamp: new Date().toISOString(),
      contract: address,
      heartbeatSeconds: Number(results.heartbeat),
      lastUpdated: last,
      oracleAgeSeconds: Math.max(0, now - last),
      price: String(results.price),
      maxDeviationBps: Number(results.maxDeviationBps),
      paused: Boolean(results.paused),
      healthFactorBps: Number(results.healthFactorBps),
      raw: { blockscout: true },
    };
  }

  private mockState(reason: string): ObservedState {
    const now = Math.floor(Date.now() / 1000);
    const lastUpdated = now - 7200;
    console.warn(`[MOCK] ReadLayer using synthetic state: ${reason}`);
    return {
      source: "mock",
      mockLabeled: true,
      timestamp: new Date().toISOString(),
      contract: this.contractAddress || "0x0000000000000000000000000000000000000001",
      heartbeatSeconds: 3600,
      lastUpdated,
      oracleAgeSeconds: 7200,
      price: "200000000000",
      maxDeviationBps: 100,
      paused: false,
      healthFactorBps: 10500,
      raw: { mockReason: reason },
    };
  }
}
