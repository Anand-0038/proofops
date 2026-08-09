import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { EvidenceRecord } from "../evidence/EvidenceRecord.js";
import { EvidenceRecordSchema } from "../evidence/EvidenceRecord.js";
import {
  fingerprintProposedAction,
  type ApprovalContext,
  type ProposedAction,
} from "../agent/PolicyEngine.js";

export interface PendingApproval {
  id: string;
  runId: string;
  createdAt: string;
  action: ProposedAction;
  actionFingerprint: string;
  rationale: string;
  evidenceSnapshot: EvidenceRecord;
  status: "pending" | "approved" | "rejected" | "consumed";
  expiresAt: string;
  resolvedAt?: string;
  consumedAt?: string;
}

export interface ApprovalReadIssue {
  line: number;
  code: "malformed_json" | "schema_invalid";
  message: string;
}

export interface ApprovalReadResult {
  records: PendingApproval[];
  issues: ApprovalReadIssue[];
}

const ProposedActionSchema = z.object({
  contract: z.string(),
  functionName: z.string(),
  valueWei: z.string(),
  args: z.array(z.unknown()).optional(),
  severity: z.enum(["none", "low", "medium", "high", "critical"]),
  rationale: z.string().optional(),
  actionKey: z.string().optional(),
});

const PendingApprovalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  action: ProposedActionSchema,
  actionFingerprint: z.string(),
  rationale: z.string(),
  evidenceSnapshot: EvidenceRecordSchema,
  status: z.union([
    z.literal("pending"),
    z.literal("approved"),
    z.literal("rejected"),
    z.literal("consumed"),
  ]),
  expiresAt: z.string(),
  resolvedAt: z.string().optional(),
  consumedAt: z.string().optional(),
});

/**
 * Human-approval queue for policy verdict `approval_required`.
 * Persisted as JSONL — operator approves before execute.
 */
export class ApprovalQueue {
  private readonly nowMs: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly path: string,
    options: {
      nowMs?: () => number;
      ttlMs?: number;
    } = {},
  ) {
    this.nowMs = options.nowMs ?? Date.now;
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1_000;
  }

  private ensure(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.path)) writeFileSync(this.path, "", "utf8");
  }

  enqueue(
    entry: Omit<
      PendingApproval,
      "status" | "createdAt" | "expiresAt" | "actionFingerprint"
    > & {
      createdAt?: string;
      expiresAt?: string;
    },
  ): PendingApproval {
    this.ensure();
    const createdAt =
      entry.createdAt ?? new Date(this.nowMs()).toISOString();
    const full: PendingApproval = {
      ...entry,
      createdAt,
      expiresAt:
        entry.expiresAt ??
        new Date(Date.parse(createdAt) + this.ttlMs).toISOString(),
      actionFingerprint: fingerprintProposedAction(entry.action),
      status: "pending",
    };
    appendFileSync(this.path, `${JSON.stringify(full)}\n`, "utf8");
    return full;
  }

  readAll(): ApprovalReadResult {
    this.ensure();
    const raw = readFileSync(this.path, "utf8").trim();
    if (!raw) return { records: [], issues: [] };

    const records: PendingApproval[] = [];
    const issues: ApprovalReadIssue[] = [];

    for (const [index, line] of raw.split("\n").entries()) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        const validated = PendingApprovalSchema.safeParse(parsed);
        if (!validated.success) {
          issues.push({
            line: index + 1,
            code: "schema_invalid",
            message: validated.error.issues
              .map((entry) => entry.message)
              .join("; "),
          });
          continue;
        }
        records.push(validated.data);
      } catch (error) {
        issues.push({
          line: index + 1,
          code: "malformed_json",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { records, issues };
  }

  listPending(): PendingApproval[] {
    // Latest status per id wins
    const byId = new Map<string, PendingApproval>();
    for (const e of this.readAll().records) byId.set(e.id, e);
    return [...byId.values()].filter(
      (entry) =>
        entry.status === "pending" &&
        Date.parse(entry.expiresAt) > this.nowMs(),
    );
  }

  resolve(id: string, status: "approved" | "rejected"): PendingApproval | null {
    const pending = this.listPending().find((e) => e.id === id);
    if (!pending) return null;
    const resolved: PendingApproval = {
      ...pending,
      status,
      resolvedAt: new Date(this.nowMs()).toISOString(),
    };
    appendFileSync(this.path, `${JSON.stringify(resolved)}\n`, "utf8");
    return resolved;
  }

  contextFor(id: string, action: ProposedAction): ApprovalContext {
    const entry = this.latest(id);
    if (!entry) return { approvalId: id, state: "missing" };
    if (entry.actionFingerprint !== fingerprintProposedAction(action)) {
      return {
        approvalId: id,
        state: "invalid",
        actionFingerprint: entry.actionFingerprint,
      };
    }
    if (Date.parse(entry.expiresAt) <= this.nowMs()) {
      return {
        approvalId: id,
        state: "expired",
        actionFingerprint: entry.actionFingerprint,
      };
    }
    return {
      approvalId: id,
      state: entry.status,
      actionFingerprint: entry.actionFingerprint,
    };
  }

  consume(id: string, action: ProposedAction): PendingApproval | null {
    const context = this.contextFor(id, action);
    if (context.state !== "approved") return null;
    const approved = this.latest(id);
    if (!approved) return null;
    const consumed: PendingApproval = {
      ...approved,
      status: "consumed",
      consumedAt: new Date(this.nowMs()).toISOString(),
    };
    appendFileSync(this.path, `${JSON.stringify(consumed)}\n`, "utf8");
    return consumed;
  }

  private latest(id: string): PendingApproval | null {
    let result: PendingApproval | null = null;
    for (const entry of this.readAll().records) {
      if (entry.id === id) result = entry;
    }
    return result;
  }
}
