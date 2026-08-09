#!/usr/bin/env tsx
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import { writeProofBundle } from "../src/evidence/integrity.js";
import { env } from "../src/config/env.js";

const outDir = process.argv[2] ?? "./data/proof-bundle";
const store = new EvidenceStore(env.EVIDENCE_STORE_PATH);
const { records, issues } = store.readAll();
const { manifest } = writeProofBundle({
  outDir,
  records,
  evidenceIssues: issues,
  agentVersion: env.AGENT_VERSION,
  policyVersion: env.POLICY_VERSION,
  network: env.NETWORK,
  chainId: env.CHAIN_ID,
});

console.log(
  `Wrote ${outDir} (${manifest.recordCount} valid records, ${issues.length} quarantined rows, ${manifest.verifiedLiveExecutions} verified live executions)`,
);
