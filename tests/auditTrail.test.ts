import { describe, it, expect, vi } from "vitest";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { fetchAuditTrail, mergeAuditIntoEvidenceFields } from "../src/keeperhub/auditTrail.js";

describe("auditTrail", () => {
  it("normalizes direct execution status into audit fields", async () => {
    const client = new KeeperHubClient({ apiKey: "kh_test" });
    vi.spyOn(client, "request").mockRejectedValue(new Error("no workflow"));
    vi.spyOn(client, "getDirectExecutionStatus").mockResolvedValue({
      executionId: "direct_42",
      status: "completed",
      transactionHash: "0xdead",
      transactionLink: "https://sepolia.etherscan.io/tx/0xdead",
      gasUsedWei: "12345",
      completedAt: "2026-07-15T00:00:00Z",
    });

    const audit = await fetchAuditTrail(client, "direct_42");
    expect(audit.executionId).toBe("direct_42");
    expect(audit.transactionHash).toBe("0xdead");
    expect(audit.auditReference).toContain("/api/execute/direct_42/status");

    const merged = mergeAuditIntoEvidenceFields(audit);
    expect(merged.explorerUrl).toContain("0xdead");
    expect(merged.keeperhubAuditReference).toBeTruthy();
  });
});
