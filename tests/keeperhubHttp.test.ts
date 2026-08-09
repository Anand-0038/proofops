import { describe, expect, it, vi } from "vitest";
import {
  KeeperHubHttp,
  KeeperHubHttpError,
  KeeperHubProtocolError,
} from "../src/keeperhub/http.js";
import type { KeeperHubFetch } from "../src/keeperhub/types.js";

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

describe("KeeperHubHttp", () => {
  it.each([
    [{ executionId: "direct_1" }, { executionId: "direct_1" }],
    [{ data: { executionId: "direct_1" } }, { executionId: "direct_1" }],
  ])("normalizes plain and data-envelope success bodies", async (body, expected) => {
    const fetchFn = vi.fn(async () => jsonResponse(body));
    const http = new KeeperHubHttp({
      apiKey: "kh_test",
      apiUrl: "https://app.keeperhub.com",
      fetchFn,
    });

    const result = await http.request("GET", "/api/example");

    expect(result.data).toEqual(expected);
  });

  it("captures correlation, polling, retry, and rate-limit metadata", async () => {
    const fetchFn = vi.fn<KeeperHubFetch>(
      async () =>
        jsonResponse(
          { executionId: "direct_1" },
          {
            headers: {
              "x-request-id": "req-server",
              "x-poll-interval-hint": "2.5",
              "retry-after": "7",
              "x-ratelimit-limit": "60",
              "x-ratelimit-remaining": "42",
              "x-ratelimit-reset": "1770000000",
            },
          },
        ),
    );
    const http = new KeeperHubHttp({
      apiKey: "kh_test",
      apiUrl: "https://app.keeperhub.com",
      fetchFn,
      createRequestId: () => "req-client",
    });

    const result = await http.request("GET", "/api/example");
    const request = fetchFn.mock.calls[0]?.[1] as RequestInit;

    expect(new Headers(request.headers).get("x-request-id")).toBe("req-client");
    expect(result.meta).toEqual({
      requestId: "req-server",
      pollIntervalMs: 2_500,
      retryAfterMs: 7_000,
      rateLimit: {
        limit: 60,
        remaining: 42,
        resetEpochSeconds: 1_770_000_000,
      },
    });
  });

  it("preserves structured error fields and redacts credentials", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: "wallet_not_configured",
          detail: "Bearer kh_super_secret has no wallet",
          hint: "Provision an organization wallet",
          docs: "https://docs.keeperhub.com/wallets",
          request_id: "req-body",
        },
        {
          status: 422,
          headers: { "x-request-id": "req-header" },
        },
      ),
    );
    const http = new KeeperHubHttp({
      apiKey: "kh_super_secret",
      apiUrl: "https://app.keeperhub.com",
      fetchFn,
    });

    const error = await http
      .request("POST", "/api/execute/contract-call", {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KeeperHubHttpError);
    expect(error).toMatchObject({
      status: 422,
      code: "wallet_not_configured",
      hint: "Provision an organization wallet",
      docs: "https://docs.keeperhub.com/wallets",
      requestId: "req-body",
    });
    expect(String(error)).not.toContain("kh_super_secret");
    expect((error as KeeperHubHttpError).detail).not.toContain("kh_super_secret");
  });

  it("rejects malformed successful JSON as a protocol error", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("{ definitely-not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const http = new KeeperHubHttp({
      apiKey: "kh_test",
      apiUrl: "https://app.keeperhub.com",
      fetchFn,
    });

    await expect(http.request("GET", "/api/example")).rejects.toBeInstanceOf(
      KeeperHubProtocolError,
    );
  });

  it("never exposes the authorization header in a network failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("request failed with Authorization: Bearer kh_leaked");
    });
    const http = new KeeperHubHttp({
      apiKey: "kh_leaked",
      apiUrl: "https://app.keeperhub.com",
      fetchFn,
    });

    await expect(http.request("GET", "/api/example")).rejects.not.toThrow(
      /kh_leaked/,
    );
  });
});
