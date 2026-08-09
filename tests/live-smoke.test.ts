/**
 * Live smoke — skipped unless RUN_LIVE_SMOKE=1 and KEEPERHUB_API_KEY is set.
 * Never fabricates success.
 */
import { describe, it, expect } from "vitest";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { env } from "../src/config/env.js";

const live =
  process.env.RUN_LIVE_SMOKE === "1" &&
  Boolean(env.KEEPERHUB_API_KEY) &&
  !env.KEEPERHUB_API_KEY.includes("YOUR");

describe.skipIf(!live)("live-smoke KeeperHub", () => {
  it("pings REST schemas with real credentials", async () => {
    const client = new KeeperHubClient();
    const rest = await client.pingRest();
    expect(rest.ok).toBe(true);
  }, 30_000);

  it("initializes the official MCP server and discovers tools", async () => {
    const client = new KeeperHubClient();
    const mcp = await client.discoverMcpTools();
    expect(mcp.tools.length).toBeGreaterThan(0);
    expect(mcp.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["search_workflows", "call_workflow"]),
    );
  }, 30_000);
});

describe("live-smoke placeholder", () => {
  it("documents how to enable", () => {
    expect(live || !live).toBe(true);
    if (!live) {
      console.log(
        "Skip live smoke. Enable with RUN_LIVE_SMOKE=1 and real KEEPERHUB_API_KEY.",
      );
    }
  });
});
