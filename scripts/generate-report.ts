#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EvidenceStore,
  formatEvidenceMarkdown,
  isVerifiedLiveExecution,
  type EvidenceRecord,
} from "../src/evidence/EvidenceRecord.js";
import {
  aggregateEvidence,
  formatMetricsMarkdown,
} from "../src/evidence/aggregate.js";
import { env } from "../src/config/env.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function percent(value: number | null, digits = 1): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

function statusTone(record: EvidenceRecord): string {
  if (record.status === "confirmed" || record.status === "fixture_recovered") {
    return "good";
  }
  if (record.status === "failed") return "bad";
  return "warn";
}

function verifiedLinks(record: EvidenceRecord): string {
  if (!isVerifiedLiveExecution(record)) return "No verified live links";
  return [
    `<a href="${escapeHtml(record.explorerUrl)}" rel="noreferrer noopener">transaction</a>`,
    `<a href="${escapeHtml(record.keeperhubAuditReference)}" rel="noreferrer noopener">KeeperHub audit</a>`,
  ].join(" · ");
}

const store = new EvidenceStore(env.EVIDENCE_STORE_PATH);
const { records, issues } = store.readAll();
const metrics = aggregateEvidence(records);

const byScenario = new Map<string, number>();
const byStatus = new Map<string, number>();
for (const record of records) {
  const scenario =
    record.scenarioId?.split("-").slice(0, -1).join("-") ||
    record.triggerType;
  byScenario.set(scenario, (byScenario.get(scenario) ?? 0) + 1);
  byStatus.set(record.status, (byStatus.get(record.status) ?? 0) + 1);
}

const markdown = [
  formatMetricsMarkdown(metrics),
  "",
  "## Evidence trust modes",
  "",
  "| Mode | Count |",
  "| --- | ---: |",
  `| Fixture rehearsal | ${metrics.evidenceModes.fixture} |`,
  `| Mixed observation/execution | ${metrics.evidenceModes.mixed} |`,
  `| Live | ${metrics.evidenceModes.live} |`,
  "",
  "## By status",
  "",
  "| Status | Count |",
  "| --- | ---: |",
  ...[...byStatus.entries()].map(
    ([key, value]) => `| ${escapeMarkdown(key)} | ${value} |`,
  ),
  "",
  "## By scenario / trigger",
  "",
  "| Scenario | Count |",
  "| --- | ---: |",
  ...[...byScenario.entries()].map(
    ([key, value]) => `| ${escapeMarkdown(key)} | ${value} |`,
  ),
  "",
  "## Quarantined evidence rows",
  "",
  `${issues.length} malformed or schema-invalid row(s) excluded from metrics.`,
  "",
  "## Latest runs",
  "",
  ...records
    .slice(-5)
    .flatMap((record, index) => [
      ...(index === 0 ? [] : ["", "---", ""]),
      formatEvidenceMarkdown(record),
    ]),
];

mkdirSync("docs", { recursive: true });
writeFileSync(
  "docs/reliability-report.md",
  markdown.join("\n"),
  "utf8",
);

const reportDir = join("data", "proof-bundle");
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
const reportPath = join("data", "proof-bundle", "report.html");
const generatedAt = new Date().toISOString();
const evidenceRows = records
  .slice()
  .reverse()
  .map(
    (record) => `<tr>
      <td><code>${escapeHtml(record.runId)}</code></td>
      <td><span class="mode ${escapeHtml(record.evidenceMode)}">${escapeHtml(record.evidenceMode)}</span></td>
      <td class="${statusTone(record)}">${escapeHtml(record.status)}</td>
      <td>${escapeHtml(record.scenarioId ?? record.triggerType)}</td>
      <td>${record.submissionAttempts}</td>
      <td>${verifiedLinks(record)}</td>
    </tr>`,
  )
  .join("\n");

const report = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>ProofOps archival reliability report</title>
  <style>
    :root { color-scheme: dark; --bg:#07131c; --panel:#0b2b3a; --fg:#e7e2d6; --muted:#82949c; --copper:#ee9360; --cyan:#78dce8; --line:#274552; }
    * { box-sizing: border-box; }
    body { max-width: 1120px; margin: 0 auto; padding: 3rem 1.25rem; color: var(--fg); background: var(--bg); font: 16px/1.55 system-ui,sans-serif; }
    h1,h2 { letter-spacing: -.03em; } h1 { font-size: clamp(2.4rem,7vw,5rem); line-height:.9; text-transform: uppercase; }
    .kicker,code,.mode { font-family: ui-monospace,monospace; } .kicker { color:var(--copper); letter-spacing:.12em; font-size:.75rem; }
    .truth { padding:1rem; border-left:3px solid var(--copper); background:rgba(200,111,61,.08); }
    .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px; margin:2rem 0; background:var(--line); border:1px solid var(--line); }
    .metric { padding:1.2rem; background:var(--panel); } .metric strong,.metric span { display:block; } .metric strong { color:var(--cyan); font-size:2rem; } .metric span { color:var(--muted); font-size:.75rem; }
    .table { overflow:auto; border:1px solid var(--line); } table { width:100%; min-width:780px; border-collapse:collapse; }
    th,td { padding:.8rem; border-bottom:1px solid var(--line); text-align:left; } th { color:var(--muted); font-size:.72rem; }
    a,.good { color:var(--cyan); } .warn { color:#e7bb68; } .bad { color:#ff7b6f; }
    .mode { padding:.2rem .45rem; border:1px solid currentColor; border-radius:999px; font-size:.68rem; }
    .fixture { color:#e7bb68; } .mixed { color:var(--copper); } .live { color:var(--cyan); }
    footer { margin-top:2rem; color:var(--muted); font-size:.78rem; }
  </style>
</head>
<body>
  <p class="kicker">PROOFOPS / ARCHIVAL OUTPUT</p>
  <h1>Incident reliability report</h1>
  <p class="truth"><strong>Truth boundary:</strong> fixture recovery is a rehearsal and never counts as a live transaction. External links appear only for schema-verified live KeeperHub receipts.</p>
  <div class="metrics">
    <div class="metric"><strong>${metrics.denominatorRuns}</strong><span>all valid runs / denominator</span></div>
    <div class="metric"><strong>${metrics.liveConfirmed}</strong><span>verified live KeeperHub executions</span></div>
    <div class="metric"><strong>${metrics.fixtureRecovered}</strong><span>fixture recovery demonstrations</span></div>
    <div class="metric"><strong>${metrics.simulationBlocked}</strong><span>broadcasts prevented by simulation</span></div>
    <div class="metric"><strong>${metrics.recoveredAfterRetry}</strong><span>recoveries after multiple attempts</span></div>
    <div class="metric"><strong>${percent(metrics.successRate)}</strong><span>confirmed / ${metrics.denominatorRuns} total runs</span></div>
  </div>
  <h2>Evidence index</h2>
  <div class="table">
    <table>
      <thead><tr><th>Run ID</th><th>Trust</th><th>Outcome</th><th>Scenario</th><th>Attempts</th><th>Authoritative links</th></tr></thead>
      <tbody>${evidenceRows || '<tr><td colspan="6">No valid evidence records.</td></tr>'}</tbody>
    </table>
  </div>
  <footer>
    Generated ${escapeHtml(generatedAt)} · ${issues.length} malformed row(s) quarantined · interactive console remains at app/dashboard/index.html
  </footer>
</body>
</html>`;

writeFileSync(reportPath, report, "utf8");
console.log(
  `Wrote docs/reliability-report.md and ${reportPath} (${records.length} valid runs, ${issues.length} quarantined rows)`,
);
