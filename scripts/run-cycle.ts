#!/usr/bin/env tsx
import { runCycle } from "../src/agent/runCycle.js";
import { formatEvidenceMarkdown } from "../src/evidence/EvidenceRecord.js";

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const approvalArg = process.argv.find((arg) =>
    arg.startsWith("--approval-id="),
  );
  const approvalId = approvalArg?.slice("--approval-id=".length);

  console.log(`runCycle execute=${execute} approvalId=${approvalId ?? "none"}`);
  const result = await runCycle({ execute, approvalId });

  console.log("\n--- Drift ---");
  console.log(`severity=${result.drift.severity} findings=${result.drift.findings.length}`);
  for (const f of result.drift.findings) {
    console.log(`  [${f.severity}] ${f.code}: ${f.message}`);
  }

  console.log("\n--- Policy ---");
  console.log(result.policy);

  console.log("\n--- Evidence ---");
  console.log(formatEvidenceMarkdown(result.evidence));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
