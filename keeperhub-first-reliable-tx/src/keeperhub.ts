import { randomUUID } from "node:crypto";

export interface TransferIntent {
  chainId: number;
  recipientAddress: string;
  amount: string;
  tokenAddress?: string;
  gasLimitMultiplier?: string;
}

export interface SupportedChain {
  chainId: number;
  name: string;
  symbol?: string;
  isTestnet: boolean;
  isEnabled: boolean;
}

export interface OrganizationWallet {
  hasWallet: boolean;
  walletAddress?: string;
  organizationId?: string;
  isActive?: boolean;
  message?: string;
}

export interface SimulationReceipt {
  success: boolean;
  status: string;
  wouldRevert: boolean;
  gasEstimate?: string;
  revertReason?: string;
}

export interface FirstTransferReceipt {
  evidenceMode: "live";
  status: string;
  executionId: string;
  transactionHash: string;
  transactionLink: string;
  requestId: string | null;
  confirmed: true;
}

export interface PreflightCheck {
  id:
    | "node"
    | "api_key"
    | "chain"
    | "organization_wallet"
    | "funding"
    | "simulation";
  ok: boolean;
  detail: string;
  nextAction?: string;
}

interface StarterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxPolls?: number;
}

interface ApiResult<T> {
  data: T;
  headers: Headers;
  requestId: string | null;
}

interface ExecutionStatus {
  executionId: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  transactionHash?: string;
  transactionLink?: string;
  error?: string | null;
}

export class StarterApiError extends Error {
  readonly name = "StarterApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly nextAction: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

function unwrap<T>(value: unknown): T {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "data")
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function nextActionFor(code: string, detail: string): string {
  const searchable = `${code} ${detail}`.toLowerCase();
  if (searchable.includes("spending") && searchable.includes("cap")) {
    return "Increase the organization spending cap in KeeperHub Settings, or reduce the transfer amount, then simulate again.";
  }
  if (
    searchable.includes("insufficient") ||
    searchable.includes("balance") ||
    searchable.includes("fund")
  ) {
    return "Fund the organization wallet on the selected testnet, wait for the balance to appear, then rerun preflight.";
  }
  if (searchable.includes("wallet") && searchable.includes("config")) {
    return "Open KeeperHub Settings → Wallet and provision the organization wallet, then rerun preflight.";
  }
  if (searchable.includes("unauthorized") || searchable.includes("scope")) {
    return "Create an organization key (kh_) in Settings → API Keys → Organisation and replace KEEPERHUB_API_KEY.";
  }
  if (searchable.includes("rate")) {
    return "Wait for Retry-After, then rerun with the same idempotency key and unchanged request body.";
  }
  return "Use the request ID when reporting this failure, correct the indicated field, and rerun simulation before broadcast.";
}

function parseJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StarterApiError(
      502,
      "invalid_json",
      "KeeperHub returned a non-JSON response",
      "Retry once. If it persists, report the request ID to KeeperHub support.",
    );
  }
}

function validateIntent(intent: TransferIntent): void {
  if (!Number.isInteger(intent.chainId) || intent.chainId <= 0) {
    throw new StarterApiError(
      0,
      "invalid_chain",
      "chainId must be a positive number",
      "Choose an enabled testnet from GET /api/chains and use its numeric chainId.",
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(intent.recipientAddress)) {
    throw new StarterApiError(
      0,
      "invalid_recipient",
      "recipientAddress is not a valid EVM address",
      "Copy the organization wallet address from KeeperHub and rerun preflight.",
    );
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(intent.amount)) {
    throw new StarterApiError(
      0,
      "invalid_amount",
      "amount must be a non-negative decimal string",
      "Use a small testnet amount such as 0.000001.",
    );
  }
}

function clampPollHintSeconds(value: string | null): number {
  const seconds = value === null ? 1 : Number(value);
  if (!Number.isFinite(seconds)) return 1_000;
  return Math.min(10_000, Math.max(250, Math.round(seconds * 1_000)));
}

export class KeeperHubStarterClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxPolls: number;

  constructor(private readonly options: StarterClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://app.keeperhub.com";
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxPolls = options.maxPolls ?? 24;
  }

  async listChains(): Promise<SupportedChain[]> {
    const response = await this.request<SupportedChain[]>("GET", "/api/chains");
    if (!Array.isArray(response.data)) {
      throw new StarterApiError(
        502,
        "unexpected_chains_shape",
        "GET /api/chains did not return an array",
        "Capture the request ID and compare the response with the current Chains API documentation.",
        response.requestId,
      );
    }
    return response.data;
  }

  async getWallet(): Promise<OrganizationWallet> {
    return (await this.request<OrganizationWallet>("GET", "/api/user/wallet"))
      .data;
  }

  async getWalletBalances(): Promise<unknown> {
    return (
      await this.request<unknown>("GET", "/api/user/wallet/balances")
    ).data;
  }

  async simulateTransfer(intent: TransferIntent): Promise<SimulationReceipt> {
    validateIntent(intent);
    const response = await this.request<SimulationReceipt>(
      "POST",
      "/api/execute/transfer",
      { ...intent, simulate: true },
    );
    return response.data;
  }

  async safeFirstTransfer(
    intent: TransferIntent,
    idempotencyKey: string,
  ): Promise<FirstTransferReceipt> {
    validateIntent(intent);
    if (!idempotencyKey.trim()) {
      throw new StarterApiError(
        0,
        "missing_idempotency_key",
        "A non-empty idempotency key is required",
        "Generate one UUID for this exact body and preserve it across transport retries.",
      );
    }

    const simulation = await this.simulateTransfer(intent);
    if (simulation.success !== true || simulation.wouldRevert !== false) {
      throw new StarterApiError(
        400,
        "simulation_blocked",
        simulation.revertReason ?? "Simulation did not prove a safe broadcast",
        "Fix the simulated failure and rerun. Do not broadcast a different or unproven body.",
      );
    }

    const execution = await this.broadcastTransfer(intent, idempotencyKey);
    if (!execution.data.executionId) {
      throw new StarterApiError(
        502,
        "missing_execution_id",
        "KeeperHub accepted the request without an executionId",
        "Do not broadcast again. Capture the request ID and reconcile with KeeperHub support.",
        execution.requestId,
      );
    }
    const terminal = await this.pollExecution(execution.data.executionId);
    if (terminal.data.status === "failed") {
      throw new StarterApiError(
        422,
        "execution_failed",
        terminal.data.error ?? "KeeperHub execution failed",
        nextActionFor("execution_failed", terminal.data.error ?? ""),
        terminal.requestId,
      );
    }

    const hash = terminal.data.transactionHash ?? "";
    const link = terminal.data.transactionLink ?? "";
    let verifiedLink = false;
    try {
      verifiedLink = new URL(link).protocol === "https:";
    } catch {
      verifiedLink = false;
    }
    if (
      terminal.data.status !== "completed" ||
      !/^0x[a-fA-F0-9]{64}$/.test(hash) ||
      !verifiedLink
    ) {
      throw new StarterApiError(
        502,
        "receipt_incomplete",
        "Terminal status did not include a valid transaction hash and HTTPS explorer link",
        "Do not claim success. Poll the same execution ID again or report its request ID.",
        terminal.requestId,
      );
    }

    return {
      evidenceMode: "live",
      status: terminal.data.status,
      executionId: terminal.data.executionId,
      transactionHash: hash,
      transactionLink: link,
      requestId: terminal.requestId,
      confirmed: true,
    };
  }

  private async broadcastTransfer(
    intent: TransferIntent,
    idempotencyKey: string,
  ): Promise<ApiResult<ExecutionStatus>> {
    const serializedBody = JSON.stringify(intent);
    try {
      return await this.requestSerialized<ExecutionStatus>(
        "POST",
        "/api/execute/transfer",
        serializedBody,
        idempotencyKey,
      );
    } catch (error) {
      if (error instanceof StarterApiError) throw error;
      await this.sleep(250);
      return this.requestSerialized<ExecutionStatus>(
        "POST",
        "/api/execute/transfer",
        serializedBody,
        idempotencyKey,
      );
    }
  }

  private async pollExecution(
    executionId: string,
  ): Promise<ApiResult<ExecutionStatus>> {
    let latest: ApiResult<ExecutionStatus> | null = null;
    for (let poll = 0; poll < this.maxPolls; poll += 1) {
      latest = await this.request<ExecutionStatus>(
        "GET",
        `/api/execute/${encodeURIComponent(executionId)}/status`,
      );
      if (
        latest.data.status === "completed" ||
        latest.data.status === "failed"
      ) {
        return latest;
      }
      await this.sleep(
        clampPollHintSeconds(latest.headers.get("x-poll-interval-hint")),
      );
    }
    throw new StarterApiError(
      408,
      "poll_timeout",
      `Execution ${executionId} did not reach a terminal state`,
      "Keep the execution ID, wait, and resume status polling. Do not submit a duplicate transaction.",
      latest?.requestId ?? null,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResult<T>> {
    return this.requestSerialized<T>(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
    );
  }

  private async requestSerialized<T>(
    method: "GET" | "POST",
    path: string,
    serializedBody?: string,
    idempotencyKey?: string,
  ): Promise<ApiResult<T>> {
    const correlationId = randomUUID();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.options.apiKey}`,
      "x-request-id": correlationId,
    };
    if (serializedBody !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: serializedBody,
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = parseJson(await response.text());
    const object =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const requestId =
      response.headers.get("x-request-id") ??
      (typeof object?.request_id === "string" ? object.request_id : null) ??
      correlationId;
    if (!response.ok) {
      const code =
        typeof object?.error === "string"
          ? object.error
          : `http_${response.status}`;
      const detail =
        typeof object?.detail === "string"
          ? object.detail
          : typeof object?.message === "string"
            ? object.message
            : code;
      const hint =
        typeof object?.hint === "string"
          ? object.hint
          : nextActionFor(code, detail);
      throw new StarterApiError(
        response.status,
        code,
        detail,
        hint,
        requestId,
      );
    }
    return {
      data: unwrap<T>(parsed),
      headers: response.headers,
      requestId,
    };
  }
}

function findChainBalance(value: unknown, chainId: number): bigint | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findChainBalance(item, chainId);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const entryChain = Number(entry.chainId ?? entry.chain_id);
  if (entryChain === chainId) {
    for (const key of [
      "balanceWei",
      "nativeBalanceWei",
      "balance",
      "rawBalance",
    ]) {
      const candidate = entry[key];
      if (
        typeof candidate === "string" &&
        /^\d+$/.test(candidate)
      ) {
        return BigInt(candidate);
      }
      if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
        return BigInt(candidate);
      }
    }
  }
  for (const nested of Object.values(entry)) {
    const found = findChainBalance(nested, chainId);
    if (found !== null) return found;
  }
  return null;
}

export async function runStarterPreflight(input: {
  client: KeeperHubStarterClient;
  apiKey: string;
  chainId: number;
  nodeVersion?: string;
}): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const nodeVersion = input.nodeVersion ?? process.version;
  const major = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  checks.push({
    id: "node",
    ok: Number.isInteger(major) && major >= 20,
    detail:
      Number.isInteger(major) && major >= 20
        ? `Node ${nodeVersion}`
        : `Node 20 or newer required; found ${nodeVersion}`,
    nextAction:
      Number.isInteger(major) && major >= 20
        ? undefined
        : "Install Node 20 LTS or newer and rerun preflight.",
  });
  const keyOk =
    input.apiKey.startsWith("kh_") &&
    input.apiKey.length >= 8 &&
    !input.apiKey.toUpperCase().includes("YOUR");
  checks.push({
    id: "api_key",
    ok: keyOk,
    detail: keyOk
      ? "Organization API key is set (value never printed)"
      : "Missing a usable organization API key (kh_)",
    nextAction: keyOk
      ? undefined
      : "Create one in Settings → API Keys → Organisation; store it only in KEEPERHUB_API_KEY.",
  });
  if (!checks[0]!.ok || !keyOk) return checks;

  let chains: SupportedChain[];
  try {
    chains = await input.client.listChains();
  } catch (error) {
    return [
      ...checks,
      checkFromError("chain", error, "Could not read GET /api/chains"),
    ];
  }
  const chain = chains.find(
    (candidate) => Number(candidate.chainId) === input.chainId,
  );
  const chainOk = Boolean(chain?.isEnabled && chain?.isTestnet);
  checks.push({
    id: "chain",
    ok: chainOk,
    detail: chainOk
      ? `${chain!.name} (${chain!.chainId}) is an enabled testnet`
      : `chainId ${input.chainId} is missing, disabled, or not a testnet`,
    nextAction: chainOk
      ? undefined
      : "Choose a chain where GET /api/chains reports isEnabled=true and isTestnet=true.",
  });
  if (!chainOk) return checks;

  let wallet: OrganizationWallet;
  try {
    wallet = await input.client.getWallet();
  } catch (error) {
    return [
      ...checks,
      checkFromError(
        "organization_wallet",
        error,
        "Organization wallet could not be read",
      ),
    ];
  }
  const walletOk =
    wallet.hasWallet === true &&
    typeof wallet.organizationId === "string" &&
    typeof wallet.walletAddress === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(wallet.walletAddress) &&
    wallet.isActive !== false;
  checks.push({
    id: "organization_wallet",
    ok: walletOk,
    detail: walletOk
      ? `Active organization wallet ${wallet.walletAddress!.slice(0, 8)}…${wallet.walletAddress!.slice(-4)}`
      : wallet.message ?? "No active organization wallet is available",
    nextAction: walletOk
      ? undefined
      : "Open KeeperHub Settings → Wallet, finish provisioning, and confirm the active organization.",
  });
  if (!walletOk) return checks;

  try {
    const balances = await input.client.getWalletBalances();
    const balance = findChainBalance(balances, input.chainId);
    const funded = balance === null || balance > 0n;
    checks.push({
      id: "funding",
      ok: funded,
      detail:
        balance === null
          ? "Balance endpoint reachable; exact native balance shape was not recognized, so simulation is authoritative"
          : funded
            ? `Native testnet balance is non-zero (${balance} wei)`
            : "Organization wallet native testnet balance is zero",
      nextAction: funded
        ? undefined
        : "Fund the organization wallet from a testnet faucet, wait for confirmation, then rerun preflight.",
    });
  } catch (error) {
    checks.push(
      checkFromError("funding", error, "Wallet balance check failed"),
    );
    return checks;
  }

  try {
    const simulation = await input.client.simulateTransfer({
      chainId: input.chainId,
      recipientAddress: wallet.walletAddress!,
      amount: "0.000001",
    });
    const simulationOk =
      simulation.success === true && simulation.wouldRevert === false;
    checks.push({
      id: "simulation",
      ok: simulationOk,
      detail: simulationOk
        ? `Self-transfer simulation passed${simulation.gasEstimate ? `; gas ${simulation.gasEstimate}` : ""}`
        : simulation.revertReason ?? "Simulation did not prove a safe write",
      nextAction: simulationOk
        ? undefined
        : "Fix the reported funding, cap, wallet, or call error before running the live command.",
    });
  } catch (error) {
    checks.push(
      checkFromError(
        "simulation",
        error,
        "Dry-run simulation failed; no transaction was broadcast",
      ),
    );
  }
  return checks;
}

function checkFromError(
  id: PreflightCheck["id"],
  error: unknown,
  fallback: string,
): PreflightCheck {
  if (error instanceof StarterApiError) {
    return {
      id,
      ok: false,
      detail: `${error.code}: ${error.message}${
        error.requestId ? ` (request ${error.requestId})` : ""
      }`,
      nextAction: error.nextAction,
    };
  }
  return {
    id,
    ok: false,
    detail: fallback,
    nextAction: "Check network access and rerun. No transaction was broadcast.",
  };
}
