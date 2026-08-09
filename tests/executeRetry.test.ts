import { describe, expect, it, vi } from "vitest";
import { KeeperHubHttpError, KeeperHubProtocolError } from "../src/keeperhub/http.js";
import {
  ReliableExecutor,
  chooseIdempotencyKey,
  fingerprintRequest,
} from "../src/keeperhub/execution.js";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import type { DirectExecutionStatus } from "../src/keeperhub/types.js";

const BODY = {
  contractAddress: "0x0000000000000000000000000000000000000001",
  chainId: 11_155_111,
  functionName: "pause",
  gasLimitMultiplier: "1.2",
};

function completed(executionId = "direct_1") {
  return {
    status: 200,
    data: {
      executionId,
      status: "completed",
      transactionHash: "0xabc",
      transactionLink: "https://sepolia.etherscan.io/tx/0xabc",
      gasUsedWei: "21000",
    } satisfies DirectExecutionStatus,
    meta: { requestId: "req-status", pollIntervalMs: 0 },
  };
}

describe("reliable execution retries", () => {
  it("retries an interrupted identical request with the same body and key", async () => {
    const submissions: Array<{ body: unknown; key: string }> = [];
    const submit = vi.fn(async (body: unknown, key: string) => {
      submissions.push({ body, key });
      if (submissions.length === 1) {
        throw new KeeperHubProtocolError("connection reset", 0, "req-1");
      }
      return {
        status: 202,
        data: { executionId: "direct_1", status: "completed" },
        meta: { requestId: "req-2" },
      };
    });
    const executor = new ReliableExecutor({
      submit,
      getStatus: vi.fn(async () => completed()),
      createIdempotencyKey: () => "intent-key",
      sleep: async () => undefined,
      now: () => 0,
      auditReference: (id) => `https://app.keeperhub.com/api/execute/${id}/status`,
    });

    const result = await executor.execute(BODY, {
      maxSubmissionAttempts: 2,
      pollTimeoutMs: 1,
    });

    expect(result.ok).toBe(true);
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toEqual(submissions[1]);
    expect(result.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idempotencyKey: "intent-key",
          bodyFingerprint: fingerprintRequest(BODY),
          requestId: "req-1",
          retryReason: "transport_interrupted",
        }),
      ]),
    );
  });

  it("honors Retry-After for a bounded same-body retry", async () => {
    const sleeps: number[] = [];
    const keys: string[] = [];
    let calls = 0;
    const submit = vi.fn(async (_body: unknown, key: string) => {
      keys.push(key);
      calls += 1;
      if (calls === 1) {
        throw new KeeperHubHttpError(
          429,
          {
            error: "rate_limited",
            detail: "slow down",
            request_id: "req-rate",
          },
          { retryAfterMs: 2_000, requestId: "req-rate" },
        );
      }
      return {
        status: 202,
        data: { executionId: "direct_1", status: "completed" },
        meta: { requestId: "req-ok" },
      };
    });
    const executor = new ReliableExecutor({
      submit,
      getStatus: vi.fn(async () => completed()),
      createIdempotencyKey: () => "rate-key",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
      auditReference: (id) => `audit:${id}`,
    });

    const result = await executor.execute(BODY, {
      maxSubmissionAttempts: 2,
      maxRetryDelayMs: 5_000,
      pollTimeoutMs: 1,
    });

    expect(result.ok).toBe(true);
    expect(sleeps).toContain(2_000);
    expect(keys).toEqual(["rate-key", "rate-key"]);
    expect(result.attempts[0]).toMatchObject({
      requestId: "req-rate",
      retryReason: "rate_limited",
    });
  });

  it("fails closed on a non-retryable request error", async () => {
    const submit = vi.fn(async () => {
      throw new KeeperHubHttpError(
        403,
        {
          error: "spending_cap_exceeded",
          detail: "daily cap exceeded",
          hint: "Raise the cap or reduce value",
        },
        { requestId: "req-cap" },
      );
    });
    const executor = new ReliableExecutor({
      submit,
      getStatus: vi.fn(),
      createIdempotencyKey: () => "cap-key",
      sleep: async () => undefined,
      now: () => 0,
      auditReference: (id) => `audit:${id}`,
    });

    const result = await executor.execute(BODY);

    expect(result.ok).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.finalError).toContain("spending_cap_exceeded");
  });

  it("applies the same idempotent recovery path to transfers", async () => {
    const client = new KeeperHubClient({
      apiKey: "kh_test",
      chainId: 11_155_111,
    });
    const keys: string[] = [];
    let submissions = 0;
    vi.spyOn(client, "request").mockImplementation(
      async (_method, path, _body, key) => {
        if (path !== "/api/execute/transfer") {
          throw new Error(`unexpected request ${path}`);
        }
        keys.push(String(key));
        submissions += 1;
        if (submissions === 1) {
          throw new KeeperHubProtocolError("socket closed", 0, "req-one");
        }
        return {
          status: 202,
          data: { executionId: "direct_transfer", status: "completed" },
          meta: { requestId: "req-two" },
        };
      },
    );
    vi.spyOn(client, "getDirectExecutionStatusResponse").mockResolvedValue({
      status: 200,
      data: {
        executionId: "direct_transfer",
        status: "completed",
        transactionHash: "0xtransfer",
      },
      meta: { pollIntervalMs: 0 },
    });

    const result = await client.transfer({
      recipientAddress: BODY.contractAddress,
      amount: "0.001",
      idempotencyKey: "transfer-key",
      maxAttempts: 2,
      baseBackoffMs: 0,
    });

    expect("ok" in result && result.ok).toBe(true);
    expect(keys).toEqual(["transfer-key", "transfer-key"]);
    expect("attempts" in result ? result.attempts : []).toHaveLength(2);
  });
});

describe("idempotency key selection", () => {
  it("reuses a key only for the same canonical request body", () => {
    const previous = {
      bodyFingerprint: fingerprintRequest(BODY),
      idempotencyKey: "original-key",
    };
    const create = vi.fn(() => "new-key");

    expect(chooseIdempotencyKey(BODY, previous, create)).toBe("original-key");
    expect(
      chooseIdempotencyKey(
        { ...BODY, gasLimitMultiplier: "1.5" },
        previous,
        create,
      ),
    ).toBe("new-key");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fingerprints semantically identical object key order identically", () => {
    expect(fingerprintRequest({ b: 2, a: 1 })).toBe(
      fingerprintRequest({ a: 1, b: 2 }),
    );
  });
});
