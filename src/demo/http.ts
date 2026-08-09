import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { redactSecrets } from "../config/env.js";

export class DemoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "DemoHttpError";
  }
}

export function requestId(): string {
  return randomUUID();
}

export function secureHeaders(api = true): Record<string, string> {
  return {
    "Cache-Control": api ? "no-store" : "no-cache",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  correlationId: string,
): void {
  response.writeHead(status, {
    ...secureHeaders(true),
    "Content-Type": "application/json; charset=utf-8",
    "x-request-id": correlationId,
  });
  response.end(`${JSON.stringify(body)}\n`);
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new DemoHttpError(
      415,
      "unsupported_media_type",
      "Mutation endpoints require application/json",
      "Set Content-Type: application/json and send a JSON object.",
    );
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBodyBytes) {
      tooLarge = true;
    } else {
      chunks.push(buffer);
    }
  }
  if (tooLarge) {
    throw new DemoHttpError(
      413,
      "body_too_large",
      `JSON body exceeds ${maxBodyBytes} bytes`,
      "Send only the approval or scenario fields required by this endpoint.",
    );
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("JSON body must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new DemoHttpError(
      400,
      "invalid_json",
      error instanceof Error ? error.message : "Malformed JSON",
      "Send a valid JSON object.",
    );
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hasValidOperatorToken(
  request: IncomingMessage,
  expectedToken: string,
): boolean {
  const authorization = request.headers.authorization;
  const bearer =
    typeof authorization === "string" &&
    authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7)
      : "";
  const header = request.headers["x-proofops-operator-token"];
  const supplied =
    bearer ||
    (typeof header === "string"
      ? header
      : Array.isArray(header)
        ? header[0] ?? ""
        : "");
  return timingSafeEqual(digest(supplied), digest(expectedToken));
}

export function assertMutationAuthorized(input: {
  request: IncomingMessage;
  operatorToken: string;
  allowedOrigins: string[];
}): void {
  if (!hasValidOperatorToken(input.request, input.operatorToken)) {
    throw new DemoHttpError(
      401,
      "operator_auth_required",
      "A valid operator token is required",
      "Use the local operator token file or configured PROOFOPS_OPERATOR_TOKEN.",
    );
  }
  const origin = input.request.headers.origin;
  if (
    typeof origin === "string" &&
    !input.allowedOrigins.includes(origin)
  ) {
    throw new DemoHttpError(
      403,
      "origin_forbidden",
      "Browser mutation origin is not trusted",
      "Use the same-origin dashboard or configure PROOFOPS_ALLOWED_ORIGIN.",
    );
  }
}

export function sendError(
  response: ServerResponse,
  error: unknown,
  correlationId: string,
): void {
  if (error instanceof DemoHttpError) {
    sendJson(
      response,
      error.status,
      {
        error: error.code,
        detail: redactSecrets(error.message),
        hint: error.hint,
        requestId: correlationId,
      },
      correlationId,
    );
    return;
  }
  sendJson(
    response,
    500,
    {
      error: "internal_error",
      detail: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
      hint: "Inspect the local server log using the request ID; credentials are redacted.",
      requestId: correlationId,
    },
    correlationId,
  );
}
