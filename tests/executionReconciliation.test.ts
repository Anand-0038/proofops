import { describe, expect, it, vi } from "vitest";
import { KeeperHubHttpError } from "../src/keeperhub/http.js";
import { ReliableExecutor } from "../src/keeperhub/execution.js";
import type { DirectExecutionStatus } from "../src/keeperhub/types.js";

const BODY = {
  contractAddress: "0x0000000000000000000000000000000000000001",
  chainId: 11_155_111,
  functionName: "pause",
};

function status(
  value: string,
  options: {
    executionId?: string;
    pollIntervalMs?: number;
    txHash?: string;
  } = {},
) {
  const executionId = options.executionId ?? "direct_1";
  return {
    status: 200,
    data: {
      executionId,
      status: value,
      transactionHash: options.txHash,
      transactionLink: options.txHash
        ? `https://sepolia.etherscan.io/tx/${options.txHash}`
        : undefined,
    } satisfies DirectExecutionStatus,
    meta: {
      requestId: `req-${value}`,
      pollIntervalMs: options.pollIntervalMs,
    },
  };
}

describe("execution reconciliation", () => {
  it("polls the original execution on idempotency_in_progress", async () => {
    const submit = vi.fn(async () => {
      throw new KeeperHubHttpError(
        409,
        {
          error: "idempotency_in_progress",
          detail: "original request is running",
          originalExecutionId: "direct_original",
        },
        { requestId: "req-conflict" },
      );
    });
    const executor = new ReliableExecutor({
      submit,
      getStatus: vi.fn(async () =>
        status("completed", {
          executionId: "direct_original",
          pollIntervalMs: 0,
          txHash: "0xoriginal",
        }),
      ),
      createIdempotencyKey: () => "intent-key",
      sleep: async () => undefined,
      now: () => 0,
      auditReference: (id) => `audit:${id}`,
    });

    const result = await executor.execute(BODY);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      executionId: "direct_original",
      txHash: "0xoriginal",
      auditReference: "audit:direct_original",
    });
    expect(result.attempts[0]).toMatchObject({
      retryReason: "idempotency_in_progress_reconciled",
      requestId: "req-conflict",
    });
  });

  it("uses KeeperHub poll hints and stops at a terminal status", async () => {
    const sleeps: number[] = [];
    const clock = { value: 0 };
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(status("running", { pollIntervalMs: 3_000 }))
      .mockResolvedValueOnce(
        status("completed", { pollIntervalMs: 0, txHash: "0xdone" }),
      );
    const executor = new ReliableExecutor({
      submit: vi.fn(async () => ({
        status: 202,
        data: { executionId: "direct_1", status: "running" },
        meta: { requestId: "req-submit" },
      })),
      getStatus,
      createIdempotencyKey: () => "intent-key",
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.value += ms;
      },
      now: () => clock.value,
      auditReference: (id) => `audit:${id}`,
    });

    const result = await executor.execute(BODY, { pollTimeoutMs: 10_000 });

    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([3_000]);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("performs a final reconciliation after timeout without resubmitting", async () => {
    const clock = { value: 0 };
    const submit = vi.fn(async () => ({
      status: 202,
      data: { executionId: "direct_1", status: "running" },
      meta: { requestId: "req-submit" },
    }));
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(status("running", { pollIntervalMs: 2_000 }))
      .mockResolvedValueOnce(
        status("completed", { pollIntervalMs: 0, txHash: "0xlate" }),
      );
    const executor = new ReliableExecutor({
      submit,
      getStatus,
      createIdempotencyKey: () => "intent-key",
      sleep: async (ms) => {
        clock.value += ms;
      },
      now: () => clock.value,
      auditReference: (id) => `audit:${id}`,
    });

    const result = await executor.execute(BODY, { pollTimeoutMs: 1_000 });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      txHash: "0xlate",
    });
    expect(result.attempts[0]?.retryReason).toBe(
      "timeout_reconciled_terminal",
    );
  });

  it.each(["failed", "cancelled"])(
    "treats %s as terminal and never resubmits",
    async (terminal) => {
      const submit = vi.fn(async () => ({
        status: 202,
        data: { executionId: "direct_1", status: "running" },
        meta: { requestId: "req-submit" },
      }));
      const executor = new ReliableExecutor({
        submit,
        getStatus: vi.fn(async () =>
          status(terminal, { pollIntervalMs: 0 }),
        ),
        createIdempotencyKey: () => "intent-key",
        sleep: async () => undefined,
        now: () => 0,
        auditReference: (id) => `audit:${id}`,
      });

      const result = await executor.execute(BODY);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(terminal);
      expect(submit).toHaveBeenCalledTimes(1);
    },
  );
});
