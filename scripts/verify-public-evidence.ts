#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import {
  verifyActionLogAnchor,
  verifyPublicReceiptLedger,
} from "../src/evidence/publicReceipts.js";

const path = process.argv[2] ?? "docs/evidence/verified-live-receipts.json";
const anchorPath = process.argv[3] ?? "docs/evidence/action-log-anchor.json";
let ledgerBytes: Buffer;
let value: unknown;
let anchor: unknown;
try {
  ledgerBytes = readFileSync(path);
  value = JSON.parse(ledgerBytes.toString("utf8"));
  anchor = JSON.parse(readFileSync(anchorPath, "utf8"));
} catch (error) {
  console.error(
    `Public evidence unreadable: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
const result = verifyPublicReceiptLedger(value);
const anchorResult = verifyActionLogAnchor({ ledgerBytes, anchor });
if (!result.ok || !anchorResult.ok) {
  console.error(
    `Public evidence failed: ${[...result.issues, ...anchorResult.issues].join("; ")}`,
  );
  process.exit(1);
}
console.log(
  `Public evidence verified: ${result.receiptCount} unique KeeperHub receipt(s), plus a digest-bound ActionLog anchor`,
);
