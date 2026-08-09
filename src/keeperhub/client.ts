import { env, redactSecrets } from "../config/env.js";
import { KeeperHubHttp } from "./http.js";
import { ReliableExecutor } from "./execution.js";
import type {
  ConditionalRunbookIntent,
} from "../agent/IncidentRunbooks.js";
import type {
  DirectExecutionStatus,
  ExecutionResult,
  KeeperHubAction,
  KeeperHubFetch,
  KeeperHubConditionResult,
  KeeperHubResponse,
  SimulationResult,
} from "./types.js";

export type {
  DirectExecutionStatus,
  ExecutionAttempt,
  ExecutionResult,
  KeeperHubAction,
  SimulationResult,
  SimulationStatus,
} from "./types.js";

/**
 * KeeperHub REST client — the ONLY egress for state-changing on-chain actions.
 * Uses Direct Execution API with simulate flag + status polling.
 * MCP endpoint is pinged for connectivity; tool calls map to the same REST surface.
 */
export class KeeperHubClient {
  readonly apiUrl: string;
  readonly mcpUrl: string;
  private readonly apiKey: string;
  private readonly chainId: number;
  private readonly http: KeeperHubHttp;
  /** Test/injection hooks */
  private failureMode: string;
  private attemptOffset = 0;

  constructor(options?: {
    apiKey?: string;
    apiUrl?: string;
    mcpUrl?: string;
    chainId?: number;
    fetchFn?: KeeperHubFetch;
    failureMode?: string;
  }) {
    this.apiKey = options?.apiKey ?? env.KEEPERHUB_API_KEY;
    this.apiUrl = (options?.apiUrl ?? env.KEEPERHUB_API_URL).replace(/\/$/, "");
    this.mcpUrl = options?.mcpUrl ?? env.KEEPERHUB_MCP_URL;
    this.chainId = options?.chainId ?? env.CHAIN_ID;
    this.http = new KeeperHubHttp({
      apiKey: this.apiKey,
      apiUrl: this.apiUrl,
      fetchFn: options?.fetchFn,
    });
    this.failureMode = options?.failureMode ?? env.INJECT_FAILURE_MODE ?? "";
  }

  setFailureMode(mode: string): void {
    this.failureMode = mode;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    return h;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<KeeperHubResponse<T>> {
    if (this.failureMode === "transient_rpc" && this.attemptOffset === 0) {
      this.attemptOffset += 1;
      throw new Error(
        "Injected transient network failure (INJECT_FAILURE_MODE=transient_rpc)",
      );
    }

    return this.http.request<T>(method, path, body, { idempotencyKey });
  }

  /** Ping MCP endpoint (auth header). Does not execute anything. */
  async pingMcp(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(this.mcpUrl, {
        method: "GET",
        headers: this.headers(),
      });
      const text = redactSecrets((await res.text()).slice(0, 200));
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          detail: `MCP auth failed (${res.status}). ${text}`,
        };
      }
      // MCP may return 405/406 on bare GET — still proves reachability + auth acceptance
      if (res.status === 401) {
        return { ok: false, detail: text };
      }
      return {
        ok: res.status < 500,
        detail: `MCP reachable HTTP ${res.status}: ${text || "(empty)"}`,
      };
    } catch (e) {
      return {
        ok: false,
        detail: `MCP unreachable: ${redactSecrets(String(e))}`,
      };
    }
  }

  /** Read-only REST health: list workflows (or schemas). */
  async pingRest(): Promise<{ ok: boolean; detail: string; sample?: unknown }> {
    try {
      const { data } = await this.request<unknown>(
        "GET",
        "/api/mcp/schemas",
      );
      return {
        ok: true,
        detail: "REST auth OK — /api/mcp/schemas reachable",
        sample: data,
      };
    } catch (e) {
      return {
        ok: false,
        detail: redactSecrets(e instanceof Error ? e.message : String(e)),
      };
    }
  }

  /** List workflows — used by onboarding as a safe read-only call. */
  async listWorkflows(): Promise<unknown> {
    const { data } = await this.request<unknown>("GET", "/api/workflows");
    return data;
  }

  buildContractBody(action: KeeperHubAction, simulate: boolean) {
    const body: Record<string, unknown> = {
      contractAddress: action.contractAddress,
      chainId: action.chainId ?? this.chainId,
      functionName: action.functionName,
    };
    if (simulate) body.simulate = true;
    if (action.functionArgs !== undefined) {
      body.functionArgs = JSON.stringify(action.functionArgs);
    }
    if (action.abi) body.abi = action.abi;
    if (action.value) body.value = action.value;
    if (action.gasLimitMultiplier) {
      body.gasLimitMultiplier = action.gasLimitMultiplier;
    } else if (this.failureMode === "gas_spike") {
      // Artificially tight multiplier on first path — KeeperHub / retry bump recovers
      body.gasLimitMultiplier = "0.5";
    }
    return body;
  }

  /**
   * KeeperHub simulation-before-submit.
   * Sets simulate:true — must not spend gas / create audit execution rows.
   */
  async simulate(action: KeeperHubAction): Promise<SimulationResult> {
    try {
      const body = this.buildContractBody(action, true);
      const { data } = await this.request<Record<string, unknown>>(
        "POST",
        "/api/execute/contract-call",
        body,
      );

      if (data.wouldRevert === true) {
        return {
          status: "would_revert",
          wouldRevert: true,
          revertReason: String(
            data.revertReason ?? data.error ?? "would revert",
          ),
          gasEstimate: data.gasEstimate
            ? String(data.gasEstimate)
            : undefined,
          from: data.from ? String(data.from) : undefined,
          to: data.to ? String(data.to) : undefined,
          raw: data,
        };
      }

      return {
        status: "ok",
        wouldRevert: false,
        gasEstimate: data.gasEstimate ? String(data.gasEstimate) : undefined,
        from: data.from ? String(data.from) : undefined,
        to: data.to ? String(data.to) : undefined,
        simulatedReturnValue: data.simulatedReturnValue,
        raw: data,
      };
    } catch (e) {
      const err = e as Error & { status?: number; data?: Record<string, unknown> };
      const data = err.data;
      if (data?.wouldRevert === true || err.status === 400) {
        return {
          status: "would_revert",
          wouldRevert: true,
          revertReason: String(
            data?.revertReason ?? data?.error ?? err.message,
          ),
          error: err.message,
          raw: data,
        };
      }
      return {
        status: "error",
        wouldRevert: false,
        error: redactSecrets(err.message),
      };
    }
  }

  private buildCheckAndExecuteBody(
    action: KeeperHubAction,
    intent: ConditionalRunbookIntent,
    simulate: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contractAddress: action.contractAddress,
      chainId: action.chainId ?? this.chainId,
      functionName: intent.checkFunctionName,
      functionArgs: JSON.stringify(intent.checkArgs),
      condition: {
        operator: intent.operator,
        value: intent.targetValue,
      },
      action: {
        contractAddress: action.contractAddress,
        functionName: action.functionName,
        functionArgs: JSON.stringify(action.functionArgs ?? []),
        ...(action.abi ? { abi: action.abi } : {}),
        ...(action.value ? { value: action.value } : {}),
        ...(action.gasLimitMultiplier
          ? { gasLimitMultiplier: action.gasLimitMultiplier }
          : {}),
      },
    };
    if (action.abi) body.abi = action.abi;
    if (simulate) body.simulate = true;
    return body;
  }

  async simulateCheckAndExecute(
    action: KeeperHubAction,
    intent: ConditionalRunbookIntent,
  ): Promise<SimulationResult> {
    try {
      const { data } = await this.request<Record<string, unknown>>(
        "POST",
        "/api/execute/check-and-execute",
        this.buildCheckAndExecuteBody(action, intent, true),
      );
      const condition = normalizeConditionResult(data);
      if (data.wouldRevert === true) {
        return {
          status: "would_revert",
          wouldRevert: true,
          revertReason: String(
            data.revertReason ?? data.error ?? "would revert",
          ),
          condition,
          raw: data,
        };
      }
      if (data.executed === false || condition?.met === false) {
        return {
          status: "condition_not_met",
          wouldRevert: false,
          condition,
          raw: data,
        };
      }
      return {
        status: "ok",
        wouldRevert: false,
        gasEstimate: data.gasEstimate ? String(data.gasEstimate) : undefined,
        from: data.from ? String(data.from) : undefined,
        to: data.to ? String(data.to) : undefined,
        simulatedReturnValue: data.simulatedReturnValue,
        condition,
        raw: data,
      };
    } catch (error) {
      const err = error as Error & {
        data?: Record<string, unknown>;
        status?: number;
      };
      const condition = err.data
        ? normalizeConditionResult(err.data)
        : undefined;
      if (err.data?.wouldRevert === true || err.status === 400) {
        return {
          status: "would_revert",
          wouldRevert: true,
          revertReason: String(
            err.data?.revertReason ?? err.data?.error ?? err.message,
          ),
          error: err.message,
          condition,
          raw: err.data,
        };
      }
      return {
        status: "error",
        wouldRevert: false,
        error: redactSecrets(err.message),
        condition,
      };
    }
  }

  async executeCheckAndExecute(
    action: KeeperHubAction,
    intent: ConditionalRunbookIntent,
    options?: {
      idempotencyKey?: string;
      maxAttempts?: number;
      baseBackoffMs?: number;
      pollTimeoutMs?: number;
    },
  ): Promise<ExecutionResult> {
    const body = this.buildCheckAndExecuteBody(action, intent, false);
    let condition: KeeperHubConditionResult | undefined;
    const executor = new ReliableExecutor({
      submit: async (requestBody, idempotencyKey) => {
        const response = await this.request<Record<string, unknown>>(
          "POST",
          "/api/execute/check-and-execute",
          requestBody,
          idempotencyKey,
        );
        condition = normalizeConditionResult(response.data);
        return response;
      },
      getStatus: (executionId) =>
        this.getDirectExecutionStatusResponse(executionId),
      auditReference: (executionId) =>
        `${this.apiUrl}/api/execute/${executionId}/status`,
    });
    const result = await executor.execute(body, {
      idempotencyKey: options?.idempotencyKey,
      maxSubmissionAttempts: options?.maxAttempts,
      baseBackoffMs: options?.baseBackoffMs,
      pollTimeoutMs: options?.pollTimeoutMs,
      acceptNoExecution: (data) =>
        data.executed === false ||
        normalizeConditionResult(data)?.met === false
          ? { status: "condition_not_met" }
          : undefined,
    });
    return { ...result, condition };
  }

  async getDirectExecutionStatus(
    executionId: string,
  ): Promise<DirectExecutionStatus> {
    const { data } = await this.getDirectExecutionStatusResponse(executionId);
    return { ...data, raw: data };
  }

  async getDirectExecutionStatusResponse(
    executionId: string,
  ): Promise<KeeperHubResponse<DirectExecutionStatus>> {
    return this.request<DirectExecutionStatus>(
      "GET",
      `/api/execute/${executionId}/status`,
    );
  }

  /**
   * Execute via KeeperHub with retry/backoff and gas adaptation.
   * Never signs locally — Turnkey signing stays inside KeeperHub.
   */
  async execute(
    action: KeeperHubAction,
    options?: {
      maxAttempts?: number;
      baseBackoffMs?: number;
      pollTimeoutMs?: number;
    },
  ): Promise<ExecutionResult> {
    const gasLimitMultiplier =
      action.gasLimitMultiplier ??
      (this.failureMode === "gas_spike" ? "0.5" : "1.2");
    this.attemptOffset = 0;
    const body = this.buildContractBody(
      { ...action, gasLimitMultiplier },
      false,
    );
    const executor = new ReliableExecutor({
      submit: (requestBody, idempotencyKey) =>
        this.request<Record<string, unknown>>(
          "POST",
          "/api/execute/contract-call",
          requestBody,
          idempotencyKey,
        ),
      getStatus: (executionId) =>
        this.getDirectExecutionStatusResponse(executionId),
      auditReference: (executionId) =>
        `${this.apiUrl}/api/execute/${executionId}/status`,
    });
    return executor.execute(body, {
      idempotencyKey: action.idempotencyKey,
      maxSubmissionAttempts: options?.maxAttempts,
      baseBackoffMs: options?.baseBackoffMs,
      pollTimeoutMs: options?.pollTimeoutMs,
    });
  }

  /**
   * Native/ERC-20 transfer via KeeperHub (used by first-tx starter).
   * Still never signs locally.
   */
  async transfer(params: {
    recipientAddress: string;
    amount: string;
    chainId?: number;
    /** Deprecated input-only compatibility. Outbound requests use chainId. */
    network?: string;
    tokenAddress?: string;
    simulate?: boolean;
    idempotencyKey?: string;
    gasLimitMultiplier?: string;
    maxAttempts?: number;
    baseBackoffMs?: number;
    pollTimeoutMs?: number;
  }): Promise<ExecutionResult | SimulationResult> {
    const body: Record<string, unknown> = {
      chainId: params.chainId ?? this.chainId,
      recipientAddress: params.recipientAddress,
      amount: params.amount,
    };
    if (params.simulate === true) body.simulate = true;
    if (params.tokenAddress) body.tokenAddress = params.tokenAddress;
    if (params.gasLimitMultiplier) {
      body.gasLimitMultiplier = params.gasLimitMultiplier;
    }

    if (params.simulate) {
      try {
        const { data } = await this.request<Record<string, unknown>>(
          "POST",
          "/api/execute/transfer",
          body,
        );
        if (data.wouldRevert === true) {
          return {
            status: "would_revert",
            wouldRevert: true,
            revertReason: String(data.revertReason ?? data.error ?? "revert"),
            raw: data,
          };
        }
        return {
          status: "ok",
          wouldRevert: false,
          gasEstimate: data.gasEstimate ? String(data.gasEstimate) : undefined,
          raw: data,
        };
      } catch (e) {
        const err = e as Error & { data?: Record<string, unknown> };
        if (err.data?.wouldRevert) {
          return {
            status: "would_revert",
            wouldRevert: true,
            revertReason: String(err.data.revertReason ?? err.message),
            error: err.message,
            raw: err.data,
          };
        }
        return {
          status: "error",
          wouldRevert: false,
          error: redactSecrets(err.message),
        };
      }
    }

    const executor = new ReliableExecutor({
      submit: (requestBody, idempotencyKey) =>
        this.request<Record<string, unknown>>(
          "POST",
          "/api/execute/transfer",
          requestBody,
          idempotencyKey,
        ),
      getStatus: (executionId) =>
        this.getDirectExecutionStatusResponse(executionId),
      auditReference: (executionId) =>
        `${this.apiUrl}/api/execute/${executionId}/status`,
    });
    return executor.execute(body, {
      idempotencyKey: params.idempotencyKey,
      maxSubmissionAttempts: params.maxAttempts,
      baseBackoffMs: params.baseBackoffMs,
      pollTimeoutMs: params.pollTimeoutMs,
    });
  }

  /**
   * Before resubmitting after timeout: reconcile against chain/status
   * so we do not duplicate an already-landed action (idempotency + status).
   */
  async reconcileBeforeResubmit(executionId: string): Promise<{
    alreadyTerminal: boolean;
    status: DirectExecutionStatus;
  }> {
    const status = await this.getDirectExecutionStatus(executionId);
    return {
      alreadyTerminal:
        status.status === "completed" || status.status === "failed",
      status,
    };
  }
}

export function createKeeperHubClient(
  opts?: ConstructorParameters<typeof KeeperHubClient>[0],
): KeeperHubClient {
  return new KeeperHubClient(opts);
}

function normalizeConditionResult(
  data: Record<string, unknown>,
): KeeperHubConditionResult | undefined {
  const candidate = data.conditionResult ?? data.condition;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const condition = candidate as Record<string, unknown>;
  if (typeof condition.met !== "boolean") return undefined;
  return {
    met: condition.met,
    observedValue:
      condition.observedValue === undefined
        ? undefined
        : String(condition.observedValue),
    targetValue:
      condition.targetValue === undefined
        ? undefined
        : String(condition.targetValue),
    operator:
      condition.operator === undefined
        ? undefined
        : String(condition.operator),
  };
}
