import { describe, it, expect, vi } from "vitest";
import { buildCooldownIndex, runCycle } from "../src/agent/runCycle.js";
import { PolicyEngine } from "../src/agent/PolicyEngine.js";
import { defaultPolicyConfig } from "../src/agent/policy.config.js";
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import { DriftDetector } from "../src/observe/DriftDetector.js";
import type { ReadLayer } from "../src/observe/ReadLayer.js";
import type { KeeperHubClient } from "../src/keeperhub/client.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalQueue } from "../src/agent/ApprovalQueue.js";

function mockRead(over: Record<string, unknown> = {}): ReadLayer {
  return {
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
      ...over,
    }),
  } as unknown as ReadLayer;
}

describe("runCycle integration", () => {
  it("detect → decide without execute makes no external state change", async () => {
    const store = new EvidenceStore(
      join(mkdtempSync(join(tmpdir(), "rc-")), "e.jsonl"),
    );
    const keeperhub = {
      simulate: vi.fn(),
      execute: vi.fn(),
    } as unknown as KeeperHubClient;

    const result = await runCycle({
      execute: false,
      readLayer: mockRead(),
      driftDetector: new DriftDetector(),
      policyEngine: new PolicyEngine({
        config: {
          ...defaultPolicyConfig,
          humanApprovalSeverityThreshold: "critical",
          cooldownSeconds: 0,
        },
      }),
      keeperhub,
      evidenceStore: store,
    });

    expect(result.drift.severity).toBe("medium");
    expect(result.policy?.verdict).toBe("allowed");
    expect(result.evidence.status).toBe("proposed");
    expect(keeperhub.simulate).not.toHaveBeenCalled();
    expect(keeperhub.execute).not.toHaveBeenCalled();
  });

  it("preserves high severity through an exactly bound approval", async () => {
    const temp = mkdtempSync(join(tmpdir(), "rc-"));
    const store = new EvidenceStore(join(temp, "e.jsonl"));
    const approvalQueue = new ApprovalQueue(join(temp, "a.jsonl"));
    const action = {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "pause",
      valueWei: "0",
      severity: "high" as const,
      rationale: "health factor breach",
    };
    const policyEngine = new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        humanApprovalSeverityThreshold: "high",
        cooldownSeconds: 0,
      },
    });
    const keeperhub = {
      simulate: vi.fn(async () => ({
        status: "ok",
        wouldRevert: false,
      })),
      execute: vi.fn(async () => ({
        ok: false,
        executionId: null,
        status: "failed",
        txHash: null,
        explorerUrl: null,
        gasUsed: null,
        attempts: [{ attempt: 1, ok: false }],
        finalError: "fixture execution intentionally has no live receipt",
        auditReference: null,
      })),
    } as unknown as KeeperHubClient;

    const proposal = await runCycle({
      execute: false,
      forceAction: action,
      readLayer: mockRead({ healthFactorBps: 9_000 }),
      policyEngine,
      keeperhub,
      evidenceStore: store,
      approvalQueue,
    });
    const approvalId = String(
      proposal.evidence.observedInputs.approvalQueueId,
    );
    approvalQueue.resolve(approvalId, "approved");

    const result = await runCycle({
      execute: true,
      approvalId,
      forceAction: action,
      readLayer: mockRead({ healthFactorBps: 9_000 }),
      policyEngine,
      keeperhub,
      evidenceStore: store,
      approvalQueue,
    });

    expect(result.policy).toMatchObject({
      verdict: "allowed",
      incidentSeverity: "high",
      approvalState: "approved",
      approvalId,
    });
    expect(result.evidence.observedInputs).toMatchObject({
      severity: "high",
      approvalId,
      approvalState: "consumed",
    });
    expect(approvalQueue.contextFor(approvalId, action).state).toBe("consumed");
    expect(keeperhub.execute).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates deterministic policy immediately before execution", async () => {
    const store = new EvidenceStore(
      join(mkdtempSync(join(tmpdir(), "rc-")), "e.jsonl"),
    );
    const policyEngine = new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        humanApprovalSeverityThreshold: "critical",
        cooldownSeconds: 0,
      },
    });
    const decide = vi.spyOn(policyEngine, "decide");
    const keeperhub = {
      simulate: vi.fn(async () => ({
        status: "ok",
        wouldRevert: false,
      })),
      execute: vi.fn(async () => ({
        ok: false,
        executionId: null,
        status: "failed",
        txHash: null,
        explorerUrl: null,
        gasUsed: null,
        attempts: [{ attempt: 1, ok: false }],
        finalError: "fixture failure",
        auditReference: null,
      })),
    } as unknown as KeeperHubClient;

    await runCycle({
      execute: true,
      forceAction: {
        contract: "0x0000000000000000000000000000000000000001",
        functionName: "setHeartbeat",
        valueWei: "0",
        severity: "medium",
      },
      readLayer: mockRead(),
      policyEngine,
      keeperhub,
      evidenceStore: store,
    });

    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("records runbookId on high HF → pause path", async () => {
    const store = new EvidenceStore(
      join(mkdtempSync(join(tmpdir(), "rc-")), "e.jsonl"),
    );
    const result = await runCycle({
      execute: false,
      readLayer: mockRead({ healthFactorBps: 9000, oracleAgeSeconds: 0 }),
      policyEngine: new PolicyEngine({
        config: {
          ...defaultPolicyConfig,
          humanApprovalSeverityThreshold: "critical",
        },
      }),
      evidenceStore: store,
    });
    expect(result.evidence.observedInputs.runbookId).toBe("incident.pause");
    expect(result.evidence.selectedAction?.functionName).toBe("pause");
  });

  it("maps fixture scenario ids to deterministic runbooks", async () => {
    const store = new EvidenceStore(
      join(mkdtempSync(join(tmpdir(), "rc-")), "e.jsonl"),
    );
    const policyEngine = new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        humanApprovalSeverityThreshold: "critical",
      },
    });
    const scenarios: Array<{
      scenarioId: string;
      functionName: string | null;
      runbookId: string | null;
    }> = [
      {
        scenarioId: "oracle-stale",
        functionName: "setHeartbeat",
        runbookId: "incident.repair_heartbeat",
      },
      {
        scenarioId: "health-factor-breach",
        functionName: "pause",
        runbookId: "incident.pause",
      },
      {
        scenarioId: "parameter-drift",
        functionName: "setMaxDeviationBps",
        runbookId: "incident.reset_deviation",
      },
      {
        scenarioId: "recovered",
        functionName: null,
        runbookId: null,
      },
    ];

    for (const testCase of scenarios) {
      const result = await runCycle({
        execute: false,
        scenarioId: testCase.scenarioId,
        readLayer: mockRead({
          oracleAgeSeconds: 0,
          healthFactorBps: 15000,
          maxDeviationBps: 100,
        }),
        policyEngine,
        evidenceStore: store,
      });
      if (testCase.functionName === null) {
        expect(result.evidence.status).toBe("skipped");
        expect(result.evidence.selectedAction).toBeNull();
      } else {
        expect(result.evidence.selectedAction?.functionName).toBe(
          testCase.functionName,
        );
        expect(result.evidence.observedInputs.runbookId).toBe(testCase.runbookId);
      }
    }
  });

  it("recomputes cooldown state from confirmed evidence across engine instances", async () => {
    const store = new EvidenceStore(
      join(mkdtempSync(join(tmpdir(), "rc-")), "e.jsonl"),
    );
    const txHash = "0x".padEnd(66, "a");
    const firstExecution = {
      ok: true,
      executionId: "exec-1",
      status: "confirmed",
      txHash,
      explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      gasUsed: "1000000",
      attempts: [
        {
          attempt: 1,
          ok: true,
          executionId: "exec-1",
          txHash,
          explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
          gasEstimate: "1000000",
          gasLimitMultiplier: "1.0",
          nonce: "7",
        },
      ],
      auditReference: "https://keeperhub.com/audit/exec-1",
      executed: true,
    } as const;
    const keeperhub = {
      simulate: vi.fn(async () => ({ status: "ok", wouldRevert: false })),
      execute: vi.fn(async () => firstExecution),
      request: vi.fn(async () => ({
        data: {
          status: "confirmed",
          transactionHashes: [txHash],
          createdAt: "2026-07-30T00:00:00.000Z",
          completedAt: "2026-07-30T00:00:01.000Z",
        },
        status: 200,
      })),
      getDirectExecutionStatus: vi.fn(async () => ({
        executionId: "exec-1",
        status: "confirmed",
        transactionHash: txHash,
        transactionLink: `https://sepolia.etherscan.io/tx/${txHash}`,
        gasUsedWei: "1000000",
      })),
      apiUrl: "https://api.keeperhub.com",
    } as unknown as KeeperHubClient;

    const action = {
      contract: "0x0000000000000000000000000000000000000001",
      functionName: "pause",
      valueWei: "0",
      severity: "low" as const,
    };

    const firstResult = await runCycle({
      execute: true,
      forceAction: action,
      readLayer: mockRead({ healthFactorBps: 9000 }),
      policyEngine: new PolicyEngine({
        config: {
          ...defaultPolicyConfig,
          cooldownSeconds: 60,
          humanApprovalSeverityThreshold: "critical",
        },
      }),
      keeperhub,
      evidenceStore: store,
    });
    expect(firstResult.evidence.status).toBe("confirmed");

    const confirmedAt = Date.parse(firstResult.evidence.confirmedAt!);
    const rebuiltEngine = new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        cooldownSeconds: 60,
        humanApprovalSeverityThreshold: "critical",
      },
      nowMs: () => confirmedAt + 30 * 1000,
      lastActionAt: buildCooldownIndex(store.readAll().records),
    });
    const secondResult = await runCycle({
      execute: false,
      forceAction: action,
      readLayer: mockRead({ healthFactorBps: 9000 }),
      policyEngine: rebuiltEngine,
      keeperhub,
      evidenceStore: store,
    });

    expect(secondResult.policy?.reasonCode).toBe("COOLDOWN_ACTIVE");
    expect(secondResult.evidence.status).toBe("policy_blocked");
  });

  it("skips when healthy", async () => {
    const store = new EvidenceStore(
      join(mkdtempSync(join(tmpdir(), "rc-")), "e.jsonl"),
    );
    const result = await runCycle({
      execute: false,
      readLayer: mockRead({
        oracleAgeSeconds: 10,
        healthFactorBps: 20000,
        maxDeviationBps: 100,
      }),
      evidenceStore: store,
    });
    expect(result.evidence.status).toBe("skipped");
    expect(result.policy).toBeNull();
  });
});
