#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { env, requireEnv } from "../src/config/env.js";
import { KeeperHubClient } from "../src/keeperhub/client.js";
import {
  attestProofThroughKeeperHub,
  prepareActionAttestation,
} from "../src/evidence/attestation.js";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1]!;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}`);
}

async function main(): Promise<void> {
  const incident = arg("incident", "demo-incident");
  const file = arg("file", "data/proof-bundle/manifest.json");
  const uri = arg("uri", `proofops://local/${file}`);
  const execute = process.argv.includes("--execute");
  const actionLogAddress =
    arg("action-log", env.ACTION_LOG_ADDRESS || "0x0000000000000000000000000000000000000002");
  const prepared = prepareActionAttestation({
    incident,
    manifestBytes: readFileSync(file),
    uri,
    actionLogAddress,
    chainId: env.CHAIN_ID,
  });

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          mode: "offline",
          incident: prepared.incident,
          incidentId: prepared.incidentId,
          manifestSha256: prepared.manifestSha256,
          uri: prepared.uri,
          calldata: prepared.calldata,
          keeperhubExecutionRequiredForLiveAttestation: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  requireEnv(["KEEPERHUB_API_KEY", "ACTION_LOG_ADDRESS"]);
  if (!/^(https:|ipfs:)/.test(uri)) {
    throw new Error(
      "Live attestation requires a durable https:// or ipfs:// proof URI",
    );
  }
  const result = await attestProofThroughKeeperHub(
    new KeeperHubClient(),
    prepared,
  );
  console.log(
    JSON.stringify(
      {
        mode: "keeperhub-live",
        incidentId: prepared.incidentId,
        manifestSha256: prepared.manifestSha256,
        simulation: result.simulation,
        execution: result.execution,
      },
      null,
      2,
    ),
  );
  if (!result.execution?.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
