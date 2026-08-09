#!/usr/bin/env tsx
import { env, redactSecrets } from "../../src/config/env.js";
import {
  KeeperHubStarterClient,
  runStarterPreflight,
} from "../src/keeperhub.js";

const start = Date.now();
const KEY_SAFE_LABEL = "set (value never printed)";

async function main(): Promise<void> {
  console.log("KeeperHub first-write doctor");
  console.log("============================");
  console.log(
    `Mode: LIVE PREFLIGHT — read-only checks plus one dry-run; no transaction broadcast`,
  );
  console.log(
    `Contract: GET /api/chains → organization wallet → balance → simulate`,
  );

  if (
    !env.KEEPERHUB_API_KEY ||
    !env.KEEPERHUB_API_KEY.startsWith("kh_") ||
    env.KEEPERHUB_API_KEY.toUpperCase().includes("YOUR")
  ) {
    console.error("\n✖ api_key — missing a usable organization key (kh_)");
    console.error(
      "  Next: KeeperHub Settings → API Keys → Organisation → Create New Key.",
    );
    console.error(
      "  Save it as KEEPERHUB_API_KEY in .env. The value is never printed.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ api_key — ${KEY_SAFE_LABEL}`);

  const client = new KeeperHubStarterClient({
    apiKey: env.KEEPERHUB_API_KEY,
    baseUrl: env.KEEPERHUB_API_URL,
  });
  const checks = await runStarterPreflight({
    client,
    apiKey: env.KEEPERHUB_API_KEY,
    chainId: env.CHAIN_ID,
  });

  for (const check of checks.filter((entry) => entry.id !== "api_key")) {
    console.log(
      `${check.ok ? "✓" : "✖"} ${check.id} — ${redactSecrets(check.detail)}`,
    );
    if (!check.ok && check.nextAction) {
      console.log(`  Next: ${redactSecrets(check.nextAction)}`);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed in ${
      Date.now() - start
    } ms.`,
  );
  if (failed.length > 0) {
    console.error(
      "No transaction was broadcast. Fix the failed check, then rerun corepack pnpm run preflight.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "Ready. Run corepack pnpm run first-tx for the live self-transfer, or corepack pnpm run first-tx -- --fixture for an offline walkthrough.",
  );
}

main().catch((error) => {
  console.error(
    redactSecrets(error instanceof Error ? error.message : String(error)),
  );
  console.error("No transaction was broadcast.");
  process.exitCode = 1;
});
