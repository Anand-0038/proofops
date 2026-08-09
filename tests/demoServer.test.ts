import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "../src/agent/ApprovalQueue.js";
import {
  createEmptyEvidence,
  EvidenceStore,
} from "../src/evidence/EvidenceRecord.js";
import { createProofOpsServer } from "../src/demo/server.js";
import type {
  RunCycleOptions,
  RunCycleResult,
} from "../src/agent/runCycle.js";

const TOKEN = "operator-token-with-enough-entropy";
const CONTRACT = "0x0000000000000000000000000000000000000001";
const servers: Array<ReturnType<typeof createProofOpsServer>> = [];

function cycleResult(status = "proposed"): RunCycleResult {
  const evidence = createEmptyEvidence({
    runId: "run-api",
    workflowId: "wf",
    workflowVersion: "1",
    triggerType: "webhook",
    agentVersion: "0.1.0",
    policyVersion: "0.1.0",
    chainId: 11155111,
    network: "sepolia",
  });
  evidence.status = status as typeof evidence.status;
  return {
    evidence,
    state: {
      source: "mock" as const,
      mockLabeled: true,
      timestamp: "2026-07-30T00:00:00.000Z",
      contract: CONTRACT,
    },
    drift: {
      severity: "medium" as const,
      findings: [],
      proposedAction: null,
      counterfactual: {
        expectedLossIfNoAction: "fixture",
        simulatedImpactOfAction: "fixture",
      },
    },
    policy: null,
    simulation: null,
    execution: null,
  };
}

async function start(options: {
  runCycleFn?: (options?: RunCycleOptions) => Promise<RunCycleResult>;
  maxBodyBytes?: number;
} = {}) {
  const temp = mkdtempSync(join(tmpdir(), "proofops-api-"));
  const evidenceStore = new EvidenceStore(join(temp, "evidence.jsonl"));
  const approvalQueue = new ApprovalQueue(join(temp, "approvals.jsonl"));
  const runCycleFn =
    options.runCycleFn ?? vi.fn(async () => cycleResult());
  const server = createProofOpsServer({
    operatorToken: TOKEN,
    allowedOrigins: ["https://proofops.test"],
    evidenceStore,
    approvalQueue,
    runCycleFn,
    staticDir: join(process.cwd(), "app/dashboard"),
    proofDir: join(temp, "proof"),
    publicEvidenceDir: join(process.cwd(), "docs/evidence"),
    keeperHubStatusFn: async () => ({
      configured: true,
      reachable: true,
      transport: "mcp_streamable_http",
      serverName: "KeeperHub",
      serverVersion: "1.2.0",
      protocolVersion: "2025-06-18",
      toolCount: 35,
      requiredTools: { searchWorkflows: true, callWorkflow: true },
      checkedAt: "2026-08-09T00:00:00.000Z",
      stale: false,
    }),
    maxBodyBytes: options.maxBodyBytes,
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    evidenceStore,
    approvalQueue,
    runCycleFn,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

function operatorHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Origin: "https://proofops.test",
    "Content-Type": "application/json",
    ...extra,
  };
}

describe("ProofOps demo server", () => {
  it("serves health, incidents, evidence, metrics, and approvals safely", async () => {
    const { baseUrl, evidenceStore } = await start();
    evidenceStore.append(
      createEmptyEvidence({
        runId: "fixture-1",
        workflowId: "wf",
        workflowVersion: "1",
        triggerType: "scenario",
        agentVersion: "0.1.0",
        policyVersion: "0.1.0",
        chainId: 11155111,
        network: "sepolia",
      }),
    );

    const [health, incidents, evidence, metrics, approvals] = await Promise.all(
      [
        fetch(`${baseUrl}/api/health`),
        fetch(`${baseUrl}/api/incidents`),
        fetch(`${baseUrl}/api/evidence`),
        fetch(`${baseUrl}/api/metrics`),
        fetch(`${baseUrl}/api/approvals`),
      ],
    );

    expect(await health.json()).toMatchObject({
      ok: true,
      service: "proofops",
      localReady: true,
      submissionReady: false,
      submissionReadinessSource: "release_gate",
      verifiedLiveEvidenceRecords: 0,
    });
    const incidentBody = (await incidents.json()) as {
      incidents: unknown[];
    };
    expect(incidentBody.incidents.length).toBeGreaterThan(2);
    expect(await evidence.json()).toMatchObject({
      records: [expect.objectContaining({ runId: "fixture-1" })],
      issues: [],
    });
    expect(await metrics.json()).toMatchObject({
      denominatorRuns: 1,
      liveConfirmed: 0,
    });
    expect(await approvals.json()).toEqual({ approvals: [] });
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("cache-control")).toContain("no-store");
    expect(health.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves verified public receipts and sanitized KeeperHub MCP status", async () => {
    const { baseUrl } = await start();
    const [evidence, keeperhub] = await Promise.all([
      fetch(`${baseUrl}/api/public-evidence`),
      fetch(`${baseUrl}/api/integrations/keeperhub`),
    ]);
    expect(evidence.status).toBe(200);
    expect(await evidence.json()).toMatchObject({
      verified: true,
      ledger: { schemaVersion: "proofops.public-receipts.v1" },
      anchor: { schemaVersion: "proofops.action-log-anchor.v1" },
    });
    expect(await keeperhub.json()).toMatchObject({
      configured: true,
      reachable: true,
      toolCount: 35,
    });
  });

  it("does not treat a verified live receipt as complete submission evidence", async () => {
    const { baseUrl, evidenceStore } = await start();
    evidenceStore.append(
      createEmptyEvidence({
        runId: "live-receipt-without-public-assets",
        workflowId: "wf",
        workflowVersion: "1",
        triggerType: "blockchain_event",
        agentVersion: "0.1.0",
        policyVersion: "0.1.0",
        chainId: 11155111,
        network: "sepolia",
        evidenceMode: "live",
        status: "confirmed",
        keeperhubExecutionId: "keeperhub-live-receipt",
        txHash: `0x${"a".repeat(64)}`,
        explorerUrl: `https://sepolia.etherscan.io/tx/0x${"a".repeat(64)}`,
        keeperhubAuditReference:
          "https://app.keeperhub.com/api/execute/keeperhub-live-receipt/status",
      }),
    );

    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      localReady: true,
      submissionReady: false,
      submissionReadinessSource: "release_gate",
      verifiedLiveEvidenceRecords: 1,
    });
  });

  it("makes cycle proposal-only even when the body requests execution", async () => {
    const runCycleFn = vi.fn(async () => cycleResult("proposed"));
    const { baseUrl } = await start({
      runCycleFn,
    });

    const unauthorized = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify({
        execute: true,
        confirmExecute: true,
        approvalId: "forged",
        incidentId: "health-factor-breach",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "proposed",
      executionAuthorized: false,
    });
    expect(runCycleFn).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: false,
        scenarioId: "health-factor-breach",
        triggerType: "webhook",
      }),
    );
  });

  it("maps fixture incident IDs to deterministic scenario runbooks and ignores client-supplied action payloads", async () => {
    const runCycleFn = vi.fn(async () => cycleResult("proposed"));
    const { baseUrl } = await start({ runCycleFn });

    const response = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify({
        incidentId: "oracle-stale",
        action: { functionName: "unpause" },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "proposed" });
    expect(runCycleFn).toHaveBeenCalledTimes(1);
    expect(runCycleFn).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: false,
        scenarioId: "oracle-stale",
        triggerType: "webhook",
      }),
    );
    expect(runCycleFn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        forceAction: expect.any(Object),
      }),
    );
    const firstCall = (runCycleFn as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(firstCall).toMatchObject({
      execute: false,
      scenarioId: "oracle-stale",
      triggerType: "webhook",
    });
    expect(firstCall).not.toHaveProperty("forceAction");
  });

  it("returns 400 for unknown incidentId", async () => {
    const runCycleFn = vi.fn(async () => cycleResult("proposed"));
    const { baseUrl } = await start({ runCycleFn });

    const response = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify({ incidentId: "does-not-exist" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: "unknown_incident" });
    expect(runCycleFn).not.toHaveBeenCalled();
  });

  it("requires an incidentId", async () => {
    const runCycleFn = vi.fn(async () => cycleResult("proposed"));
    const { baseUrl } = await start({ runCycleFn });

    const response = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: "{}",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: "invalid_incident_request" });
    expect(runCycleFn).not.toHaveBeenCalled();
  });

  it("executes only through a token-protected, bound approval route", async () => {
    const runCycleFn = vi.fn(async () => cycleResult("failed"));
    const { baseUrl, approvalQueue } = await start({
      runCycleFn,
    });
    const evidence = createEmptyEvidence({
      runId: "run-approval",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    const pending = approvalQueue.enqueue({
      id: "approval-1",
      runId: evidence.runId,
      action: {
        contract: CONTRACT,
        functionName: "pause",
        valueWei: "0",
        severity: "high",
      },
      rationale: "health factor breach",
      evidenceSnapshot: evidence,
    });

    const response = await fetch(
      `${baseUrl}/api/approvals/${pending.id}/apply`,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: "{}",
      },
    );

    expect(response.status).toBe(200);
    expect(runCycleFn).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: true,
        approvalId: pending.id,
        forceAction: pending.action,
      }),
    );
  });

  it("rejects untrusted origins, wrong media types, malformed JSON, and oversized bodies", async () => {
    const { baseUrl } = await start({ maxBodyBytes: 32 });

    const badOrigin = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders({ Origin: "https://attacker.example" }),
      body: "{}",
    });
    expect(badOrigin.status).toBe(403);

    const wrongType = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "https://proofops.test",
        "Content-Type": "text/plain",
      },
      body: "{}",
    });
    expect(wrongType.status).toBe(415);

    const malformed = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: "{bad",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify({ padding: "x".repeat(100) }),
    });
    expect(oversized.status).toBe(413);
  });

  it("redacts secrets from errors and returns recovery guidance", async () => {
    const runCycleFn = vi.fn(async () => {
      throw new Error("Authorization: Bearer kh_do_not_leak");
    });
    const { baseUrl } = await start({
      runCycleFn,
    });

    const response = await fetch(`${baseUrl}/api/cycle`, {
      method: "POST",
      headers: operatorHeaders(),
      body: JSON.stringify({ incidentId: "health-factor-breach" }),
    });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("kh_do_not_leak");
    expect(JSON.parse(text)).toMatchObject({
      error: "internal_error",
      hint: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("fixture reset preserves live evidence", async () => {
    const { baseUrl, evidenceStore } = await start();
    const fixture = createEmptyEvidence({
      runId: "fixture",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "scenario",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    const live = createEmptyEvidence({
      runId: "live",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "manual",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    live.evidenceMode = "live";
    evidenceStore.append(fixture);
    evidenceStore.append(live);

    const response = await fetch(`${baseUrl}/api/demo/reset`, {
      method: "POST",
      headers: operatorHeaders(),
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(evidenceStore.readAll().records.map((record) => record.runId)).toEqual(
      ["live"],
    );
  });
});
