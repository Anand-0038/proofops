#!/usr/bin/env tsx
/**
 * Run a defined scenario mix. Every run maps to a real scenario — no padding transfers.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCycle } from "../src/agent/runCycle.js";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { PolicyEngine } from "../src/agent/PolicyEngine.js";
import { defaultPolicyConfig } from "../src/agent/policy.config.js";
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import { aggregateEvidence, formatMetricsMarkdown } from "../src/evidence/aggregate.js";
import { env } from "../src/config/env.js";

type Scenario =
  | "happy_path"
  | "pre_simulation_rejection"
  | "transient_error"
  | "gas_adjustment_retry"
  | "policy_blocked_unsafe";

interface ScenarioPlan {
  id: Scenario;
  count: number;
}

const DEFAULT_PLAN: ScenarioPlan[] = [
  { id: "happy_path", count: 20 },
  { id: "pre_simulation_rejection", count: 10 },
  { id: "transient_error", count: 8 },
  { id: "gas_adjustment_retry", count: 7 },
  { id: "policy_blocked_unsafe", count: 5 },
];

const TARGET_CONFIRMED = Number(process.env.SCENARIO_TARGET_CONFIRMED ?? "50");
const LIVE = process.argv.includes("--live");
const DRY = !LIVE;
const SMALL = process.argv.includes("--small"); // local smoke: 5 total

function plan(): ScenarioPlan[] {
  if (SMALL) {
    return [
      { id: "happy_path", count: 1 },
      { id: "pre_simulation_rejection", count: 1 },
      { id: "transient_error", count: 1 },
      { id: "gas_adjustment_retry", count: 1 },
      { id: "policy_blocked_unsafe", count: 1 },
    ];
  }
  return DEFAULT_PLAN;
}

async function runOne(scenario: Scenario, index: number): Promise<string> {
  const policyEngine = new PolicyEngine({
    config: {
      ...defaultPolicyConfig,
      humanApprovalSeverityThreshold:
        scenario === "policy_blocked_unsafe" ? "high" : "critical",
      cooldownSeconds: 0,
    },
  });

  if (scenario === "policy_blocked_unsafe") {
    const r = await runCycle({
      execute: false,
      triggerType: "scenario",
      scenarioId: `${scenario}-${index}`,
      policyEngine,
      forceAction: {
        contract: "0xdead000000000000000000000000000000000000",
        functionName: "selfdestruct",
        valueWei: "0",
        severity: "low",
        rationale: "malicious recommendation",
      },
    });
    return r.evidence.status;
  }

  if (scenario === "pre_simulation_rejection") {
    const client = new KeeperHubClient();
    if (DRY) {
      // Local dry: mock gate via force + skip live if no key
      const r = await runCycle({
        execute: true,
        triggerType: "scenario",
        scenarioId: `${scenario}-${index}`,
        policyEngine,
        keeperhub: {
          ...client,
          simulate: async () => ({
            status: "would_revert" as const,
            wouldRevert: true,
            revertReason: "DRY Error(NotOwner())",
          }),
          execute: async () => {
            throw new Error("should not execute");
          },
        } as unknown as KeeperHubClient,
        forceAction: {
          contract:
            env.TARGET_CONTRACT_ADDRESS ||
            "0x0000000000000000000000000000000000000001",
          functionName: "pause",
          valueWei: "0",
          severity: "medium",
        },
      });
      return r.evidence.status;
    }
    const r = await runCycle({
      execute: true,
      triggerType: "scenario",
      scenarioId: `${scenario}-${index}`,
      policyEngine,
      keeperhub: client,
      forceAction: {
        contract: "0x000000000000000000000000000000000000dead",
        functionName: "pause",
        valueWei: "0",
        severity: "medium",
      },
    });
    return r.evidence.status;
  }

  const failureMode =
    scenario === "transient_error"
      ? "transient_rpc"
      : scenario === "gas_adjustment_retry"
        ? "gas_spike"
        : "";

  const client = new KeeperHubClient({ failureMode });

  if (DRY && scenario !== "happy_path") {
    // Fixture-only recovery demonstration. It intentionally carries no
    // transaction, explorer, KeeperHub execution, or audit reference.
    const store = new EvidenceStore(env.EVIDENCE_STORE_PATH);
    const { createEmptyEvidence } = await import("../src/evidence/EvidenceRecord.js");
    const ev = createEmptyEvidence({
      runId: randomUUID(),
      workflowId: "incident-keeper-direct",
      workflowVersion: "1",
      triggerType: "scenario",
      agentVersion: env.AGENT_VERSION,
      policyVersion: env.POLICY_VERSION,
      chainId: env.CHAIN_ID,
      network: env.NETWORK,
      scenarioId: `${scenario}-${index}`,
    });
    ev.status = "fixture_recovered";
    ev.policyDecision = "allowed";
    ev.submissionAttempts = 2;
    ev.retryReasons = [
      scenario === "transient_error"
        ? "fixture_transport_interruption"
        : "fixture_changed_body_new_key",
    ];
    ev.gasEstimateChanges = [
      { attempt: 1, gasLimitMultiplier: "0.5" },
      { attempt: 2, gasLimitMultiplier: "1.25" },
    ];
    ev.observedInputs = {
      fixtureScenario: scenario,
      fixtureRun: index,
      liveTransactionClaimed: false,
    };
    store.append(ev);
    return ev.status;
  }

  const r = await runCycle({
    execute: !DRY,
    triggerType: "scenario",
    scenarioId: `${scenario}-${index}`,
    policyEngine,
    keeperhub: client,
  });
  return r.evidence.status;
}

async function main(): Promise<void> {
  console.log(
    "Fixture mode is the default; --live is required for KeeperHub execution.",
  );
  const scenarios = plan();
  const total = scenarios.reduce((a, s) => a + s.count, 0);
  console.log(`Running ${total} scenario runs (dry=${DRY}, small=${SMALL})`);
  console.log("Distribution:", scenarios);

  const outcomes: Record<string, number> = {};
  for (const s of scenarios) {
    for (let i = 0; i < s.count; i++) {
      const status = await runOne(s.id, i);
      outcomes[`${s.id}:${status}`] = (outcomes[`${s.id}:${status}`] ?? 0) + 1;
      console.log(`[${s.id} #${i}] → ${status}`);
    }
  }

  const store = new EvidenceStore(env.EVIDENCE_STORE_PATH);
  const { records: all, issues } = store.readAll();
  const metrics = aggregateEvidence(all);
  const report = [
    formatMetricsMarkdown(metrics),
    "",
    "## Scenario distribution (this invocation)",
    "",
    "| Scenario | Planned |",
    "| --- | ---: |",
    ...scenarios.map((s) => `| ${s.id} | ${s.count} |`),
    "",
    "## Outcomes by scenario:status",
    "",
    ...Object.entries(outcomes).map(([k, v]) => `- ${k}: ${v}`),
    "",
    `Target confirmed executions: ${TARGET_CONFIRMED}`,
    `Actual confirmed in store: ${metrics.confirmed}`,
    `Fixture recovery demonstrations: ${metrics.fixtureRecovered}`,
    `Quarantined evidence rows: ${issues.length}`,
    DRY
      ? "NOTE: fixture mode used synthetic recovery rows for non-live modes. Replace with explicit --live KeeperHub runs before submission."
      : "Live / mixed mode.",
  ].join("\n");

  if (!existsSync("docs")) mkdirSync("docs", { recursive: true });
  writeFileSync("docs/reliability-report.md", report, "utf8");
  console.log("\nWrote docs/reliability-report.md");
  console.log(report);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
