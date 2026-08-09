#!/usr/bin/env tsx
/**
 * Deliberately induce a failure mode from the matrix and prove recovery in evidence.
 * Modes: transient_rpc | gas_spike | unsafe_call
 */
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { runCycle } from "../src/agent/runCycle.js";
import { EvidenceStore, formatEvidenceMarkdown } from "../src/evidence/EvidenceRecord.js";
import { env } from "../src/config/env.js";
import { PolicyEngine } from "../src/agent/PolicyEngine.js";
import { defaultPolicyConfig } from "../src/agent/policy.config.js";

const mode = (process.argv[2] || env.INJECT_FAILURE_MODE || "transient_rpc").trim();

async function main(): Promise<void> {
  console.log(`=== Failure injection: ${mode} ===\n`);

  if (mode === "unsafe_call") {
    const client = new KeeperHubClient();
    // ActionLog is a real deployed contract, but it intentionally does not
    // implement pause(). Allowing this exact call makes KeeperHub simulation
    // reject before any transaction can be submitted.
    const unsafeTarget =
      env.ACTION_LOG_ADDRESS || "0x0000000000000000000000000000000000000001";
    if (
      env.TARGET_CONTRACT_ADDRESS &&
      unsafeTarget.toLowerCase() === env.TARGET_CONTRACT_ADDRESS.toLowerCase()
    ) {
      throw new Error(
        "unsafe_call requires ACTION_LOG_ADDRESS to differ from TARGET_CONTRACT_ADDRESS",
      );
    }

    const result = await runCycle({
      execute: true,
      triggerType: "failure_injection",
      scenarioId: "unsafe_call",
      keeperhub: client,
      policyEngine: new PolicyEngine({
        config: {
          ...defaultPolicyConfig,
          humanApprovalSeverityThreshold: "critical",
          allowlist: [
            {
              contract: unsafeTarget,
              functionName: "pause",
              maxValueWei: "0",
              label: "pause",
            },
          ],
        },
      }),
      forceAction: {
        contract: unsafeTarget,
        functionName: "pause",
        valueWei: "0",
        severity: "medium",
        rationale: "Injected pause() against a contract without that function",
      },
    });

    console.log(formatEvidenceMarkdown(result.evidence));
    if (result.evidence.status !== "simulation_blocked" && result.evidence.status !== "policy_blocked") {
      console.warn(
        "NOTE: Expected simulation_blocked or policy_blocked. If status differs, document as unverified.",
      );
    }
    return;
  }

  const client = new KeeperHubClient({ failureMode: mode });
  const result = await runCycle({
    execute: true,
    triggerType: "failure_injection",
    scenarioId: mode,
    keeperhub: client,
    policyEngine: new PolicyEngine({
      config: {
        ...defaultPolicyConfig,
        humanApprovalSeverityThreshold: "critical",
      },
    }),
  });

  console.log(formatEvidenceMarkdown(result.evidence));
  console.log("\nAttempts:", JSON.stringify(result.evidence.gasEstimateChanges, null, 2));
  console.log("Retry reasons:", result.evidence.retryReasons);

  if (
    (mode === "transient_rpc" || mode === "gas_spike") &&
    result.evidence.status === "confirmed" &&
    result.evidence.submissionAttempts > 1
  ) {
    console.log("\n✓ Recovery proven: attempt 1 failed path → later attempt confirmed");
  } else if (!env.KEEPERHUB_API_KEY || env.KEEPERHUB_API_KEY.includes("YOUR")) {
    console.warn(
      "\n⚠ No real API key — live recovery not proven. Unit tests cover retry logic; re-run after onboarding.",
    );
  } else {
    console.warn(
      "\n⚠ Recovery not fully proven in this run. See docs/reliability.md — mark unverified if unreproducible.",
    );
  }

  const store = new EvidenceStore(env.EVIDENCE_STORE_PATH);
  const evidenceRead = store.readAll();
  console.log(`Evidence store entries: ${evidenceRead.records.length}`);
  if (evidenceRead.issues.length) {
    console.warn(`Quarantined evidence rows: ${evidenceRead.issues.length}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
