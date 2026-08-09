#!/usr/bin/env tsx
import { verifyProofBundle } from "../src/evidence/integrity.js";

const outDir = process.argv[2] ?? "./data/proof-bundle";
const result = verifyProofBundle(outDir);

if (!result.ok) {
  console.error(`Proof bundle verification failed: ${result.issues.join("; ")}`);
  process.exit(1);
}

console.log(
  `Proof bundle verified: ${result.checkedFiles} payload files, manifest sha256=${result.manifestSha256}`,
);
