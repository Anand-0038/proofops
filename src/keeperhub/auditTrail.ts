import { KeeperHubClient } from "./client.js";
import type { DirectExecutionStatus } from "./types.js";

export interface NormalizedAuditTrail {
  executionId: string;
  status: string;
  transactionHash: string | null;
  explorerUrl: string | null;
  gasUsedWei: string | null;
  error: string | null;
  createdAt: string | null;
  completedAt: string | null;
  stepLogs: Array<{
    nodeId?: string;
    label?: string;
    status?: string;
    error?: string | null;
    gasUsed?: string | null;
  }>;
  auditReference: string;
  raw: unknown;
}

/**
 * Consume KeeperHub get_execution / direct status as source of truth.
 * Our EvidenceRecord references this — it does not replace it.
 */
export async function fetchAuditTrail(
  client: KeeperHubClient,
  executionId: string,
): Promise<NormalizedAuditTrail> {
  // Prefer workflow get_execution shape; fall back to direct execution status.
  try {
    const { data } = await client.request<{
      status?: string;
      transactionHashes?: string[];
      logs?: Array<Record<string, unknown>>;
      error?: string;
      createdAt?: string;
      completedAt?: string;
    }>("GET", `/api/workflows/executions/${executionId}/status`);

    const hash =
      data.transactionHashes?.[0] ??
      null;

    let logs: NormalizedAuditTrail["stepLogs"] = [];
    try {
      const logsRes = await client.request<{
        logs?: Array<Record<string, unknown>>;
      }>("GET", `/api/workflows/executions/${executionId}/logs`);
      logs = (logsRes.data.logs ?? []).map((l) => ({
        nodeId: l.nodeId ? String(l.nodeId) : undefined,
        label: l.label ? String(l.label) : undefined,
        status: l.status ? String(l.status) : undefined,
        error: l.error ? String(l.error) : null,
        gasUsed: l.gasUsed ? String(l.gasUsed) : null,
      }));
    } catch {
      // logs optional
    }

    return {
      executionId,
      status: String(data.status ?? "unknown"),
      transactionHash: hash,
      explorerUrl: hash
        ? `https://sepolia.etherscan.io/tx/${hash}`
        : null,
      gasUsedWei: null,
      error: data.error ? String(data.error) : null,
      createdAt: data.createdAt ? String(data.createdAt) : null,
      completedAt: data.completedAt ? String(data.completedAt) : null,
      stepLogs: logs,
      auditReference: `${client.apiUrl}/api/workflows/executions/${executionId}/status`,
      raw: data,
    };
  } catch {
    const direct: DirectExecutionStatus =
      await client.getDirectExecutionStatus(executionId);
    return {
      executionId,
      status: direct.status,
      transactionHash: direct.transactionHash ?? null,
      explorerUrl: direct.transactionLink ?? null,
      gasUsedWei: direct.gasUsedWei ?? null,
      error: direct.error ?? null,
      createdAt: direct.createdAt ?? null,
      completedAt: direct.completedAt ?? null,
      stepLogs: [],
      auditReference: `${client.apiUrl}/api/execute/${executionId}/status`,
      raw: direct,
    };
  }
}

export function mergeAuditIntoEvidenceFields(audit: NormalizedAuditTrail): {
  keeperhubExecutionId: string;
  keeperhubAuditReference: string;
  explorerUrl: string | null;
  txHash: string | null;
  gasUsed: string | null;
  confirmedAt: string | null;
} {
  return {
    keeperhubExecutionId: audit.executionId,
    keeperhubAuditReference: audit.auditReference,
    explorerUrl: audit.explorerUrl,
    txHash: audit.transactionHash,
    gasUsed: audit.gasUsedWei,
    confirmedAt: audit.completedAt,
  };
}
