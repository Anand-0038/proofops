#!/usr/bin/env tsx
/**
 * List / approve / reject pending high-severity actions.
 * Usage:
 *   corepack pnpm run approve -- list
 *   corepack pnpm run approve -- <id>
 *   corepack pnpm run approve -- reject <id>
 */
import { ApprovalQueue } from "../src/agent/ApprovalQueue.js";
import { runCycle } from "../src/agent/runCycle.js";

const queue = new ApprovalQueue(
  process.env.APPROVAL_QUEUE_PATH ?? "./data/approvals.jsonl",
);

async function main(): Promise<void> {
  const [cmd, maybeId] = process.argv.slice(2);
  if (!cmd || cmd === "list") {
    const pending = queue.listPending();
    console.log(`Pending approvals: ${pending.length}`);
    for (const p of pending) {
      console.log(
        `- ${p.id} run=${p.runId} action=${p.action.functionName} sev=${p.action.severity}`,
      );
      console.log(`  ${p.rationale.slice(0, 120)}`);
    }
    return;
  }

  if (cmd === "reject") {
    const id = maybeId;
    if (!id) throw new Error("Usage: corepack pnpm run approve -- reject <id>");
    const r = queue.resolve(id, "rejected");
    if (!r) throw new Error(`No pending approval ${id}`);
    console.log(`Rejected ${id}`);
    return;
  }

  const id = cmd;
  const pending = queue.listPending().find((p) => p.id === id);
  if (!pending) throw new Error(`No pending approval ${id}`);
  queue.resolve(id, "approved");
  console.log(`Approved ${id} — executing via KeeperHub…`);

  const result = await runCycle({
    execute: true,
    approvalId: id,
    forceAction: pending.action,
    triggerType: "manual",
    scenarioId: `approval-${id}`,
  });
  console.log(`Status: ${result.evidence.status}`);
  console.log(`Tx: ${result.evidence.txHash ?? "—"}`);
  console.log(`Explorer: ${result.evidence.explorerUrl ?? "—"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
