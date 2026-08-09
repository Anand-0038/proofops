import { describe, expect, it, vi } from "vitest";
import {
  KeeperHubMcpClient,
  KeeperHubMcpError,
} from "../src/keeperhub/mcp.js";

function jsonRpc(
  result: unknown,
  id: number,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("KeeperHub MCP discovery", () => {
  it("initializes a session and lists the real KeeperHub tool inventory", async () => {
    const calls: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ body, headers: new Headers(init?.headers) });
      if (body.method === "initialize") {
        return jsonRpc(
          {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "KeeperHub", version: "1.2.3" },
            capabilities: { tools: {} },
          },
          1,
          { "mcp-session-id": "session-proofops" },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      return jsonRpc(
        {
          tools: [
            {
              name: "search_workflows",
              description: "Search listed workflows",
              inputSchema: { type: "object" },
            },
            {
              name: "call_workflow",
              description: "Call a listed workflow",
              inputSchema: { type: "object" },
            },
          ],
        },
        2,
      );
    });
    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_test_mcp",
      fetchFn,
    });

    const discovery = await client.discoverTools();

    expect(discovery).toMatchObject({
      serverName: "KeeperHub",
      serverVersion: "1.2.3",
      protocolVersion: "2025-06-18",
      sessionId: "session-proofops",
    });
    expect(discovery.tools.map((tool) => tool.name)).toEqual([
      "search_workflows",
      "call_workflow",
    ]);
    expect(calls.map((call) => call.body.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(calls[1]?.headers.get("mcp-session-id")).toBe("session-proofops");
    expect(calls[2]?.headers.get("authorization")).toBe("Bearer kh_test_mcp");
  });

  it("parses Streamable HTTP SSE responses", async () => {
    let request = 0;
    const fetchFn = vi.fn(async () => {
      request += 1;
      if (request === 2) return new Response(null, { status: 202 });
      const id = request === 1 ? 1 : 2;
      const result =
        request === 1
          ? {
              protocolVersion: "2025-06-18",
              serverInfo: { name: "KeeperHub", version: "live" },
            }
          : { tools: [{ name: "execute_workflow" }] };
      return new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_test",
      fetchFn,
    });

    await expect(client.discoverTools()).resolves.toMatchObject({
      tools: [{ name: "execute_workflow" }],
    });
  });

  it("calls a discovered read-only tool in the initialized session", async () => {
    let request = 0;
    const calls: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      request += 1;
      if (request === 1) {
        return jsonRpc(
          {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "KeeperHub", version: "1.2.0" },
          },
          1,
          { "mcp-session-id": "search-session" },
        );
      }
      if (request === 2) return new Response(null, { status: 202 });
      if (request === 3) {
        return jsonRpc({ tools: [{ name: "search_workflows" }] }, 2);
      }
      return jsonRpc(
        { content: [{ type: "text", text: "No matching workflows" }] },
        3,
      );
    });
    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_test",
      fetchFn,
    });

    await client.discoverTools();
    await expect(
      client.callTool("search_workflows", {
        query: "incident response",
        category: "defi",
      }),
    ).resolves.toMatchObject({ content: expect.any(Array) });
    expect(calls[3]).toMatchObject({
      method: "tools/call",
      params: {
        name: "search_workflows",
        arguments: { query: "incident response", category: "defi" },
      },
    });
  });

  it("redacts credentials from transport failures", async () => {
    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_secret_value",
      fetchFn: async () => {
        throw new Error("Bearer kh_secret_value rejected");
      },
    });

    const error = await client.discoverTools().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KeeperHubMcpError);
    expect(String(error)).not.toContain("kh_secret_value");
  });
});
