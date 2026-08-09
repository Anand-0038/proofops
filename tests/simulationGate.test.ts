import { describe, it, expect, vi, beforeEach } from "vitest";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { runCycle } from "../src/agent/runCycle.js";
import { PolicyEngine } from "../src/agent/PolicyEngine.js";
import { defaultPolicyConfig } from "../src/agent/policy.config.js";
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import { DriftDetector } from "../src/observe/DriftDetector.js";
import { ReadLayer } from "../src/observe/ReadLayer.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("simulation gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks would_revert with zero submission attempts", async () => {
    const client = new KeeperHubClient({ apiKey: "kh_test" });
    vi.spyOn(client, "simulate").mockResolvedValue({
      status: "would_revert",
      wouldRevert: true,
      revertReason: "Error(NotOwner())",
    });
    const executeSpy = vi.spyOn(client, "execute");

    const storePath = join(mkdtempSync(join(tmpdir(), "ev-")), "e.jsonl");
    const store = new EvidenceStore(storePath);

    const readLayer = {
      readLiveState: async () => ({
        source: "mock" as const,
        mockLabeled: true,
        timestamp: new Date().toISOString(),
        contract: "0x0000000000000000000000000000000000000001",
        heartbeatSeconds: 3600,
        lastUpdated: 0,
        oracleAgeSeconds: 8000,
        price: "1",
        maxDeviationBps: 100,
        paused: false,
        healthFactorBps: 15000,
      }),
    } as unknown as ReadLayer;

    const result = await runCycle({
      execute: true,
      keeperhub: client,
      evidenceStore: store,
      readLayer,
      driftDetector: new DriftDetector(),
      policyEngine: new PolicyEngine({
        config: {
          ...defaultPolicyConfig,
          humanApprovalSeverityThreshold: "critical",
        },
      }),
      forceAction: {
        contract: "0x0000000000000000000000000000000000000001",
        functionName: "setHeartbeat",
        valueWei: "0",
        severity: "medium",
        rationale: "test unsafe",
      },
      conditionalExecution: false,
    });

    expect(result.evidence.status).toBe("simulation_blocked");
    expect(result.evidence.submissionAttempts).toBe(0);
    expect(result.evidence.simulationResult?.revertReason).toContain("NotOwner");
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
