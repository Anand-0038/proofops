#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { verifyPublicReceiptLedger } from "../src/evidence/publicReceipts.js";

const path = process.argv[2] ?? "docs/evidence/verified-live-receipts.json";
let value: unknown;
try {
  value = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(
    `Public evidence unreadable: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
const result = verifyPublicReceiptLedger(value);
if (!result.ok) {
  console.error(`Public evidence failed: ${result.issues.join("; ")}`);
  process.exit(1);
}
console.log(
  `Public evidence verified: ${result.receiptCount} unique KeeperHub receipt(s) with bound digests and URLs`,
);
