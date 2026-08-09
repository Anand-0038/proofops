import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { basename, extname, join } from "node:path";
import { ApprovalQueue } from "../agent/ApprovalQueue.js";
import { runCycle } from "../agent/runCycle.js";
import {
  EvidenceStore,
  isVerifiedLiveExecution,
} from "../evidence/EvidenceRecord.js";
import { aggregateEvidence } from "../evidence/aggregate.js";
import {
  assertMutationAuthorized,
  DemoHttpError,
  readJsonBody,
  requestId,
  secureHeaders,
  sendError,
  sendJson,
} from "./http.js";
import {
  INCIDENT_FIXTURES,
  publicCycleResult,
  resolveIncidentById,
} from "./routes.js";

interface ProofOpsServerOptions {
  operatorToken: string;
  allowedOrigins: string[];
  evidenceStore: EvidenceStore;
  approvalQueue: ApprovalQueue;
  runCycleFn?: typeof runCycle;
  staticDir: string;
  proofDir: string;
  maxBodyBytes?: number;
}

const PROOF_FILES = new Set([
  "manifest.json",
  "proof-bundle.json",
  "proof-bundle.md",
  "report.html",
  "verification.json",
]);

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".md":
      return "text/markdown; charset=utf-8";
    default:
      return "application/json; charset=utf-8";
  }
}

function sendFile(
  response: ServerResponse,
  path: string,
  correlationId: string,
): void {
  if (!existsSync(path)) {
    throw new DemoHttpError(
      404,
      "not_found",
      "Requested artifact does not exist",
      "Generate the dashboard or export the proof bundle first.",
    );
  }
  response.writeHead(200, {
    ...secureHeaders(false),
    "Content-Type": contentType(path),
    "x-request-id": correlationId,
  });
  response.end(readFileSync(path));
}

function mutation(request: IncomingMessage): boolean {
  return request.method === "POST";
}

export function createProofOpsServer(options: ProofOpsServerOptions): Server {
  if (options.operatorToken.length < 16) {
    throw new Error("ProofOps operator token must contain at least 16 characters");
  }
  const run = options.runCycleFn ?? runCycle;
  const maxBodyBytes = options.maxBodyBytes ?? 16 * 1024;

  return createServer(async (request, response) => {
    const correlationId = requestId();
    try {
      const host = request.headers.host ?? "localhost";
      const url = new URL(request.url ?? "/", `http://${host}`);
      const path = url.pathname;

      if (request.method === "OPTIONS") {
        throw new DemoHttpError(
          405,
          "method_not_allowed",
          "Cross-origin preflight is not supported",
          "Use the same-origin ProofOps dashboard.",
        );
      }
      if (mutation(request)) {
        assertMutationAuthorized({
          request,
          operatorToken: options.operatorToken,
          allowedOrigins: options.allowedOrigins,
        });
      }

      if ((path === "/" || path === "/dashboard") && request.method === "GET") {
        sendFile(
          response,
          join(options.staticDir, "index.html"),
          correlationId,
        );
        return;
      }
      if (path.startsWith("/assets/") && request.method === "GET") {
        const file = path.slice("/assets/".length);
        if (!file || basename(file) !== file) {
          throw new DemoHttpError(
            404,
            "not_found",
            "Asset not found",
            "Use a dashboard-generated asset path.",
          );
        }
        sendFile(
          response,
          join(options.staticDir, "assets", file),
          correlationId,
        );
        return;
      }
      if (path.startsWith("/api/proof/") && request.method === "GET") {
        const file = path.slice("/api/proof/".length);
        if (!PROOF_FILES.has(file)) {
          throw new DemoHttpError(
            404,
            "not_found",
            "Proof artifact not found",
            "Export the proof bundle and request an allowlisted artifact.",
          );
        }
        sendFile(response, join(options.proofDir, file), correlationId);
        return;
      }

      if (path === "/health" && request.method === "GET") {
        response.writeHead(308, {
          ...secureHeaders(true),
          Location: "/api/health",
          "x-request-id": correlationId,
        });
        response.end();
        return;
      }
      if (path === "/api/health" && request.method === "GET") {
        const read = options.evidenceStore.readAll();
        const verifiedLiveEvidenceRecords = read.records.filter(
          isVerifiedLiveExecution,
        ).length;
        sendJson(
          response,
          200,
          {
            ok: true,
            service: "proofops",
            localReady: true,
            // Public links are intentionally outside this local service. The
            // strict release gate is the only authority for this claim.
            submissionReady: false,
            submissionReadinessSource: "release_gate",
            verifiedLiveEvidenceRecords,
            validEvidenceRecords: read.records.length,
            quarantinedEvidenceRows: read.issues.length,
          },
          correlationId,
        );
        return;
      }
      if (path === "/api/incidents" && request.method === "GET") {
        sendJson(
          response,
          200,
          { incidents: INCIDENT_FIXTURES },
          correlationId,
        );
        return;
      }
      if (path === "/api/evidence" && request.method === "GET") {
        sendJson(
          response,
          200,
          options.evidenceStore.readAll(),
          correlationId,
        );
        return;
      }
      if (path.startsWith("/api/evidence/") && request.method === "GET") {
        const runId = decodeURIComponent(path.slice("/api/evidence/".length));
        const read = options.evidenceStore.readAll();
        const record = read.records.find((entry) => entry.runId === runId);
        if (!record) {
          throw new DemoHttpError(
            404,
            "evidence_not_found",
            `No evidence record for ${runId}`,
            "Refresh the evidence list and choose an existing run.",
          );
        }
        sendJson(response, 200, { record }, correlationId);
        return;
      }
      if (path === "/api/metrics" && request.method === "GET") {
        const read = options.evidenceStore.readAll();
        sendJson(
          response,
          200,
          {
            ...aggregateEvidence(read.records),
            evidenceReadIssues: read.issues.length,
          },
          correlationId,
        );
        return;
      }
      if (path === "/api/approvals" && request.method === "GET") {
        sendJson(
          response,
          200,
          { approvals: options.approvalQueue.listPending() },
          correlationId,
        );
        return;
      }

      if (path === "/api/cycle" && request.method === "POST") {
        const body = await readJsonBody(request, maxBodyBytes);
        const incidentId = typeof body.incidentId === "string" ? body.incidentId : null;
        if (!incidentId) {
          throw new DemoHttpError(
            400,
            "invalid_incident_request",
            "A valid incident identifier is required",
            "Send { incidentId: \"health-factor-breach\" } with a known fixture id.",
          );
        }
        const incident = resolveIncidentById(incidentId);
        if (!incident) {
          throw new DemoHttpError(
            400,
            "unknown_incident",
            "Unknown incident id",
            "Use one of the current fixture ids from /api/incidents.",
          );
        }
        const result = await run({
          execute: false,
          triggerType: "webhook",
          scenarioId: incident.id,
          evidenceStore: options.evidenceStore,
          approvalQueue: options.approvalQueue,
        });
        sendJson(
          response,
          200,
          {
            ...publicCycleResult(result),
            executionAuthorized: false,
          },
          correlationId,
        );
        return;
      }

      const approvalMatch = path.match(
        /^\/api\/approvals\/([^/]+)\/apply$/,
      );
      if (approvalMatch && request.method === "POST") {
        await readJsonBody(request, maxBodyBytes);
        const approvalId = decodeURIComponent(approvalMatch[1]!);
        const pending = options.approvalQueue
          .listPending()
          .find((entry) => entry.id === approvalId);
        if (!pending) {
          throw new DemoHttpError(
            409,
            "approval_unavailable",
            "Approval is missing, expired, rejected, or already consumed",
            "Refresh approvals and inspect the current policy receipt.",
          );
        }
        const approved = options.approvalQueue.resolve(
          approvalId,
          "approved",
        );
        if (!approved) {
          throw new DemoHttpError(
            409,
            "approval_race",
            "Approval could not be claimed",
            "Refresh approvals; another operator may have resolved it.",
          );
        }
        const result = await run({
          execute: true,
          approvalId,
          forceAction: approved.action,
          triggerType: "manual",
          scenarioId: `approval-${approvalId}`,
          evidenceStore: options.evidenceStore,
          approvalQueue: options.approvalQueue,
        });
        sendJson(
          response,
          200,
          {
            ...publicCycleResult(result),
            executionAuthorized: true,
          },
          correlationId,
        );
        return;
      }

      if (path === "/api/demo/reset" && request.method === "POST") {
        await readJsonBody(request, maxBodyBytes);
        const removed = options.evidenceStore.removeFixtureRecords();
        sendJson(
          response,
          200,
          {
            removedFixtureRecords: removed,
            preservedLiveEvidence: true,
          },
          correlationId,
        );
        return;
      }

      throw new DemoHttpError(
        404,
        "not_found",
        "Route not found",
        "Use /api/health, /api/incidents, /api/evidence, /api/metrics, /api/approvals, or the dashboard.",
      );
    } catch (error) {
      sendError(response, error, correlationId);
    }
  });
}
