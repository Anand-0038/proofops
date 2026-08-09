import { createHash, randomUUID } from "node:crypto";
import { KeeperHubHttpError, KeeperHubProtocolError } from "./http.js";
import type {
  DirectExecutionStatus,
  ExecutionAttempt,
  ExecutionResult,
  KeeperHubResponse,
} from "./types.js";

interface PreviousIntent {
  bodyFingerprint: string;
  idempotencyKey: string;
}

interface ReliableExecutorDependencies {
  submit: (
    body: Record<string, unknown>,
    idempotencyKey: string,
  ) => Promise<KeeperHubResponse<Record<string, unknown>>>;
  getStatus: (
    executionId: string,
  ) => Promise<KeeperHubResponse<DirectExecutionStatus>>;
  createIdempotencyKey?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  auditReference: (executionId: string) => string;
}

export interface ReliableExecutionOptions {
  idempotencyKey?: string;
  maxSubmissionAttempts?: number;
  baseBackoffMs?: number;
  maxRetryDelayMs?: number;
  pollTimeoutMs?: number;
  minPollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxPolls?: number;
  acceptNoExecution?: (
    data: Record<string, unknown>,
  ) => { status: string } | undefined;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("KeeperHub request body must be JSON serializable");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function fingerprintRequest(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function chooseIdempotencyKey(
  body: unknown,
  previous: PreviousIntent | undefined,
  createKey: () => string = randomUUID,
): string {
  const fingerprint = fingerprintRequest(body);
  if (previous?.bodyFingerprint === fingerprint) {
    return previous.idempotencyKey;
  }
  return createKey();
}

function requestIdFromError(error: unknown): string | undefined {
  if (
    error instanceof KeeperHubHttpError ||
    error instanceof KeeperHubProtocolError
  ) {
    return error.requestId;
  }
  return undefined;
}

function isRetryableSubmissionError(error: unknown): boolean {
  if (error instanceof KeeperHubProtocolError) return true;
  if (!(error instanceof KeeperHubHttpError)) return false;
  return error.status === 429 || error.status >= 500;
}

function retryReason(error: unknown): string {
  if (error instanceof KeeperHubProtocolError) return "transport_interrupted";
  if (error instanceof KeeperHubHttpError && error.status === 429) {
    return "rate_limited";
  }
  if (error instanceof KeeperHubHttpError && error.status >= 500) {
    return "keeperhub_server_error";
  }
  return "submission_rejected";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminal(status: string): boolean {
  return ["completed", "confirmed", "failed", "cancelled"].includes(
    status.toLowerCase(),
  );
}

function successful(status: string): boolean {
  return ["completed", "confirmed"].includes(status.toLowerCase());
}

function boundedDelay(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate =
    value === undefined || !Number.isFinite(value) ? fallback : value;
  if (candidate === 0) return 0;
  return Math.max(minimum, Math.min(maximum, candidate));
}

export class ReliableExecutor {
  private readonly submit: ReliableExecutorDependencies["submit"];
  private readonly getStatus: ReliableExecutorDependencies["getStatus"];
  private readonly createIdempotencyKey: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly auditReference: (executionId: string) => string;

  constructor(dependencies: ReliableExecutorDependencies) {
    this.submit = dependencies.submit;
    this.getStatus = dependencies.getStatus;
    this.createIdempotencyKey =
      dependencies.createIdempotencyKey ?? randomUUID;
    this.sleep =
      dependencies.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = dependencies.now ?? Date.now;
    this.auditReference = dependencies.auditReference;
  }

  async execute(
    body: Record<string, unknown>,
    options: ReliableExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const maxSubmissionAttempts = Math.max(
      1,
      options.maxSubmissionAttempts ?? 4,
    );
    const baseBackoffMs = Math.max(0, options.baseBackoffMs ?? 800);
    const maxRetryDelayMs = Math.max(
      baseBackoffMs,
      options.maxRetryDelayMs ?? 10_000,
    );
    const bodyFingerprint = fingerprintRequest(body);
    const idempotencyKey =
      options.idempotencyKey ?? this.createIdempotencyKey();
    const attempts: ExecutionAttempt[] = [];
    let executionId: string | undefined;

    for (
      let attemptNumber = 1;
      attemptNumber <= maxSubmissionAttempts;
      attemptNumber += 1
    ) {
      const attempt: ExecutionAttempt = {
        attempt: attemptNumber,
        ok: false,
        idempotencyKey,
        bodyFingerprint,
        gasLimitMultiplier:
          typeof body.gasLimitMultiplier === "string"
            ? body.gasLimitMultiplier
            : undefined,
      };

      try {
        const response = await this.submit(body, idempotencyKey);
        attempt.requestId = response.meta?.requestId;
        executionId =
          typeof response.data.executionId === "string"
            ? response.data.executionId
            : undefined;
        attempt.executionId = executionId;
        attempt.status =
          typeof response.data.status === "string"
            ? response.data.status
            : "accepted";
        attempts.push(attempt);

        if (!executionId) {
          const acceptedNoExecution =
            options.acceptNoExecution?.(response.data);
          if (acceptedNoExecution) {
            attempt.ok = true;
            attempt.status = acceptedNoExecution.status;
            return {
              ok: true,
              executed: false,
              executionId: null,
              status: acceptedNoExecution.status,
              txHash: null,
              explorerUrl: null,
              gasUsed: null,
              attempts,
              auditReference: null,
            };
          }
          attempt.error =
            "KeeperHub accepted a write without returning executionId";
          return this.failedResult(attempts, attempt.error);
        }
        break;
      } catch (error) {
        attempt.requestId = requestIdFromError(error);
        attempt.error = errorMessage(error);

        if (
          error instanceof KeeperHubHttpError &&
          error.status === 409 &&
          error.code === "idempotency_in_progress" &&
          typeof error.data.originalExecutionId === "string"
        ) {
          executionId = error.data.originalExecutionId;
          attempt.executionId = executionId;
          attempt.status = "running";
          attempt.retryReason = "idempotency_in_progress_reconciled";
          attempts.push(attempt);
          break;
        }

        const canRetry =
          isRetryableSubmissionError(error) &&
          attemptNumber < maxSubmissionAttempts;
        attempt.retryReason = retryReason(error);
        attempts.push(attempt);
        if (!canRetry) {
          return this.failedResult(attempts, attempt.error);
        }

        const exponentialDelay = Math.min(
          maxRetryDelayMs,
          baseBackoffMs * 2 ** (attemptNumber - 1),
        );
        const delay =
          error instanceof KeeperHubHttpError && error.status === 429
            ? Math.min(
                maxRetryDelayMs,
                error.meta.retryAfterMs ?? exponentialDelay,
              )
            : exponentialDelay;
        await this.sleep(delay);
      }
    }

    if (!executionId) {
      return this.failedResult(
        attempts,
        "KeeperHub execution was not accepted",
      );
    }

    const reconciliation = await this.pollUntilTerminal(
      executionId,
      options,
    );
    const lastAttempt = attempts[attempts.length - 1];
    if (lastAttempt) {
      lastAttempt.executionId = executionId;
      lastAttempt.status = reconciliation.status.status;
      lastAttempt.txHash =
        reconciliation.status.transactionHash ?? undefined;
      lastAttempt.explorerUrl =
        reconciliation.status.transactionLink ?? undefined;
      lastAttempt.gasUsed = reconciliation.status.gasUsedWei ?? undefined;
      lastAttempt.ok = successful(reconciliation.status.status);
      if (reconciliation.reconciledAfterTimeout) {
        lastAttempt.retryReason = "timeout_reconciled_terminal";
      }
      if (!lastAttempt.ok) {
        lastAttempt.error =
          reconciliation.status.error ??
          (reconciliation.timedOut
            ? `Timed out waiting for ${executionId}`
            : `execution_${reconciliation.status.status}`);
      }
    }

    const ok = successful(reconciliation.status.status);
    return {
      ok,
      executed: true,
      executionId,
      status: reconciliation.status.status,
      txHash: reconciliation.status.transactionHash ?? null,
      explorerUrl: reconciliation.status.transactionLink ?? null,
      gasUsed: reconciliation.status.gasUsedWei ?? null,
      attempts,
      finalError: ok ? undefined : lastAttempt?.error,
      auditReference: this.auditReference(executionId),
    };
  }

  private async pollUntilTerminal(
    executionId: string,
    options: ReliableExecutionOptions,
  ): Promise<{
    status: DirectExecutionStatus;
    timedOut: boolean;
    reconciledAfterTimeout: boolean;
  }> {
    const pollTimeoutMs = Math.max(0, options.pollTimeoutMs ?? 60_000);
    const minPollIntervalMs = Math.max(0, options.minPollIntervalMs ?? 250);
    const maxPollIntervalMs = Math.max(
      minPollIntervalMs,
      options.maxPollIntervalMs ?? 10_000,
    );
    const maxPolls = Math.max(1, options.maxPolls ?? 120);
    const startedAt = this.now();
    let last: DirectExecutionStatus | undefined;

    for (let poll = 0; poll < maxPolls; poll += 1) {
      const response = await this.getStatus(executionId);
      last = response.data;
      if (terminal(last.status)) {
        return {
          status: last,
          timedOut: false,
          reconciledAfterTimeout: false,
        };
      }

      const elapsed = this.now() - startedAt;
      const delay = boundedDelay(
        response.meta?.pollIntervalMs,
        1_500,
        minPollIntervalMs,
        maxPollIntervalMs,
      );
      if (elapsed + delay >= pollTimeoutMs) break;
      await this.sleep(delay);
    }

    const finalResponse = await this.getStatus(executionId);
    const reconciled = finalResponse.data;
    if (terminal(reconciled.status)) {
      return {
        status: reconciled,
        timedOut: false,
        reconciledAfterTimeout: true,
      };
    }
    return {
      status: {
        ...reconciled,
        status: "timeout",
        error:
          reconciled.error ??
          `Timed out after ${pollTimeoutMs}ms waiting for ${executionId}`,
      },
      timedOut: true,
      reconciledAfterTimeout: false,
    };
  }

  private failedResult(
    attempts: ExecutionAttempt[],
    finalError: string,
  ): ExecutionResult {
    const last = attempts[attempts.length - 1];
    return {
      ok: false,
      executed: false,
      executionId: last?.executionId ?? null,
      status: last?.status ?? "failed",
      txHash: last?.txHash ?? null,
      explorerUrl: last?.explorerUrl ?? null,
      gasUsed: last?.gasUsed ?? null,
      attempts,
      finalError,
      auditReference: last?.executionId
        ? this.auditReference(last.executionId)
        : null,
    };
  }
}
