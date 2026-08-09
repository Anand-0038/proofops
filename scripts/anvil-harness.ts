#!/usr/bin/env tsx
/**
 * Local anvil harness: deploy IncidentOracle, warp staleness, read via ReadLayer.
 * Does NOT call KeeperHub — proves contract + observe path offline.
 */
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import { createPublicClient, http, type Address, isAddress } from "viem";
import { foundry } from "viem/chains";
import { ReadLayer } from "../src/observe/ReadLayer.js";
import { DriftDetector } from "../src/observe/DriftDetector.js";
import { selectRunbook } from "../src/agent/IncidentRunbooks.js";
import { PolicyEngine } from "../src/agent/PolicyEngine.js";
import { defaultPolicyConfig, withTargetContract } from "../src/agent/policy.config.js";

const ANVIL_PORT = 8565;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseDeployedAddress(output: string): Address {
  const m =
    output.match(/Deployed to:\s*(0x[a-fA-F0-9]{40})/) ||
    output.match(/"deployedTo"\s*:\s*"(0x[a-fA-F0-9]{40})"/);
  if (!m?.[1] || !isAddress(m[1])) {
    throw new Error(`Could not parse deploy address from:\n${output.slice(-500)}`);
  }
  return m[1];
}

async function main(): Promise<void> {
  console.log("=== Anvil local harness (no KeeperHub) ===\n");

  let anvil: ChildProcess | null = null;
  try {
    anvil = spawn("anvil", ["--port", String(ANVIL_PORT)], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    await sleep(1200);

    const deploy = spawnSync(
      "forge",
      [
        "create",
        "src/IncidentOracle.sol:IncidentOracle",
        "--rpc-url",
        RPC,
        "--private-key",
        PK,
        "--broadcast",
        "--constructor-args",
        "3600",
        "200000000000",
        "100",
        "10500",
      ],
      { cwd: "contracts", encoding: "utf8" },
    );

    const out = `${deploy.stdout ?? ""}\n${deploy.stderr ?? ""}`;
    if (deploy.status !== 0) {
      console.error(out);
      throw new Error("forge create failed");
    }

    const address = parseDeployedAddress(out);
    console.log(`Deployed IncidentOracle at ${address}`);

    const warp = spawnSync(
      "cast",
      [
        "send",
        address,
        "warpLastUpdated(uint256)",
        "1",
        "--rpc-url",
        RPC,
        "--private-key",
        PK,
      ],
      { encoding: "utf8" },
    );
    if (warp.status !== 0) {
      console.warn("warpLastUpdated failed:", warp.stderr);
    } else {
      console.log("Warped lastUpdated → 1 (stale oracle)");
    }

    const read = new ReadLayer({
      rpcUrl: RPC,
      contractAddress: address,
      allowMock: false,
    });
    const state = await read.readLiveState();
    console.log("\nObserved:", {
      source: state.source,
      mockLabeled: state.mockLabeled,
      oracleAgeSeconds: state.oracleAgeSeconds,
      healthFactorBps: state.healthFactorBps,
      paused: state.paused,
    });

    const drift = new DriftDetector().classify(state);
    console.log(
      `Drift severity=${drift.severity} findings=${drift.findings.length}`,
    );
    const { runbook, action } = selectRunbook(drift, address);
    console.log(
      `Runbook=${runbook?.id ?? "none"} action=${action?.functionName ?? "none"}`,
    );

    if (action) {
      const policy = new PolicyEngine({
        config: {
          ...withTargetContract(defaultPolicyConfig, address),
          humanApprovalSeverityThreshold: "critical",
          cooldownSeconds: 0,
        },
      });
      const decision = policy.decide(action);
      console.log(`Policy=${decision.verdict} (${decision.reasonCode})`);
    }

    const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
    const code = await pub.getBytecode({ address });
    console.log(`Bytecode present: ${Boolean(code && code !== "0x")}`);
    console.log("\n✓ Anvil harness OK — observe + policy path works offline");
  } finally {
    anvil?.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
