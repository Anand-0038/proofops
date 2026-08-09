#!/usr/bin/env tsx
/**
 * Create the incident pause workflow on KeeperHub (workflow builder surface).
 * Prints workflowId to set as WORKFLOW_ID in .env.
 */
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { createIncidentWorkflow } from "../src/keeperhub/workflows.js";
import { env, redactSecrets } from "../src/config/env.js";

async function main(): Promise<void> {
  if (!env.KEEPERHUB_API_KEY || env.KEEPERHUB_API_KEY.includes("YOUR")) {
    throw new Error("Set KEEPERHUB_API_KEY in .env first");
  }
  if (!env.TARGET_CONTRACT_ADDRESS) {
    throw new Error("Set TARGET_CONTRACT_ADDRESS first (deploy IncidentOracle)");
  }

  const client = new KeeperHubClient();
  const { workflowId, raw } = await createIncidentWorkflow(client, {
    name: "incident-keeper-pause",
    description:
      "Bounded incident pause runbook — KeeperHub Incident Keeper",
    network: env.NETWORK,
    contractAddress: env.TARGET_CONTRACT_ADDRESS,
  });

  console.log(`\nCreated workflowId: ${workflowId}`);
  console.log(`Add to .env: WORKFLOW_ID=${workflowId}`);
  console.log("Raw (truncated):", redactSecrets(JSON.stringify(raw).slice(0, 500)));
}

main().catch((e) => {
  console.error(redactSecrets(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
