import { randomUUID } from "node:crypto";
import { redactSecrets } from "../config/env.js";
import type {
  KeeperHubErrorBody,
  KeeperHubFetch,
  KeeperHubRateLimit,
  KeeperHubResponse,
  KeeperHubResponseMeta,
} from "./types.js";

function finiteNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function secondsHeaderToMs(value: string | null): number | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined || seconds < 0) return undefined;
  return Math.round(seconds * 1_000);
}

function retryAfterToMs(value: string | null, now: () => number): number | undefined {
  const seconds = secondsHeaderToMs(value);
  if (seconds !== undefined) return seconds;
  if (!value) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
}

function responseMeta(headers: Headers, now: () => number): KeeperHubResponseMeta {
  const limit = finiteNumber(headers.get("x-ratelimit-limit"));
  const remaining = finiteNumber(headers.get("x-ratelimit-remaining"));
  const resetEpochSeconds = finiteNumber(headers.get("x-ratelimit-reset"));
  const rateLimit: KeeperHubRateLimit | undefined =
    limit === undefined &&
    remaining === undefined &&
    resetEpochSeconds === undefined
      ? undefined
      : { limit, remaining, resetEpochSeconds };

  return {
    requestId: headers.get("x-request-id") ?? undefined,
    pollIntervalMs: secondsHeaderToMs(
      headers.get("x-poll-interval-hint"),
    ),
    retryAfterMs: retryAfterToMs(headers.get("retry-after"), now),
    rateLimit,
  };
}

function asErrorBody(value: unknown): KeeperHubErrorBody {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as KeeperHubErrorBody;
  }
  return { detail: typeof value === "string" ? value : JSON.stringify(value) };
}

function normalizeSuccess<T>(value: unknown): T {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "data")
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export class KeeperHubProtocolError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(redactSecrets(message));
    this.name = "KeeperHubProtocolError";
    this.status = status;
    this.requestId = requestId;
  }
}

export class KeeperHubHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly hint?: string;
  readonly docs?: string;
  readonly requestId?: string;
  readonly data: KeeperHubErrorBody;
  readonly meta: KeeperHubResponseMeta;

  constructor(
    status: number,
    body: KeeperHubErrorBody,
    meta: KeeperHubResponseMeta,
  ) {
    const code =
      typeof body.error === "string" && body.error.length > 0
        ? body.error
        : `http_${status}`;
    const detail = redactSecrets(
      String(body.detail ?? body.details ?? body.error ?? "Unknown error"),
    );
    const hint =
      typeof body.hint === "string" ? redactSecrets(body.hint) : undefined;
    const requestId =
      typeof body.request_id === "string"
        ? body.request_id
        : meta.requestId;
    super(
      redactSecrets(
        `KeeperHub ${code} (${status}): ${detail}${
          hint ? ` Recovery: ${hint}` : ""
        }${requestId ? ` Request ID: ${requestId}` : ""}`,
      ),
    );
    this.name = "KeeperHubHttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.hint = hint;
    this.docs = typeof body.docs === "string" ? body.docs : undefined;
    this.requestId = requestId;
    this.data = {
      ...body,
      detail,
      details:
        typeof body.details === "string"
          ? redactSecrets(body.details)
          : body.details,
      hint,
    };
    this.meta = meta;
  }
}

export class KeeperHubHttp {
  readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: KeeperHubFetch;
  private readonly createRequestId: () => string;
  private readonly now: () => number;

  constructor(options: {
    apiKey: string;
    apiUrl: string;
    fetchFn?: KeeperHubFetch;
    createRequestId?: () => string;
    now?: () => number;
  }) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.createRequestId = options.createRequestId ?? randomUUID;
    this.now = options.now ?? Date.now;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: {
      idempotencyKey?: string;
      requestId?: string;
    },
  ): Promise<KeeperHubResponse<T>> {
    const requestId = (options?.requestId ?? this.createRequestId()).slice(0, 128);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-request-id": requestId,
    };
    if (options?.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      throw new KeeperHubProtocolError(
        `KeeperHub network request failed: ${message}`,
        0,
        requestId,
      );
    }

    const meta = responseMeta(response.headers, this.now);
    const text = await response.text();
    let parsed: unknown = {};
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new KeeperHubProtocolError(
          `KeeperHub returned malformed JSON (HTTP ${response.status})`,
          response.status,
          meta.requestId ?? requestId,
        );
      }
    }

    if (!response.ok) {
      throw new KeeperHubHttpError(
        response.status,
        asErrorBody(parsed),
        meta,
      );
    }

    return {
      status: response.status,
      data: normalizeSuccess<T>(parsed),
      meta,
    };
  }
}
