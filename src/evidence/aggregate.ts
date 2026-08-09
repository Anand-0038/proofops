import {
  isVerifiedLiveExecution,
  type EvidenceRecord,
} from "./EvidenceRecord.js";

export interface ReliabilityMetrics {
  denominatorRuns: number;
  confirmed: number;
  liveConfirmed: number;
  fixtureRecovered: number;
  failed: number;
  policyBlocked: number;
  simulationBlocked: number;
  approvalRequired: number;
  firstAttemptSuccess: number;
  recoveredAfterRetry: number;
  successRate: number | null;
  firstAttemptSuccessRate: number | null;
  recoveryRate: number | null;
  simulationCatchRate: number | null;
  medianConfirmationLatencyMs: number | null;
  p95ConfirmationLatencyMs: number | null;
  averageGasUsed: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  evidenceModes: {
    fixture: number;
    live: number;
    mixed: number;
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/**
 * Aggregate evidence into judge-facing reliability metrics.
 * Every rate includes an explicit denominator.
 */
export function aggregateEvidence(records: EvidenceRecord[]): ReliabilityMetrics {
  const denominatorRuns = records.length;
  const confirmed = records.filter((r) => r.status === "confirmed").length;
  const liveConfirmed = records.filter(isVerifiedLiveExecution).length;
  const fixtureRecovered = records.filter(
    (r) => r.status === "fixture_recovered",
  ).length;
  const failed = records.filter((r) => r.status === "failed").length;
  const policyBlocked = records.filter((r) => r.status === "policy_blocked").length;
  const simulationBlocked = records.filter(
    (r) => r.status === "simulation_blocked",
  ).length;
  const approvalRequired = records.filter(
    (r) => r.status === "approval_required",
  ).length;

  const attempted = records.filter((r) => r.submissionAttempts > 0);
  const firstAttemptSuccess = attempted.filter(
    (r) => r.status === "confirmed" && r.submissionAttempts === 1,
  ).length;
  const recoveredAfterRetry = attempted.filter(
    (r) =>
      (r.status === "confirmed" || r.status === "fixture_recovered") &&
      r.submissionAttempts > 1,
  ).length;
  const multiAttempt = attempted.filter((r) => r.submissionAttempts > 1);

  const latencies: number[] = [];
  for (const r of records) {
    if (r.submittedAt && r.confirmedAt) {
      const ms =
        new Date(r.confirmedAt).getTime() - new Date(r.submittedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) latencies.push(ms);
    }
  }
  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  const gasValues = records
    .map((r) => (r.gasUsed ? Number(r.gasUsed) : NaN))
    .filter((n) => Number.isFinite(n));

  const times = records.map((r) => r.createdAt).filter(Boolean).sort();

  const rate = (num: number, den: number): number | null =>
    den === 0 ? null : num / den;

  return {
    denominatorRuns,
    confirmed,
    liveConfirmed,
    fixtureRecovered,
    failed,
    policyBlocked,
    simulationBlocked,
    approvalRequired,
    firstAttemptSuccess,
    recoveredAfterRetry,
    successRate: rate(confirmed, denominatorRuns),
    firstAttemptSuccessRate: rate(firstAttemptSuccess, attempted.length),
    recoveryRate: rate(recoveredAfterRetry, multiAttempt.length),
    simulationCatchRate: rate(
      simulationBlocked,
      simulationBlocked + confirmed + failed,
    ),
    medianConfirmationLatencyMs: median(latencies),
    p95ConfirmationLatencyMs: percentile(sortedLatencies, 95),
    averageGasUsed: gasValues.length
      ? gasValues.reduce((a, b) => a + b, 0) / gasValues.length
      : null,
    windowStart: times[0] ?? null,
    windowEnd: times[times.length - 1] ?? null,
    evidenceModes: {
      fixture: records.filter((record) => record.evidenceMode === "fixture")
        .length,
      live: records.filter((record) => record.evidenceMode === "live").length,
      mixed: records.filter((record) => record.evidenceMode === "mixed").length,
    },
  };
}

export function formatMetricsMarkdown(m: ReliabilityMetrics): string {
  const pct = (r: number | null, den: number, label: string) =>
    r === null
      ? `${label}: n/a (denominator ${den})`
      : `${label}: ${(r * 100).toFixed(1)}% (${Math.round(r * den)}/${den})`;

  return [
    `# Reliability Report`,
    "",
    `Window: ${m.windowStart ?? "—"} → ${m.windowEnd ?? "—"}`,
    `Total runs (denominator): **${m.denominatorRuns}**`,
    "",
    "## Outcomes",
    "",
    `| Outcome | Count |`,
    `| --- | ---: |`,
    `| Confirmed | ${m.confirmed} |`,
    `| Verified live KeeperHub executions | ${m.liveConfirmed} |`,
    `| Fixture recovery demonstrations | ${m.fixtureRecovered} |`,
    `| Failed | ${m.failed} |`,
    `| Policy blocked | ${m.policyBlocked} |`,
    `| Simulation blocked | ${m.simulationBlocked} |`,
    `| Approval required | ${m.approvalRequired} |`,
    "",
    "## Rates (explicit denominators)",
    "",
    `- ${pct(m.successRate, m.denominatorRuns, "Success rate")} — confirmed / all runs`,
    `- ${pct(m.firstAttemptSuccessRate, m.firstAttemptSuccess + (m.confirmed - m.firstAttemptSuccess) + m.failed || m.denominatorRuns, "First-attempt success")} — confirmed-on-attempt-1 / attempted`,
    `- Recovery rate: ${
      m.recoveryRate === null
        ? `n/a (no multi-attempt runs)`
        : `${(m.recoveryRate * 100).toFixed(1)}% (${m.recoveredAfterRetry} recovered / multi-attempt runs)`
    }`,
    `- Simulation catch rate: ${
      m.simulationCatchRate === null
        ? "n/a"
        : `${(m.simulationCatchRate * 100).toFixed(1)}% (simulation_blocked / (sim_blocked+confirmed+failed))`
    }`,
    "",
    "## Latency & gas",
    "",
    `- Median confirmation latency: ${m.medianConfirmationLatencyMs ?? "n/a"} ms`,
    `- P95 confirmation latency: ${m.p95ConfirmationLatencyMs ?? "n/a"} ms`,
    `- Average gas used: ${m.averageGasUsed ?? "n/a"}`,
  ].join("\n");
}
