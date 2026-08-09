import { describe, it, expect } from "vitest";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalQueue } from "../src/agent/ApprovalQueue.js";
import { createEmptyEvidence } from "../src/evidence/EvidenceRecord.js";
import { loadDriftThresholds } from "../src/config/thresholds.js";
import { DEFAULT_DRIFT_THRESHOLDS } from "../src/observe/DriftDetector.js";

describe("ApprovalQueue", () => {
  it("binds approvals to an action and consumes them once", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aq-")), "a.jsonl");
    let now = Date.parse("2026-07-30T00:00:00.000Z");
    const q = new ApprovalQueue(path, {
      nowMs: () => now,
      ttlMs: 15 * 60 * 1_000,
    });
    const ev = createEmptyEvidence({
      runId: "r1",
      workflowId: "w",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    const pending = q.enqueue({
      id: "appr-1",
      runId: "r1",
      action: {
        contract: "0x1",
        functionName: "pause",
        valueWei: "0",
        severity: "high",
      },
      rationale: "hf breach",
      evidenceSnapshot: ev,
    });
    expect(pending.status).toBe("pending");
    expect(pending.actionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(pending.expiresAt).toBe("2026-07-30T00:15:00.000Z");
    expect(q.listPending()).toHaveLength(1);
    const approved = q.resolve("appr-1", "approved");
    expect(approved?.status).toBe("approved");
    expect(q.listPending()).toHaveLength(0);

    expect(q.contextFor("appr-1", pending.action)).toMatchObject({
      approvalId: "appr-1",
      state: "approved",
      actionFingerprint: pending.actionFingerprint,
    });
    expect(
      q.contextFor("appr-1", {
        ...pending.action,
        functionName: "unpause",
      }).state,
    ).toBe("invalid");

    expect(q.consume("appr-1", pending.action)?.status).toBe("consumed");
    expect(q.contextFor("appr-1", pending.action).state).toBe("consumed");

    now += 1;
  });

  it("fails closed for expired and rejected approvals", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aq-")), "a.jsonl");
    let now = Date.parse("2026-07-30T00:00:00.000Z");
    const q = new ApprovalQueue(path, {
      nowMs: () => now,
      ttlMs: 1_000,
    });
    const ev = createEmptyEvidence({
      runId: "r1",
      workflowId: "w",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    const action = {
      contract: "0x1",
      functionName: "pause",
      valueWei: "0",
      severity: "high" as const,
    };
    q.enqueue({
      id: "expired",
      runId: "r1",
      action,
      rationale: "test",
      evidenceSnapshot: ev,
    });
    now += 1_001;
    expect(q.contextFor("expired", action).state).toBe("expired");

    q.enqueue({
      id: "rejected",
      runId: "r1",
      action,
      rationale: "test",
      evidenceSnapshot: ev,
    });
    q.resolve("rejected", "rejected");
    expect(q.contextFor("rejected", action).state).toBe("rejected");
  });

  it("keeps valid approvals readable after malformed JSON rows", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aq-")), "a.jsonl");
    const ev = createEmptyEvidence({
      runId: "r2",
      workflowId: "w",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    const q = new ApprovalQueue(path);

    const first = q.enqueue({
      id: "valid-1",
      runId: "r2",
      action: {
        contract: "0x1",
        functionName: "pause",
        valueWei: "0",
        severity: "medium",
      },
      rationale: "first good row",
      evidenceSnapshot: ev,
    });
    appendFileSync(path, "this is not json\n", "utf8");
    const second = q.enqueue({
      id: "valid-2",
      runId: "r2",
      action: {
        contract: "0x1",
        functionName: "setHeartbeat",
        valueWei: "0",
        severity: "low",
      },
      rationale: "third row after corruption",
      evidenceSnapshot: ev,
    });

    const { records, issues } = q.readAll();
    expect(records.map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      line: 2,
      code: "malformed_json",
    });
    expect(q.listPending().map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});

describe("loadDriftThresholds", () => {
  it("returns defaults when env unset", () => {
    const t = loadDriftThresholds();
    expect(t.oracleStaleMediumSeconds).toBe(
      DEFAULT_DRIFT_THRESHOLDS.oracleStaleMediumSeconds,
    );
  });
});
