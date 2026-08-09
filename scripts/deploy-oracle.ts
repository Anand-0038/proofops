#!/usr/bin/env tsx
/**
 * Print instructions + optional Forge deploy command for IncidentOracle.
 * Does not broadcast unless --broadcast is passed and PRIVATE_KEY is set.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const broadcast = process.argv.includes("--broadcast");

console.log(`
=== Deploy IncidentOracle (Sepolia) ===

1. Fund a deployer EOA with Sepolia ETH
2. export RPC_URL=... PRIVATE_KEY=0x...
3. After deploy, transferOwnership to KeeperHub org wallet
4. Set TARGET_CONTRACT_ADDRESS in .env
`);

if (!broadcast) {
  console.log("Dry hint only. Re-run with --broadcast to forge script.\n");
  console.log(
    "cd contracts && forge script script/Deploy.s.sol:DeployIncidentOracle --rpc-url $RPC_URL --broadcast",
  );
  process.exit(0);
}

if (!process.env.PRIVATE_KEY || !process.env.RPC_URL) {
  console.error("Need PRIVATE_KEY and RPC_URL in env for --broadcast");
  process.exit(1);
}

if (!existsSync("contracts/foundry.toml")) {
  console.error("Run from repo root");
  process.exit(1);
}

const r = spawnSync(
  "forge",
  [
    "script",
    "script/Deploy.s.sol:DeployIncidentOracle",
    "--rpc-url",
    process.env.RPC_URL,
    "--broadcast",
  ],
  { cwd: "contracts", stdio: "inherit", env: process.env },
);
process.exit(r.status ?? 1);
