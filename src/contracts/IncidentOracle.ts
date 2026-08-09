/**
 * IncidentOracle ABI + helpers.
 * Keep in sync with contracts/src/IncidentOracle.sol
 */
export const INCIDENT_ORACLE_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_heartbeat", type: "uint256" },
      { name: "_price", type: "uint256" },
      { name: "_maxDeviationBps", type: "uint256" },
      { name: "_healthFactorBps", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "heartbeat",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastUpdated",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "price",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxDeviationBps",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "healthFactorBps",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setHeartbeat",
    inputs: [{ name: "_heartbeat", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPrice",
    inputs: [{ name: "_price", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setMaxDeviationBps",
    inputs: [{ name: "bps", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setHealthFactorBps",
    inputs: [{ name: "bps", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "warpLastUpdated",
    inputs: [{ name: "ts", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** JSON string for KeeperHub contract-call API `abi` field. */
export const INCIDENT_ORACLE_ABI_JSON = JSON.stringify(INCIDENT_ORACLE_ABI);

export type IncidentWriteFn =
  | "setHeartbeat"
  | "setMaxDeviationBps"
  | "pause"
  | "unpause";

export function serializeArgsForKeeperHub(args: unknown[] | undefined): unknown[] {
  if (!args) return [];
  return args.map((a) => {
    if (typeof a === "bigint") return a.toString();
    return a;
  });
}
