import { env } from "../config/env.js";
import { KeeperHubClient } from "./client.js";

/**
 * Create / execute a KeeperHub workflow for the incident keeper runbook.
 * Workflow builder surface — load-bearing when WORKFLOW_ID is unset.
 */

export interface IncidentWorkflowSpec {
  name: string;
  description: string;
  network: string;
  contractAddress: string;
}

export function buildIncidentPauseWorkflowNodes(spec: IncidentWorkflowSpec) {
  const triggerId = "trigger-manual";
  const writeId = "write-pause";
  return {
    nodes: [
      {
        id: triggerId,
        type: "trigger",
        data: {
          label: "Manual Incident Trigger",
          description: "Operator or agent triggers incident pause",
          type: "trigger",
          config: { triggerType: "Manual" },
          status: "idle",
        },
      },
      {
        id: writeId,
        type: "action",
        data: {
          label: "Pause Incident Oracle",
          description: "Allowlisted pause() via KeeperHub",
          type: "action",
          config: {
            actionType: "web3/write-contract",
            network: spec.network === "sepolia" ? "11155111" : spec.network,
            contractAddress: spec.contractAddress,
            abiFunction: "pause",
          },
          status: "idle",
        },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: triggerId,
        target: writeId,
      },
    ],
  };
}

export async function createIncidentWorkflow(
  client: KeeperHubClient,
  spec: IncidentWorkflowSpec,
): Promise<{ workflowId: string; raw: unknown }> {
  const { nodes, edges } = buildIncidentPauseWorkflowNodes(spec);
  const body = {
    name: spec.name,
    description: spec.description,
    enabled: false,
    nodes,
    edges,
  };

  const { data } = await client.request<{
    id?: string;
    workflowId?: string;
  }>("POST", "/api/workflows", body);

  const workflowId = String(data.id ?? data.workflowId ?? "");
  if (!workflowId) {
    throw new Error(
      "KeeperHub create workflow returned no id — check API response shape in office hours",
    );
  }
  return { workflowId, raw: data };
}

export async function executeWorkflow(
  client: KeeperHubClient,
  workflowId: string,
  input: Record<string, unknown> = {},
): Promise<{ executionId: string; status: string; raw: unknown }> {
  const { data } = await client.request<{
    executionId?: string;
    status?: string;
  }>("POST", `/api/workflows/${workflowId}/execute`, { input });

  return {
    executionId: String(data.executionId ?? ""),
    status: String(data.status ?? "unknown"),
    raw: data,
  };
}

export async function ensureIncidentWorkflow(
  client: KeeperHubClient,
): Promise<string> {
  if (env.WORKFLOW_ID) return env.WORKFLOW_ID;
  if (!env.TARGET_CONTRACT_ADDRESS) {
    throw new Error(
      "Set TARGET_CONTRACT_ADDRESS (or WORKFLOW_ID) before creating an incident workflow",
    );
  }
  const { workflowId } = await createIncidentWorkflow(client, {
    name: "incident-keeper-pause",
    description:
      "Bounded incident pause runbook for KeeperHub Incident Keeper hackathon agent",
    network: env.NETWORK,
    contractAddress: env.TARGET_CONTRACT_ADDRESS,
  });
  return workflowId;
}
