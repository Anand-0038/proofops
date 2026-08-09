import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeBlockscoutMcp } from "../src/observe/blockscoutMcp.js";

const SERVER_INFO = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    serverInfo: { name: "blockscout", version: "1.0.0" },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Blockscout MCP initialize probe", () => {
  it("returns the initialize metadata without waiting for an SSE stream to close", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: message\ndata: ${JSON.stringify(SERVER_INFO)}\n\n`,
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    await expect(
      initializeBlockscoutMcp("https://blockscout.test/mcp", {
        fetchFn,
      }),
    ).resolves.toEqual({ name: "blockscout", version: "1.0.0" });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(cancelled).toBe(true);
  });

  it("accepts a finite JSON initialize response", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify(SERVER_INFO), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      initializeBlockscoutMcp("https://blockscout.test/mcp", { fetchFn }),
    ).resolves.toEqual({ name: "blockscout", version: "1.0.0" });
  });

  it("fails within the configured bound when no initialize event arrives", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const fetchFn = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    await expect(
      initializeBlockscoutMcp("https://blockscout.test/mcp", {
        fetchFn,
        timeoutMs: 20,
      }),
    ).rejects.toThrow("timed out after 20ms");
  });
});
