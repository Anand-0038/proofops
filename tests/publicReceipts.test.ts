import { describe, expect, it } from "vitest";
import {
  createEmptyEvidence,
  type EvidenceRecord,
} from "../src/evidence/EvidenceRecord.js";
import {
  buildPublicReceiptLedger,
  verifyPublicReceiptLedger,
} from "../src/evidence/publicReceipts.js";

function liveRecord(): EvidenceRecord {
  return createEmptyEvidence({
    runId: "live-run-1",
    workflowId: "incident-keeper-direct",
    workflowVersion: "1",
    triggerType: "manual",
    agentVersion: "0.1.0",
    policyVersion: "0.1.0",
    chainId: 11_155_111,
    network: "sepolia",
    evidenceMode: "live",
    status: "confirmed",
    selectedAction: {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "pause",
      valueWei: "0",
      args: [],
    },
    simulationResult: {
      status: "ok",
      wouldRevert: false,
      gasEstimate: "42000",
    },
    submissionAttempts: 1,
    txHash: `0x${"12".repeat(32)}`,
    keeperhubExecutionId: "execution-live-1",
    keeperhubAuditReference:
      "https://app.keeperhub.com/api/execute/execution-live-1/status",
    explorerUrl: `https://sepolia.etherscan.io/tx/0x${"12".repeat(32)}`,
    confirmedAt: "2026-08-03T13:06:14.974Z",
    postState: {
      paused: true,
      blockNumber: "11410546",
      verification: { ok: true, summary: "Post-state verified for pause" },
    },
  });
}

describe("public KeeperHub receipt ledger", () => {
  it("projects only investigation-safe fields and verifies their digest", () => {
    const ledger = buildPublicReceiptLedger([liveRecord()]);
    expect(ledger.receipts).toHaveLength(1);
    expect(ledger.receipts[0]).not.toHaveProperty("observedInputs");
    expect(verifyPublicReceiptLedger(ledger)).toEqual({
      ok: true,
      receiptCount: 1,
      issues: [],
    });
  });

  it("detects receipt tampering", () => {
    const ledger = buildPublicReceiptLedger([liveRecord()]);
    ledger.receipts[0]!.action.functionName = "unpause";
    expect(verifyPublicReceiptLedger(ledger)).toMatchObject({
      ok: false,
      issues: [expect.stringContaining("digest mismatch")],
    });
  });

  it("refuses live claims without successful post-state verification", () => {
    const record = liveRecord();
    record.postState = { verification: { ok: false, summary: "failed" } };
    expect(() => buildPublicReceiptLedger([record])).toThrow(
      /post-state verification/,
    );
  });
});
