import { afterEach, describe, expect, it, vi } from "vitest";
import { createCachedKeeperHubStatus } from "../src/keeperhub/status.js";

afterEach(() => vi.unstubAllGlobals());

describe("public KeeperHub MCP status", () => {
  it("fails closed when no key is configured", async () => {
    const status = await createCachedKeeperHubStatus({
      url: "https://keeperhub.test/mcp",
      apiKey: "",
    })();
    expect(status).toMatchObject({ configured: false, reachable: false });
  });

  it("returns only sanitized MCP capability metadata and caches it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-06-18",
              serverInfo: { name: "KeeperHub", version: "1.2.0" },
            },
          }),
          { headers: { "mcp-session-id": "session-private" } },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              tools: [
                { name: "search_workflows" },
                { name: "call_workflow" },
              ],
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const read = createCachedKeeperHubStatus({
      url: "https://keeperhub.test/mcp",
      apiKey: "kh_secret",
    });
    const first = await read();
    const second = await read();
    expect(first).toMatchObject({
      configured: true,
      reachable: true,
      serverName: "KeeperHub",
      serverVersion: "1.2.0",
      toolCount: 2,
      requiredTools: { searchWorkflows: true, callWorkflow: true },
    });
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(JSON.stringify(first)).not.toContain("session-private");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
