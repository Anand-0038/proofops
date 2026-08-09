import { redactSecrets } from "../config/env.js";
import type { KeeperHubFetch } from "./types.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface KeeperHubMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface KeeperHubMcpDiscovery {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  tools: KeeperHubMcpTool[];
  sessionId: string | null;
}

export class KeeperHubMcpError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(message: string, status = 0, code?: number) {
    super(redactSecrets(message));
    this.name = "KeeperHubMcpError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRpcPayload(text: string, contentType: string): JsonRpcResponse[] {
  const payloads: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        payloads.push(JSON.parse(data));
      } catch {
        throw new KeeperHubMcpError("KeeperHub MCP returned malformed SSE JSON");
      }
    }
  } else if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      payloads.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      throw new KeeperHubMcpError("KeeperHub MCP returned malformed JSON");
    }
  }

  return payloads.filter(isRecord) as JsonRpcResponse[];
}

export class KeeperHubMcpClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetchFn: KeeperHubFetch;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(options: {
    url: string;
    apiKey: string;
    fetchFn?: KeeperHubFetch;
  }) {
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async send(
    method: string,
    params: Record<string, unknown> = {},
    notification = false,
  ): Promise<unknown> {
    const id = notification ? undefined : ++this.requestId;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    let response: Response;
    try {
      response = await this.fetchFn(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(id === undefined ? {} : { id }),
          method,
          params,
        }),
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      throw new KeeperHubMcpError(`KeeperHub MCP request failed: ${message}`);
    }

    const returnedSessionId = response.headers.get("mcp-session-id");
    if (returnedSessionId) this.sessionId = returnedSessionId;
    const text = await response.text();
    if (!response.ok) {
      throw new KeeperHubMcpError(
        `KeeperHub MCP HTTP ${response.status}: ${text.slice(0, 240)}`,
        response.status,
      );
    }
    if (notification) return undefined;

    const messages = parseJsonRpcPayload(
      text,
      response.headers.get("content-type") ?? "",
    );
    const message = messages.find((candidate) => candidate.id === id);
    if (!message) {
      throw new KeeperHubMcpError(
        `KeeperHub MCP returned no JSON-RPC response for ${method}`,
        response.status,
      );
    }
    if (message.error) {
      throw new KeeperHubMcpError(
        `KeeperHub MCP ${method} failed: ${message.error.message ?? "unknown error"}`,
        response.status,
        message.error.code,
      );
    }
    return message.result;
  }

  async discoverTools(): Promise<KeeperHubMcpDiscovery> {
    const initialized = await this.send("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "proofops", version: "0.1.0" },
    });
    if (!isRecord(initialized)) {
      throw new KeeperHubMcpError("KeeperHub MCP initialize result is invalid");
    }

    await this.send("notifications/initialized", {}, true);
    const listed = await this.send("tools/list");
    if (!isRecord(listed) || !Array.isArray(listed.tools)) {
      throw new KeeperHubMcpError("KeeperHub MCP tools/list result is invalid");
    }

    const serverInfo = isRecord(initialized.serverInfo)
      ? initialized.serverInfo
      : {};
    const tools = listed.tools
      .filter(isRecord)
      .filter((tool) => typeof tool.name === "string")
      .map((tool) => ({
        name: String(tool.name),
        title: typeof tool.title === "string" ? tool.title : undefined,
        description:
          typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: isRecord(tool.inputSchema)
          ? tool.inputSchema
          : undefined,
      }));

    return {
      serverName:
        typeof serverInfo.name === "string" ? serverInfo.name : "keeperhub",
      serverVersion:
        typeof serverInfo.version === "string" ? serverInfo.version : "unknown",
      protocolVersion:
        typeof initialized.protocolVersion === "string"
          ? initialized.protocolVersion
          : MCP_PROTOCOL_VERSION,
      tools,
      sessionId: this.sessionId,
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.sessionId) {
      throw new KeeperHubMcpError(
        "KeeperHub MCP must be initialized before calling a tool",
      );
    }
    const result = await this.send("tools/call", {
      name,
      arguments: args,
    });
    if (!isRecord(result)) {
      throw new KeeperHubMcpError(`KeeperHub MCP tool ${name} returned invalid data`);
    }
    if (result.isError === true) {
      throw new KeeperHubMcpError(
        `KeeperHub MCP tool ${name} reported an error`,
      );
    }
    return result;
  }
}
