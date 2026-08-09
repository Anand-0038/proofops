#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../src/config/env.js";
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import { buildPublicReceiptLedger } from "../src/evidence/publicReceipts.js";

const outputPath = process.argv[2] ?? "docs/evidence/verified-live-receipts.json";
const { records } = new EvidenceStore(env.EVIDENCE_STORE_PATH).readAll();
const ledger = buildPublicReceiptLedger(records);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(
  `Published ${ledger.receipts.length} sanitized KeeperHub receipt(s) to ${outputPath}`,
);
