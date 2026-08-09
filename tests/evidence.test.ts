import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  EvidenceStore,
  createEmptyEvidence,
  formatEvidenceMarkdown,
} from "../src/evidence/EvidenceRecord.js";
import { aggregateEvidence, formatMetricsMarkdown } from "../src/evidence/aggregate.js";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("EvidenceRecord", () => {
  it("persists and reloads JSONL records with full schema fields", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ev-")), "e.jsonl");
    const store = new EvidenceStore(path);
    const r = createEmptyEvidence({
      runId: "run-1",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    r.evidenceMode = "live";
    r.status = "confirmed";
    r.txHash = `0x${"a".repeat(64)}`;
    r.keeperhubExecutionId = "direct_1";
    r.keeperhubAuditReference = "https://app.keeperhub.com/api/execute/direct_1/status";
    r.explorerUrl = `https://sepolia.etherscan.io/tx/${r.txHash}`;
    r.submissionAttempts = 2;
    r.retryReasons = ["transient"];
    store.append(r);

    const { records, issues } = store.readAll();
    expect(records).toHaveLength(1);
    expect(issues).toHaveLength(0);
    expect(records[0]!.runId).toBe("run-1");
    expect(records[0]!.keeperhubAuditReference).toContain("direct_1");

    const md = formatEvidenceMarkdown(records[0]!);
    expect(md).toContain("run-1");
    expect(md).toContain(r.txHash);
  });

  it("rejects fixture records that claim live transaction proof", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ev-")), "e.jsonl");
    const store = new EvidenceStore(path);
    const r = createEmptyEvidence({
      runId: "fixture-lie",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "scenario",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    r.status = "confirmed";
    r.txHash = `0x${"b".repeat(64)}`;
    r.explorerUrl = `https://sepolia.etherscan.io/tx/${r.txHash}`;

    expect(() => store.append(r)).toThrow(/fixture/i);
  });

  it("reports malformed lines while preserving valid records", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ev-")), "e.jsonl");
    const store = new EvidenceStore(path);
    const valid = createEmptyEvidence({
      runId: "valid",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    store.append(valid);
    appendFileSync(path, "{malformed-json\n", "utf8");

    const result = store.readAll();

    expect(result.records.map((record) => record.runId)).toEqual(["valid"]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        line: 2,
        code: "malformed_json",
      }),
    ]);
  });
});

describe("aggregateEvidence", () => {
  it("reports rates with explicit denominators and never fabricates", () => {
    const base = () =>
      createEmptyEvidence({
        runId: randomUUID(),
        workflowId: "wf",
        workflowVersion: "1",
        triggerType: "scenario",
        agentVersion: "0.1.0",
        policyVersion: "0.1.0",
        chainId: 11155111,
        network: "sepolia",
      });

    const a = base();
    a.evidenceMode = "live";
    a.status = "confirmed";
    a.txHash = `0x${"a".repeat(64)}`;
    a.explorerUrl = `https://sepolia.etherscan.io/tx/${a.txHash}`;
    a.keeperhubExecutionId = "direct_a";
    a.keeperhubAuditReference =
      "https://app.keeperhub.com/api/execute/direct_a/status";
    a.submissionAttempts = 1;
    a.submittedAt = "2026-07-15T00:00:00Z";
    a.confirmedAt = "2026-07-15T00:00:10Z";
    a.gasUsed = "21000";

    const b = base();
    b.status = "fixture_recovered";
    b.submissionAttempts = 3;
    b.retryReasons = ["gas"];

    const c = base();
    c.status = "simulation_blocked";

    const m = aggregateEvidence([a, b, c]);
    expect(m.denominatorRuns).toBe(3);
    expect(m.confirmed).toBe(1);
    expect(m.fixtureRecovered).toBe(1);
    expect(m.liveConfirmed).toBe(1);
    expect(m.simulationBlocked).toBe(1);
    expect(m.successRate).toBeCloseTo(1 / 3);
    expect(m.recoveredAfterRetry).toBe(1);
    expect(m.recoveryRate).toBe(1); // 1/1 multi-attempt
    expect(m.medianConfirmationLatencyMs).toBe(10_000);

    const md = formatMetricsMarkdown(m);
    expect(md).toContain("denominator");
    expect(md).toMatch(/3/);
  });

  it("returns n/a rates on empty store", () => {
    const m = aggregateEvidence([]);
    expect(m.denominatorRuns).toBe(0);
    expect(m.successRate).toBeNull();
    expect(m.recoveryRate).toBeNull();
  });
});
