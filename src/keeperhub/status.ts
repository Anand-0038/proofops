import { KeeperHubMcpClient } from "./mcp.js";

export interface KeeperHubPublicStatus {
  configured: boolean;
  reachable: boolean;
  transport: "mcp_streamable_http";
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  toolCount: number;
  requiredTools: {
    searchWorkflows: boolean;
    callWorkflow: boolean;
  };
  checkedAt: string;
  stale: boolean;
}

const EMPTY_TOOLS = {
  searchWorkflows: false,
  callWorkflow: false,
};

export function createCachedKeeperHubStatus(options: {
  url: string;
  apiKey: string;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}): () => Promise<KeeperHubPublicStatus> {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const now = options.now ?? Date.now;
  let cached: { expiresAt: number; value: KeeperHubPublicStatus } | null = null;
  let pending: Promise<KeeperHubPublicStatus> | null = null;

  async function inspect(): Promise<KeeperHubPublicStatus> {
    const checkedAt = new Date(now()).toISOString();
    if (!options.apiKey) {
      return {
        configured: false,
        reachable: false,
        transport: "mcp_streamable_http",
        serverName: null,
        serverVersion: null,
        protocolVersion: null,
        toolCount: 0,
        requiredTools: EMPTY_TOOLS,
        checkedAt,
        stale: false,
      };
    }

    try {
      const client = new KeeperHubMcpClient({
        url: options.url,
        apiKey: options.apiKey,
        fetchFn: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
          }),
      });
      const discovery = await client.discoverTools();
      const names = new Set(discovery.tools.map((tool) => tool.name));
      return {
        configured: true,
        reachable: true,
        transport: "mcp_streamable_http",
        serverName: discovery.serverName,
        serverVersion: discovery.serverVersion,
        protocolVersion: discovery.protocolVersion,
        toolCount: discovery.tools.length,
        requiredTools: {
          searchWorkflows: names.has("search_workflows"),
          callWorkflow: names.has("call_workflow"),
        },
        checkedAt,
        stale: false,
      };
    } catch {
      return {
        configured: true,
        reachable: false,
        transport: "mcp_streamable_http",
        serverName: null,
        serverVersion: null,
        protocolVersion: null,
        toolCount: 0,
        requiredTools: EMPTY_TOOLS,
        checkedAt,
        stale: false,
      };
    }
  }

  return async () => {
    const current = now();
    if (cached && cached.expiresAt > current) return cached.value;
    pending ??= inspect().then((value) => {
      cached = { expiresAt: now() + ttlMs, value };
      pending = null;
      return value;
    });
    return pending;
  };
}
