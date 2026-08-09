import { createHash } from "node:crypto";
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  ACTION_LOG_ABI,
  ACTION_LOG_ABI_JSON,
} from "../contracts/ActionLog.js";
import type {
  ExecutionResult,
  KeeperHubAction,
  KeeperHubClient,
  SimulationResult,
} from "../keeperhub/client.js";

export interface PreparedActionAttestation {
  incident: string;
  incidentId: Hex;
  manifestSha256: Hex;
  uri: string;
  calldata: Hex;
  action: KeeperHubAction;
}

export function prepareActionAttestation(input: {
  incident: string;
  manifestBytes: Uint8Array;
  uri: string;
  actionLogAddress: string;
  chainId: number;
}): PreparedActionAttestation {
  if (!input.incident.trim()) throw new Error("Incident identifier is required");
  if (!input.uri.trim()) throw new Error("Proof URI is required");
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.actionLogAddress)) {
    throw new Error("ACTION_LOG_ADDRESS must be a 20-byte hex address");
  }
  const incidentId = keccak256(stringToHex(input.incident));
  const manifestSha256 =
    `0x${createHash("sha256").update(input.manifestBytes).digest("hex")}` as Hex;
  const args = [incidentId, manifestSha256, input.uri] as const;
  const calldata = encodeFunctionData({
    abi: ACTION_LOG_ABI,
    functionName: "recordAction",
    args,
  });
  return {
    incident: input.incident,
    incidentId,
    manifestSha256,
    uri: input.uri,
    calldata,
    action: {
      contractAddress: input.actionLogAddress as Address,
      chainId: input.chainId,
      functionName: "recordAction",
      functionArgs: [...args],
      abi: ACTION_LOG_ABI_JSON,
      value: "0",
    },
  };
}

export async function attestProofThroughKeeperHub(
  keeperhub: KeeperHubClient,
  prepared: PreparedActionAttestation,
): Promise<{
  prepared: PreparedActionAttestation;
  simulation: SimulationResult;
  execution: ExecutionResult | null;
}> {
  const simulation = await keeperhub.simulate(prepared.action);
  if (simulation.status !== "ok" || simulation.wouldRevert) {
    return { prepared, simulation, execution: null };
  }
  const execution = await keeperhub.execute(prepared.action);
  return { prepared, simulation, execution };
}
