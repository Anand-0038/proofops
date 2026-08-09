import { createHash } from "node:crypto";
import { z } from "zod";
import { keccak256, stringToHex } from "viem";
import {
  isVerifiedLiveExecution,
  type EvidenceRecord,
} from "./EvidenceRecord.js";

const PublicReceiptCoreSchema = z
  .object({
    runId: z.string().min(1),
    evidenceMode: z.enum(["live", "mixed"]),
    status: z.literal("confirmed"),
    chainId: z.number().int().positive(),
    network: z.string().min(1),
    action: z
      .object({
        contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        functionName: z.string().min(1),
        valueWei: z.string(),
        args: z.array(z.unknown()),
      })
      .strict(),
    simulation: z
      .object({
        status: z.literal("ok"),
        wouldRevert: z.literal(false),
        gasEstimate: z.string().optional(),
      })
      .strict(),
    submissionAttempts: z.number().int().positive(),
    retryReasons: z.array(z.string()),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    keeperhubExecutionId: z.string().min(6),
    keeperhubAuditReference: z.string().url().startsWith("https://"),
    explorerUrl: z.string().url().startsWith("https://"),
    confirmedAt: z.string().datetime(),
    postStateVerification: z
      .object({
        ok: z.literal(true),
        summary: z.string().min(1),
        paused: z.boolean().optional(),
        blockNumber: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export type PublicReceiptCore = z.infer<typeof PublicReceiptCoreSchema>;

export const PublicReceiptSchema = PublicReceiptCoreSchema.extend({
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const PublicReceiptLedgerSchema = z
  .object({
    schemaVersion: z.literal("proofops.public-receipts.v1"),
    evidenceThrough: z.string().datetime(),
    source:
      z.literal("sanitized projection of schema-validated local evidence"),
    authority: z.literal(
      "KeeperHub audit status, chain explorer, and independent RPC post-state",
    ),
    receipts: z.array(PublicReceiptSchema).min(1),
  })
  .strict();

export type PublicReceiptLedger = z.infer<typeof PublicReceiptLedgerSchema>;

export const ActionLogAnchorSchema = z
  .object({
    schemaVersion: z.literal("proofops.action-log-anchor.v1"),
    chainId: z.number().int().positive(),
    actionLogAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    actionIndex: z.number().int().nonnegative(),
    incident: z.string().min(1),
    incidentId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    artifactSha256: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    artifactUri: z.string().url().startsWith("https://"),
    actor: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    recordedAtUnix: z.number().int().positive(),
    blockNumber: z.string().regex(/^\d+$/),
    keeperhubExecutionId: z.string().min(6),
    keeperhubAuditReference: z.string().url().startsWith("https://"),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    explorerUrl: z.string().url().startsWith("https://"),
  })
  .strict();

export type ActionLogAnchor = z.infer<typeof ActionLogAnchorSchema>;

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function verificationFrom(record: EvidenceRecord): {
  ok: true;
  summary: string;
  paused?: boolean;
  blockNumber?: string;
} {
  const post = record.postState;
  const verification =
    post && typeof post.verification === "object" && post.verification !== null
      ? (post.verification as Record<string, unknown>)
      : null;
  if (verification?.ok !== true || typeof verification.summary !== "string") {
    throw new Error(
      `Live receipt ${record.runId} lacks successful independent post-state verification`,
    );
  }
  return {
    ok: true,
    summary: verification.summary,
    ...(typeof post?.paused === "boolean" ? { paused: post.paused } : {}),
    ...(typeof post?.blockNumber === "string"
      ? { blockNumber: post.blockNumber }
      : {}),
  };
}

export function projectPublicReceipt(record: EvidenceRecord) {
  if (!isVerifiedLiveExecution(record) || !record.selectedAction) {
    throw new Error(`Evidence ${record.runId} is not a complete live receipt`);
  }
  if (
    record.simulationResult?.status !== "ok" ||
    record.simulationResult.wouldRevert !== false ||
    !record.confirmedAt ||
    !record.txHash ||
    !record.keeperhubExecutionId ||
    !record.keeperhubAuditReference ||
    !record.explorerUrl
  ) {
    throw new Error(
      `Live receipt ${record.runId} lacks simulation or terminal fields`,
    );
  }

  const core = PublicReceiptCoreSchema.parse({
    runId: record.runId,
    evidenceMode: record.evidenceMode,
    status: record.status,
    chainId: record.chainId,
    network: record.network,
    action: {
      contract: record.selectedAction.contract,
      functionName: record.selectedAction.functionName,
      valueWei: record.selectedAction.valueWei,
      args: record.selectedAction.args ?? [],
    },
    simulation: {
      status: record.simulationResult.status,
      wouldRevert: record.simulationResult.wouldRevert,
      ...(record.simulationResult.gasEstimate
        ? { gasEstimate: record.simulationResult.gasEstimate }
        : {}),
    },
    submissionAttempts: record.submissionAttempts,
    retryReasons: record.retryReasons,
    txHash: record.txHash,
    keeperhubExecutionId: record.keeperhubExecutionId,
    keeperhubAuditReference: record.keeperhubAuditReference,
    explorerUrl: record.explorerUrl,
    confirmedAt: record.confirmedAt,
    postStateVerification: verificationFrom(record),
  });
  return { ...core, receiptSha256: sha256Json(core) };
}

export function buildPublicReceiptLedger(
  records: EvidenceRecord[],
): PublicReceiptLedger {
  const receipts = records
    .filter(isVerifiedLiveExecution)
    .map(projectPublicReceipt)
    .sort((left, right) => left.confirmedAt.localeCompare(right.confirmedAt));
  if (receipts.length === 0) {
    throw new Error("No verified live KeeperHub receipts are available to publish");
  }
  return PublicReceiptLedgerSchema.parse({
    schemaVersion: "proofops.public-receipts.v1",
    evidenceThrough: receipts.at(-1)?.confirmedAt,
    source: "sanitized projection of schema-validated local evidence",
    authority:
      "KeeperHub audit status, chain explorer, and independent RPC post-state",
    receipts,
  });
}

export function verifyPublicReceiptLedger(value: unknown): {
  ok: boolean;
  receiptCount: number;
  issues: string[];
} {
  const parsed = PublicReceiptLedgerSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      receiptCount: 0,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }
  const issues: string[] = [];
  const txHashes = new Set<string>();
  const executionIds = new Set<string>();
  for (const receipt of parsed.data.receipts) {
    const { receiptSha256, ...core } = receipt;
    if (sha256Json(core) !== receiptSha256) {
      issues.push(`Receipt digest mismatch: ${receipt.runId}`);
    }
    if (!receipt.explorerUrl.toLowerCase().includes(receipt.txHash.toLowerCase())) {
      issues.push(`Explorer URL does not bind transaction: ${receipt.runId}`);
    }
    if (!receipt.keeperhubAuditReference.includes(receipt.keeperhubExecutionId)) {
      issues.push(`Audit URL does not bind execution: ${receipt.runId}`);
    }
    if (txHashes.has(receipt.txHash)) {
      issues.push(`Duplicate transaction hash: ${receipt.txHash}`);
    }
    if (executionIds.has(receipt.keeperhubExecutionId)) {
      issues.push(`Duplicate KeeperHub execution: ${receipt.keeperhubExecutionId}`);
    }
    txHashes.add(receipt.txHash);
    executionIds.add(receipt.keeperhubExecutionId);
  }
  return {
    ok: issues.length === 0,
    receiptCount: parsed.data.receipts.length,
    issues,
  };
}

export function verifyActionLogAnchor(input: {
  ledgerBytes: Uint8Array;
  anchor: unknown;
}): { ok: boolean; issues: string[] } {
  const parsed = ActionLogAnchorSchema.safeParse(input.anchor);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }
  const anchor = parsed.data;
  const issues: string[] = [];
  const artifactSha256 = `0x${createHash("sha256")
    .update(input.ledgerBytes)
    .digest("hex")}`;
  if (artifactSha256.toLowerCase() !== anchor.artifactSha256.toLowerCase()) {
    issues.push("ActionLog artifact digest does not match the public ledger");
  }
  if (
    keccak256(stringToHex(anchor.incident)).toLowerCase() !==
    anchor.incidentId.toLowerCase()
  ) {
    issues.push("ActionLog incident ID does not match the incident label");
  }
  if (!anchor.keeperhubAuditReference.includes(anchor.keeperhubExecutionId)) {
    issues.push("ActionLog audit URL does not bind the KeeperHub execution");
  }
  if (!anchor.explorerUrl.toLowerCase().includes(anchor.txHash.toLowerCase())) {
    issues.push("ActionLog explorer URL does not bind the transaction");
  }
  return { ok: issues.length === 0, issues };
}
