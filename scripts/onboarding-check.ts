#!/usr/bin/env tsx
/**
 * Onboarding preflight — Track B friction evidence.
 * Never prints secrets. Human-readable errors only.
 */
import { createPublicClient, formatEther, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { env, redactSecrets } from "../src/config/env.js";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import { initializeBlockscoutMcp } from "../src/observe/blockscoutMcp.js";

function fail(step: string, message: string): never {
  console.error(`\n✖ [${step}] ${redactSecrets(message)}`);
  console.error("   Fix the issue above, then re-run: corepack pnpm run onboarding:check\n");
  process.exit(1);
}

function ok(step: string, detail: string): void {
  console.log(`✓ [${step}] ${detail}`);
}

async function main(): Promise<void> {
  console.log("=== KeeperHub Incident Keeper — onboarding check ===\n");

  // 1) Env vars
  if (!env.KEEPERHUB_API_KEY || env.KEEPERHUB_API_KEY.includes("YOUR_API_KEY")) {
    fail(
      "env",
      "KEEPERHUB_API_KEY is missing or still a placeholder. Create an org API key at https://app.keeperhub.com (Settings → API Keys) and put it in .env",
    );
  }
  if (!env.RPC_URL) {
    fail("env", "RPC_URL is required (Sepolia RPC).");
  }
  ok("env", "Required variables present (values not printed)");

  const client = new KeeperHubClient();

  // 2) Official MCP initialize + tools/list discovery
  const mcp = await client.pingMcp();
  if (!mcp.ok) {
    fail("mcp", mcp.detail);
  }
  ok("mcp", mcp.detail);
  if (mcp.tools) {
    const expected = ["search_workflows", "call_workflow"];
    const present = expected.filter((tool) => mcp.tools?.includes(tool));
    ok(
      "mcp-tools",
      `${present.length}/${expected.length} marketplace meta-tools present; inventory=${mcp.tools.length}`,
    );
  }

  // 2b) Optional Blockscout MCP ping for read-layer integrity
  const blockscoutMcp = env.BLOCKSCOUT_MCP_URL;
  if (blockscoutMcp) {
    try {
      const serverInfo = await initializeBlockscoutMcp(blockscoutMcp);
      ok(
        "blockscout-mcp",
        `connected to ${serverInfo.name} (${serverInfo.version})`,
      );
    } catch (e) {
      console.warn(
        `⚠ [blockscout-mcp] Optional probe failed at ${blockscoutMcp}: ${redactSecrets(
          e instanceof Error ? e.message : String(e),
        )}. Continuing; direct read-layer checks remain authoritative.`,
      );
    }
  } else {
    console.warn(
      "⚠ [blockscout-mcp] BLOCKSCOUT_MCP_URL is not set — skipping MCP check.",
    );
  }

  // 3) REST auth
  const rest = await client.pingRest();
  if (!rest.ok) {
    fail("rest", rest.detail);
  }
  ok("rest", rest.detail);

  // 4) Wallet / balance
  if (!env.WALLET_ADDRESS || env.WALLET_ADDRESS.includes("YOUR_ORG")) {
    console.warn(
      "⚠ [wallet] WALLET_ADDRESS not set — skipping balance check. Set your KeeperHub org Turnkey address in .env",
    );
  } else {
    try {
      const pub = createPublicClient({
        chain: sepolia,
        transport: http(env.RPC_URL),
      });
      const bal = await pub.getBalance({
        address: env.WALLET_ADDRESS as Address,
      });
      const eth = formatEther(bal);
      if (bal === 0n) {
        console.warn(
          `⚠ [wallet] Balance is 0 ETH on Sepolia for ${env.WALLET_ADDRESS}. Fund via a faucet, then re-run.`,
        );
      } else {
        ok("wallet", `Sepolia balance ${eth} ETH`);
      }
    } catch (e) {
      fail(
        "wallet",
        `Could not read balance: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // 5) Read-only workflow / schemas call
  try {
    const workflows = await client.listWorkflows();
    const count = Array.isArray(workflows)
      ? workflows.length
      : typeof workflows === "object" && workflows && "workflows" in workflows
        ? (workflows as { workflows: unknown[] }).workflows?.length
        : "unknown";
    ok("readonly", `listWorkflows OK (count=${count})`);
    console.log("\nSample (redacted/truncated):");
    console.log(
      redactSecrets(JSON.stringify(workflows, null, 2).slice(0, 800)),
    );
  } catch (e) {
    // schemas already proved auth — workflows list may 404 on empty
    try {
      const schemas = await client.request("GET", "/api/mcp/schemas");
      ok(
        "readonly",
        `workflows list failed but schemas OK (${Object.keys(schemas.data as object).length} top-level keys)`,
      );
    } catch (e2) {
      fail(
        "readonly",
        e instanceof Error ? e.message : String(e2),
      );
    }
  }

  console.log("\n=== Onboarding check passed ===");
  console.log("Next: deploy IncidentOracle, set TARGET_CONTRACT_ADDRESS, run corepack pnpm run cycle");
}

main().catch((e) => {
  fail("fatal", e instanceof Error ? e.message : String(e));
});
