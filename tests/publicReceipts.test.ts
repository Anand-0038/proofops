import { describe, expect, it } from "vitest";
import {
  createEmptyEvidence,
  type EvidenceRecord,
} from "../src/evidence/EvidenceRecord.js";
import {
  buildPublicReceiptLedger,
  verifyActionLogAnchor,
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

  it("binds an ActionLog anchor to the exact public ledger bytes", () => {
    const ledgerBytes = Buffer.from("public-ledger\n");
    const incident = "proofops-public-receipts-v1";
    const anchor = {
      schemaVersion: "proofops.action-log-anchor.v1",
      chainId: 11_155_111,
      actionLogAddress: "0x0000000000000000000000000000000000000002",
      actionIndex: 0,
      incident,
      incidentId: "0xdbe19bea4c09e78eb496cdf138c0dcdc09ff52f9e20e66e501690856c132d7b1",
      artifactSha256:
        "0xb1569b82b36a8227b4d80ac79a908188be6993f47174d36f3d2bac7feefe0d53",
      artifactUri: "https://raw.githubusercontent.com/owner/repo/commit/ledger.json",
      actor: "0x0000000000000000000000000000000000000003",
      recordedAtUnix: 1_786_270_800,
      blockNumber: "11451622",
      keeperhubExecutionId: "execution-anchor-1",
      keeperhubAuditReference:
        "https://app.keeperhub.com/api/execute/execution-anchor-1/status",
      txHash: `0x${"34".repeat(32)}`,
      explorerUrl: `https://sepolia.etherscan.io/tx/0x${"34".repeat(32)}`,
    };

    expect(verifyActionLogAnchor({ ledgerBytes, anchor })).toEqual({
      ok: true,
      issues: [],
    });
    anchor.artifactSha256 = `0x${"00".repeat(32)}`;
    expect(verifyActionLogAnchor({ ledgerBytes, anchor })).toMatchObject({
      ok: false,
      issues: [expect.stringContaining("digest")],
    });
  });
});
