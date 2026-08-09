import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  KeeperHubStarterClient,
  StarterApiError,
  runStarterPreflight,
  type TransferIntent,
} from "../keeperhub-first-reliable-tx/src/keeperhub.js";

const INTENT: TransferIntent = {
  chainId: 11155111,
  recipientAddress: "0x0000000000000000000000000000000000000001",
  amount: "0.000001",
};

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("first reliable KeeperHub transaction starter", () => {
  it("preflights the current chains, organization wallet, and funding APIs without exposing the key", async () => {
    const fetchFn = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/chains") {
        return json([
          {
            chainId: 11155111,
            name: "Sepolia",
            isTestnet: true,
            isEnabled: true,
          },
        ]);
      }
      if (path === "/api/user/wallet") {
        return json({
          data: {
            hasWallet: true,
            walletAddress: INTENT.recipientAddress,
            organizationId: "org_proofops",
            isActive: true,
          },
        });
      }
      if (path === "/api/user/wallet/balances") {
        return json({
          balances: [
            {
              chainId: 11155111,
              symbol: "ETH",
              balanceWei: "1000000000000000",
            },
          ],
        });
      }
      if (path === "/api/execute/transfer") {
        return json({
          success: true,
          status: "simulated",
          wouldRevert: false,
          gasEstimate: "21000",
        });
      }
      throw new Error(`unexpected ${path}`);
    });
    const apiKey = "kh_test_redaction_value_only";
    const client = new KeeperHubStarterClient({
      apiKey,
      fetchFn,
    });

    const checks = await runStarterPreflight({
      client,
      apiKey,
      chainId: 11155111,
      nodeVersion: "v20.19.0",
    });

    expect(checks.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(checks)).not.toContain(apiKey);
    expect(fetchFn.mock.calls.map(([input]) => new URL(String(input)).pathname))
      .toEqual([
        "/api/chains",
        "/api/user/wallet",
        "/api/user/wallet/balances",
        "/api/execute/transfer",
      ]);
  });

  it("simulates and broadcasts the identical numeric-chain intent, then honors poll hints", async () => {
    const calls: Array<{
      path: string;
      body?: Record<string, unknown>;
      key?: string | null;
    }> = [];
    const sleeps: number[] = [];
    let statusPoll = 0;
    const fetchFn = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = new URL(String(input)).pathname;
        calls.push({
          path,
          body: init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : undefined,
          key: new Headers(init?.headers).get("Idempotency-Key"),
        });
        if (path === "/api/execute/transfer" && calls.length === 1) {
          return json({
            success: true,
            status: "simulated",
            wouldRevert: false,
            gasEstimate: "21000",
          });
        }
        if (path === "/api/execute/transfer") {
          return json({ executionId: "direct_first", status: "running" }, 202);
        }
        statusPoll += 1;
        return statusPoll === 1
          ? json(
              { executionId: "direct_first", status: "running" },
              200,
              { "X-Poll-Interval-Hint": "1.25" },
            )
          : json(
              {
                executionId: "direct_first",
                status: "completed",
                transactionHash: `0x${"a".repeat(64)}`,
                transactionLink: `https://sepolia.etherscan.io/tx/0x${"a".repeat(64)}`,
              },
              200,
              { "X-Poll-Interval-Hint": "0" },
            );
      },
    );
    const client = new KeeperHubStarterClient({
      apiKey: "kh_test",
      fetchFn,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    const receipt = await client.safeFirstTransfer(
      INTENT,
      "first-transfer-idempotency-key",
    );

    const simulation = calls[0]!.body!;
    const broadcast = calls[1]!.body!;
    expect(simulation.simulate).toBe(true);
    const { simulate: _simulate, ...simulatedIntent } = simulation;
    expect(broadcast).toEqual(simulatedIntent);
    expect(broadcast.chainId).toBe(11155111);
    expect(broadcast).not.toHaveProperty("network");
    expect(calls[1]!.key).toBe("first-transfer-idempotency-key");
    expect(sleeps).toEqual([1_250]);
    expect(receipt).toMatchObject({
      evidenceMode: "live",
      status: "completed",
      executionId: "direct_first",
      confirmed: true,
    });
  });

  it("retries an interrupted broadcast with the exact same body and idempotency key", async () => {
    const broadcasts: Array<{ body: string; key: string | null }> = [];
    let executeAttempt = 0;
    const fetchFn = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/execute/transfer" && !init?.body) {
          throw new Error("unexpected empty body");
        }
        const body = String(init?.body ?? "");
        const parsed = body
          ? (JSON.parse(body) as Record<string, unknown>)
          : {};
        if (path === "/api/execute/transfer" && parsed.simulate === true) {
          return json({
            success: true,
            status: "simulated",
            wouldRevert: false,
          });
        }
        if (path === "/api/execute/transfer") {
          broadcasts.push({
            body,
            key: new Headers(init?.headers).get("Idempotency-Key"),
          });
          executeAttempt += 1;
          if (executeAttempt === 1) throw new TypeError("connection reset");
          return json({ executionId: "direct_retry", status: "completed" }, 202);
        }
        return json({
          executionId: "direct_retry",
          status: "completed",
          transactionHash: `0x${"b".repeat(64)}`,
          transactionLink: `https://sepolia.etherscan.io/tx/0x${"b".repeat(64)}`,
        });
      },
    );
    const client = new KeeperHubStarterClient({
      apiKey: "kh_test",
      fetchFn,
      sleep: async () => {},
    });

    await client.safeFirstTransfer(INTENT, "stable-key");

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]).toEqual(broadcasts[1]);
  });

  it("normalizes envelopes and turns funding/cap failures into next actions", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { hasWallet: false } }))
      .mockResolvedValueOnce(
        json(
          {
            error: "spending_cap_exceeded",
            detail: "Daily spending cap exceeded",
            request_id: "req_cap",
          },
          403,
        ),
      );
    const client = new KeeperHubStarterClient({
      apiKey: "kh_test",
      fetchFn,
    });

    expect(await client.getWallet()).toEqual({ hasWallet: false });
    await expect(client.simulateTransfer(INTENT)).rejects.toMatchObject({
      name: "StarterApiError",
      code: "spending_cap_exceeded",
      requestId: "req_cap",
      nextAction: expect.stringContaining("spending cap"),
    } satisfies Partial<StarterApiError>);
  });

  it("keeps fixture mode explicit and incapable of producing a live receipt", () => {
    const firstTx = readFileSync(
      "keeperhub-first-reliable-tx/scripts/first-tx.ts",
      "utf8",
    );
    const preflight = readFileSync(
      "keeperhub-first-reliable-tx/scripts/preflight.ts",
      "utf8",
    );

    expect(firstTx).toContain("--fixture");
    expect(firstTx).toContain('evidenceMode: "fixture"');
    expect(firstTx).toContain("FIXTURE — NO TRANSACTION BROADCAST");
    expect(firstTx).not.toContain('network: "sepolia"');
    expect(preflight).toContain("/api/chains");
    expect(preflight).toContain("set (value never printed)");
  });
});
