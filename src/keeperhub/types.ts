export interface KeeperHubRateLimit {
  limit?: number;
  remaining?: number;
  resetEpochSeconds?: number;
}

export interface KeeperHubResponseMeta {
  requestId?: string;
  pollIntervalMs?: number;
  retryAfterMs?: number;
  rateLimit?: KeeperHubRateLimit;
}

export interface KeeperHubResponse<T> {
  status: number;
  data: T;
  /**
   * Optional for compatibility with injected test clients. The real HTTP
   * transport always supplies this object.
   */
  meta?: KeeperHubResponseMeta;
}

export interface KeeperHubErrorBody {
  error?: string;
  detail?: string;
  details?: string;
  hint?: string;
  docs?: string;
  request_id?: string;
  field?: string;
  originalExecutionId?: string;
  [key: string]: unknown;
}

export type KeeperHubFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface KeeperHubAction {
  contractAddress: string;
  chainId?: number;
  functionName: string;
  functionArgs?: unknown[];
  abi?: string;
  value?: string;
  valueWei?: string;
  /** Deprecated input-only compatibility. Outbound requests always use chainId. */
  network?: string;
  gasLimitMultiplier?: string;
  idempotencyKey?: string;
}

export type SimulationStatus =
  | "ok"
  | "condition_not_met"
  | "would_revert"
  | "error";

export interface KeeperHubConditionResult {
  met: boolean;
  observedValue?: string;
  targetValue?: string;
  operator?: string;
}

export interface SimulationResult {
  status: SimulationStatus;
  wouldRevert: boolean;
  gasEstimate?: string;
  revertReason?: string;
  error?: string;
  from?: string;
  to?: string;
  simulatedReturnValue?: unknown;
  condition?: KeeperHubConditionResult;
  raw?: unknown;
}

export interface ExecutionAttempt {
  attempt: number;
  ok: boolean;
  idempotencyKey?: string;
  bodyFingerprint?: string;
  requestId?: string;
  executionId?: string;
  status?: string;
  txHash?: string;
  explorerUrl?: string;
  gasUsed?: string;
  gasEstimate?: string;
  gasLimitMultiplier?: string;
  nonce?: string;
  error?: string;
  retryReason?: string;
}

export interface ExecutionResult {
  ok: boolean;
  executed?: boolean;
  executionId: string | null;
  status: string;
  txHash: string | null;
  explorerUrl: string | null;
  gasUsed: string | null;
  attempts: ExecutionAttempt[];
  finalError?: string;
  auditReference: string | null;
  condition?: KeeperHubConditionResult;
}

export interface DirectExecutionStatus {
  executionId: string;
  status: string;
  type?: string;
  transactionHash?: string | null;
  transactionLink?: string | null;
  gasUsedWei?: string | null;
  result?: unknown;
  error?: string | null;
  createdAt?: string;
  completedAt?: string;
  raw?: unknown;
}
