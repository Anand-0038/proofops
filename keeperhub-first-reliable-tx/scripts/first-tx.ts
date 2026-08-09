#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, redactSecrets } from "../../src/config/env.js";
import {
  KeeperHubStarterClient,
  StarterApiError,
  type FirstTransferReceipt,
} from "../src/keeperhub.js";

interface TimeToFirstTxReport {
  title: "time-to-first-confirmed-transaction";
  evidenceMode: "fixture" | "live";
  confirmed: boolean;
  elapsedMs: number;
  manualStepCount: number;
  status: string;
  executionId: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  requestId: string | null;
  error: string | null;
  nextAction: string | null;
  measuredAt: string;
}

const startedAt = Date.now();
const fixtureMode = process.argv.includes("--fixture");

function mark(label: string): void {
  console.log(`[+${Date.now() - startedAt}ms] ${label}`);
}

function fixtureReport(): TimeToFirstTxReport {
  console.log("FIXTURE — NO TRANSACTION BROADCAST");
  console.log(
    "Walkthrough: enabled testnet → simulate same intent → idempotent broadcast → hint-aware status polling.",
  );
  console.log(
    "This mode proves the local flow only. It cannot satisfy a live transaction or submission gate.",
  );
  return {
    title: "time-to-first-confirmed-transaction",
    evidenceMode: "fixture",
    confirmed: false,
    elapsedMs: Date.now() - startedAt,
    manualStepCount: 0,
    status: "fixture_only",
    executionId: null,
    txHash: null,
    explorerUrl: null,
    requestId: null,
    error: null,
    nextAction: "Run corepack pnpm run preflight with a real kh_ organization key.",
    measuredAt: new Date().toISOString(),
  };
}

function liveReport(
  receipt: FirstTransferReceipt,
): TimeToFirstTxReport {
  return {
    title: "time-to-first-confirmed-transaction",
    evidenceMode: "live",
    confirmed: receipt.confirmed,
    elapsedMs: Date.now() - startedAt,
    manualStepCount: 3,
    status: receipt.status,
    executionId: receipt.executionId,
    txHash: receipt.transactionHash,
    explorerUrl: receipt.transactionLink,
    requestId: receipt.requestId,
    error: null,
    nextAction: null,
    measuredAt: new Date().toISOString(),
  };
}

function errorReport(error: unknown): TimeToFirstTxReport {
  const typed = error instanceof StarterApiError ? error : null;
  return {
    title: "time-to-first-confirmed-transaction",
    evidenceMode: "live",
    confirmed: false,
    elapsedMs: Date.now() - startedAt,
    manualStepCount: 3,
    status: "failed",
    executionId: null,
    txHash: null,
    explorerUrl: null,
    requestId: typed?.requestId ?? null,
    error: redactSecrets(
      error instanceof Error ? error.message : String(error),
    ),
    nextAction:
      typed?.nextAction ??
      "Run corepack pnpm run preflight, fix its first failed check, then retry.",
    measuredAt: new Date().toISOString(),
  };
}

function writeReport(report: TimeToFirstTxReport): void {
  const outputDir = join("keeperhub-first-reliable-tx", "docs");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, "time-to-first-tx.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(outputDir, "time-to-first-tx.md"),
    [
      "# Time to first confirmed KeeperHub transaction",
      "",
      report.evidenceMode === "fixture"
        ? "> FIXTURE — NO TRANSACTION BROADCAST. This report is not live proof."
        : report.confirmed
          ? "> LIVE — confirmed receipt validated."
          : "> LIVE ATTEMPT — not confirmed; no success claim.",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| Evidence mode | ${report.evidenceMode} |`,
      `| Confirmed | ${report.confirmed} |`,
      `| Automated elapsed | ${report.elapsedMs} ms |`,
      `| Manual steps | ${report.manualStepCount} |`,
      `| Status | ${report.status} |`,
      `| Execution ID | ${report.executionId ?? "—"} |`,
      `| Transaction | ${report.txHash ?? "—"} |`,
      `| Explorer | ${report.explorerUrl ?? "—"} |`,
      `| Request ID | ${report.requestId ?? "—"} |`,
      `| Error | ${report.error ?? "—"} |`,
      `| Next action | ${report.nextAction ?? "—"} |`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(
    "\nWrote keeperhub-first-reliable-tx/docs/time-to-first-tx.{json,md}",
  );
}

async function main(): Promise<void> {
  if (fixtureMode) {
    writeReport(fixtureReport());
    return;
  }
  if (
    !env.KEEPERHUB_API_KEY ||
    !env.KEEPERHUB_API_KEY.startsWith("kh_") ||
    env.KEEPERHUB_API_KEY.toUpperCase().includes("YOUR")
  ) {
    throw new StarterApiError(
      0,
      "api_key_missing",
      "KEEPERHUB_API_KEY must be a real kh_ organization key",
      "Create it in Settings → API Keys → Organisation, save it in .env, then run corepack pnpm run preflight.",
    );
  }

  const client = new KeeperHubStarterClient({
    apiKey: env.KEEPERHUB_API_KEY,
    baseUrl: env.KEEPERHUB_API_URL,
  });
  mark("reading active organization wallet");
  const wallet = await client.getWallet();
  if (
    !wallet.hasWallet ||
    !wallet.walletAddress ||
    !/^0x[a-fA-F0-9]{40}$/.test(wallet.walletAddress)
  ) {
    throw new StarterApiError(
      422,
      "wallet_not_configured",
      wallet.message ?? "Active organization has no usable wallet",
      "Open KeeperHub Settings → Wallet, provision it, then rerun preflight.",
    );
  }

  const intent = {
    chainId: env.CHAIN_ID,
    recipientAddress: wallet.walletAddress,
    amount: "0.000001",
  };
  mark(`simulating ${intent.amount} native-token self-transfer`);
  const idempotencyKey = randomUUID();
  const receipt = await client.safeFirstTransfer(intent, idempotencyKey);
  mark(`KeeperHub ${receipt.status}; authoritative receipt validated`);
  writeReport(liveReport(receipt));
}

main().catch((error) => {
  const report = errorReport(error);
  console.error(`\n${report.error}`);
  if (report.requestId) console.error(`Request ID: ${report.requestId}`);
  if (report.nextAction) console.error(`Next: ${report.nextAction}`);
  console.error("No confirmed transaction is claimed.");
  writeReport(report);
  process.exitCode = 1;
});
