export interface BlockscoutMcpServerInfo {
  name: string;
  version: string;
}

interface BlockscoutMcpOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function serverInfoFromPayload(payload: string): BlockscoutMcpServerInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const result =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root;
  const serverInfo = result.serverInfo;
  if (!serverInfo || typeof serverInfo !== "object") return null;

  const info = serverInfo as Record<string, unknown>;
  if (typeof info.name !== "string" || typeof info.version !== "string") {
    return null;
  }
  return { name: info.name, version: info.version };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function remainingTime(deadline: number, timeoutMs: number): number {
  return Math.max(1, Math.min(timeoutMs, deadline - Date.now()));
}

/**
 * Perform the read-only MCP initialize exchange without waiting for an SSE
 * connection to close. Hosted MCP transports intentionally keep that stream
 * open after sending the initialize response.
 */
export async function initializeBlockscoutMcp(
  url: string,
  options: BlockscoutMcpOptions = {},
): Promise<BlockscoutMcpServerInfo> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const response = await withTimeout(
      fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "keeperhub-proofops", version: "0.1.0" },
          },
        }),
        signal: controller.signal,
      }),
      remainingTime(deadline, timeoutMs),
      `Blockscout MCP initialize timed out after ${timeoutMs}ms`,
    );

    if (!response.ok) {
      throw new Error(
        `Blockscout MCP returned ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      const body = await withTimeout(
        response.text(),
        remainingTime(deadline, timeoutMs),
        `Blockscout MCP initialize timed out after ${timeoutMs}ms`,
      );
      const info = serverInfoFromPayload(body);
      if (!info) {
        throw new Error(
          "Blockscout MCP initialize response missing serverInfo metadata",
        );
      }
      return info;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completePayload = "";

    while (true) {
      const chunk = await withTimeout(
        reader.read(),
        remainingTime(deadline, timeoutMs),
        `Blockscout MCP initialize timed out after ${timeoutMs}ms`,
      );
      if (chunk.done) {
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(chunk.value, { stream: true });
      }

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        completePayload += payload;
        const info = serverInfoFromPayload(payload);
        if (info) return info;
      }

      if (chunk.done) break;
    }

    const trailing = buffer.trim();
    if (trailing.startsWith("data:")) {
      completePayload += trailing.slice("data:".length).trim();
    } else {
      completePayload += trailing;
    }
    const info = serverInfoFromPayload(completePayload);
    if (info) return info;
    throw new Error(
      "Blockscout MCP initialize response missing serverInfo metadata",
    );
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => undefined);
  }
}
