/**
 * MCP tool surface descriptors for incident runbooks.
 * Agents discover these shapes; PolicyEngine still authorizes every write.
 */
import { listRunbookToolDescriptors } from "../agent/IncidentRunbooks.js";

export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function getIncidentMcpTools(): McpToolDescriptor[] {
  const runbooks = listRunbookToolDescriptors();
  return [
    {
      name: "incident_run_cycle",
      title: "Run incident detection cycle",
      description:
        "Read live state, classify drift, run PolicyEngine.decide. Does not execute unless execute=true AND policy allows.",
      inputSchema: {
        type: "object",
        properties: {
          execute: { type: "boolean", default: false },
          approvalId: {
            type: "string",
            description: "A queue-issued approval bound to the exact action",
          },
        },
      },
    },
    {
      name: "incident_get_evidence",
      title: "Get evidence record",
      description: "Fetch a stored evidence run by runId from the local proof store.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
    },
    ...runbooks.map((r) => ({
      name: r.name,
      title: r.title,
      description: `${r.description} Always gated by PolicyEngine + KeeperHub simulate.`,
      inputSchema: r.inputSchema,
    })),
  ];
}
