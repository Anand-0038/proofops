import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  attestProofThroughKeeperHub,
  prepareActionAttestation,
} from "../src/evidence/attestation.js";
import type { KeeperHubClient } from "../src/keeperhub/client.js";

const ACTION_LOG = "0x0000000000000000000000000000000000000002";

describe("ActionLog proof attestation", () => {
  it("binds the incident and manifest bytes into KeeperHub calldata", () => {
    const prepared = prepareActionAttestation({
      incident: "incident-42",
      manifestBytes: new TextEncoder().encode('{"proof":"fixture"}\n'),
      uri: "https://example.org/proofs/incident-42/manifest.json",
      actionLogAddress: ACTION_LOG,
      chainId: 11_155_111,
    });

    expect(prepared.manifestSha256).toMatch(/^0x[a-f0-9]{64}$/);
    expect(prepared.incidentId).toMatch(/^0x[a-f0-9]{64}$/);
    expect(prepared.calldata).toMatch(/^0x/);
    expect(prepared.action).toMatchObject({
      contractAddress: ACTION_LOG,
      chainId: 11_155_111,
      functionName: "recordAction",
      functionArgs: [
        prepared.incidentId,
        prepared.manifestSha256,
        "https://example.org/proofs/incident-42/manifest.json",
      ],
    });
  });

  it("simulates and executes the attestation only through KeeperHub", async () => {
    const keeperhub = {
      simulate: vi.fn(async () => ({
        status: "ok",
        wouldRevert: false,
      })),
      execute: vi.fn(async () => ({
        ok: true,
        executed: true,
        executionId: "direct_attestation",
        status: "completed",
        txHash: `0x${"a".repeat(64)}`,
        explorerUrl: `https://sepolia.etherscan.io/tx/0x${"a".repeat(64)}`,
        gasUsed: "80000",
        attempts: [{ attempt: 1, ok: true }],
        auditReference:
          "https://app.keeperhub.com/api/execute/direct_attestation/status",
      })),
    } as unknown as KeeperHubClient;
    const prepared = prepareActionAttestation({
      incident: "incident-42",
      manifestBytes: new TextEncoder().encode("{}\n"),
      uri: "ipfs://bafy-proof/manifest.json",
      actionLogAddress: ACTION_LOG,
      chainId: 11_155_111,
    });

    const result = await attestProofThroughKeeperHub(keeperhub, prepared);

    expect(result.execution?.ok).toBe(true);
    expect(keeperhub.simulate).toHaveBeenCalledWith(prepared.action);
    expect(keeperhub.execute).toHaveBeenCalledWith(prepared.action);
  });

  it("does not expose a local signing path in judged agent code", () => {
    const files = [
      "src/evidence/attestation.ts",
      "scripts/record-action.ts",
      "src/agent/runCycle.ts",
    ];
    const source = files
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /privateKeyToAccount|walletClient|sendTransaction|writeContract|PRIVATE_KEY/,
    );
  });
});
