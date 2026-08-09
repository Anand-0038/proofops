export const ACTION_LOG_ABI = [
  {
    type: "function",
    name: "recordAction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "incidentId", type: "bytes32" },
      { name: "artifactHash", type: "bytes32" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "index", type: "uint256" }],
  },
] as const;

export const ACTION_LOG_ABI_JSON = JSON.stringify(ACTION_LOG_ABI);
