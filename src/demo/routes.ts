import type { RunbookId } from "../agent/IncidentRunbooks.js";

export interface IncidentFixture {
  id: string;
  title: string;
  severity: "none" | "low" | "medium" | "high" | "critical";
  signal: string;
  runbook: RunbookId | null;
}

export const INCIDENT_FIXTURES: readonly IncidentFixture[] = [
  {
    id: "oracle-stale",
    title: "Oracle silence",
    severity: "medium",
    signal: "lastUpdated exceeds heartbeat",
    runbook: "incident.repair_heartbeat",
  },
  {
    id: "health-factor-breach",
    title: "Health factor breach",
    severity: "high",
    signal: "healthFactorBps < 11000",
    runbook: "incident.pause",
  },
  {
    id: "parameter-drift",
    title: "Deviation limit drift",
    severity: "medium",
    signal: "maxDeviationBps differs from policy baseline",
    runbook: "incident.reset_deviation",
  },
  {
    id: "recovered",
    title: "Recovered protocol",
    severity: "none",
    signal: "all monitored invariants healthy",
    runbook: null,
  },
] as const;

export function resolveIncidentById(incidentId: string): IncidentFixture | undefined {
  return INCIDENT_FIXTURES.find((fixture) => fixture.id === incidentId);
}

export function publicCycleResult(result: {
  evidence: {
    runId: string;
    status: string;
    evidenceMode: string;
    selectedAction: unknown;
    txHash: string | null;
    explorerUrl: string | null;
    keeperhubAuditReference: string | null;
  };
  state: { mockLabeled: boolean };
  drift: { severity: string };
  policy: unknown;
}) {
  return {
    status: result.evidence.status,
    runId: result.evidence.runId,
    evidenceMode: result.evidence.evidenceMode,
    policy: result.policy,
    severity: result.drift.severity,
    action: result.evidence.selectedAction,
    txHash: result.evidence.txHash,
    explorerUrl: result.evidence.explorerUrl,
    keeperhubAuditReference: result.evidence.keeperhubAuditReference,
    mockLabeled: result.state.mockLabeled,
  };
}
