import { describe, expect, it } from "vitest";
import {
  createEmptyEvidence,
  deriveEvidenceMode,
  isVerifiedLiveExecution,
} from "../src/evidence/EvidenceRecord.js";

function record() {
  return createEmptyEvidence({
    runId: "run-1",
    workflowId: "wf",
    workflowVersion: "1",
    triggerType: "manual",
    agentVersion: "0.1.0",
    policyVersion: "0.1.0",
    chainId: 11155111,
    network: "sepolia",
  });
}

describe("evidence trust classification", () => {
  it.each([
    [{ observationIsFixture: true, hasLiveExecution: false }, "fixture"],
    [{ observationIsFixture: false, hasLiveExecution: false }, "live"],
    [{ observationIsFixture: true, hasLiveExecution: true }, "mixed"],
    [{ observationIsFixture: false, hasLiveExecution: true }, "live"],
  ] as const)("derives %s as %s", (input, expected) => {
    expect(deriveEvidenceMode(input)).toBe(expected);
  });

  it("counts only complete live or mixed KeeperHub receipts as verified", () => {
    const fixture = record();
    fixture.status = "fixture_recovered";
    expect(isVerifiedLiveExecution(fixture)).toBe(false);

    const live = record();
    live.evidenceMode = "live";
    live.status = "confirmed";
    live.keeperhubExecutionId = "direct_1";
    live.keeperhubAuditReference =
      "https://app.keeperhub.com/api/execute/direct_1/status";
    live.txHash = `0x${"1".repeat(64)}`;
    live.explorerUrl = `https://sepolia.etherscan.io/tx/${live.txHash}`;
    expect(isVerifiedLiveExecution(live)).toBe(true);

    live.txHash = "0xdry1";
    expect(isVerifiedLiveExecution(live)).toBe(false);
  });
});
