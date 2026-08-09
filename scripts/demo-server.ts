#!/usr/bin/env tsx
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ApprovalQueue } from "../src/agent/ApprovalQueue.js";
import { env } from "../src/config/env.js";
import { createProofOpsServer } from "../src/demo/server.js";
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import { createCachedKeeperHubStatus } from "../src/keeperhub/status.js";

const tokenPath =
  process.env.PROOFOPS_OPERATOR_TOKEN_FILE ??
  join(process.cwd(), ".proofops-operator-token");
let operatorToken = env.PROOFOPS_OPERATOR_TOKEN;
if (!operatorToken && existsSync(tokenPath)) {
  operatorToken = readFileSync(tokenPath, "utf8").trim();
}
if (!operatorToken) {
  operatorToken = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, `${operatorToken}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const port = env.PORT;
const configuredOrigins = env.PROOFOPS_ALLOWED_ORIGIN
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins =
  configuredOrigins.length > 0
    ? configuredOrigins
    : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

const server = createProofOpsServer({
  operatorToken,
  allowedOrigins,
  evidenceStore: new EvidenceStore(env.EVIDENCE_STORE_PATH),
  approvalQueue: new ApprovalQueue(env.APPROVAL_QUEUE_PATH),
  staticDir: join(process.cwd(), "app/dashboard"),
  proofDir: join(process.cwd(), "data/proof-bundle"),
  publicEvidenceDir: join(process.cwd(), "docs/evidence"),
  keeperHubStatusFn: createCachedKeeperHubStatus({
    url: env.KEEPERHUB_MCP_URL,
    apiKey: env.KEEPERHUB_API_KEY,
  }),
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ProofOps server listening on http://0.0.0.0:${port}`);
  console.log(`Dashboard: http://127.0.0.1:${port}/`);
  console.log(`Operator token stored with mode 0600 at ${tokenPath}`);
  console.log(
    "POST /api/cycle is proposal-only; approved execution uses POST /api/approvals/:id/apply.",
  );
});
