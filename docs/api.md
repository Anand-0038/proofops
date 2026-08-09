# ProofOps API reference

The bundled HTTP service is an operator console for local demos and controlled
test deployments. It is not a public multi-tenant API.

## Start

```bash
corepack pnpm run demo:server
```

The service binds to `PORT` (default `3847`). If
`PROOFOPS_OPERATOR_TOKEN` is empty, it creates a mode-`0600` token file and
prints only the file path. Mutation requests use:

```http
Authorization: Bearer <operator token>
Content-Type: application/json
Origin: http://127.0.0.1:3847
```

The bearer token must contain at least 16 characters. The origin must match the
same-origin console or `PROOFOPS_ALLOWED_ORIGIN`.

## Read routes

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/` or `/dashboard` | Incident Flight Recorder |
| `GET` | `/api/health` | local readiness and verified-live evidence counts |
| `GET` | `/api/incidents` | deterministic incident scenarios |
| `GET` | `/api/evidence` | valid evidence records plus quarantined-row issues |
| `GET` | `/api/evidence/:runId` | one evidence receipt |
| `GET` | `/api/metrics` | explicit-denominator aggregates |
| `GET` | `/api/approvals` | pending, unexpired exact-action approvals |
| `GET` | `/api/proof/:file` | allowlisted exported proof artifact |
| `GET` | `/api/public-evidence` | integrity-checked live receipt ledger and ActionLog anchor |
| `GET` | `/api/integrations/keeperhub` | sanitized, cached KeeperHub MCP connection status |

`/api/health` reports `verifiedLiveEvidenceRecords`, but it never promotes a
receipt into a submission-ready claim. Public repository, demo, and video URLs
are checked only by `corepack pnpm run release:gate`.

Allowlisted proof filenames are `manifest.json`, `proof-bundle.json`,
`proof-bundle.md`, `report.html`, and `verification.json`.

The KeeperHub integration route performs server-side MCP initialization and
tool discovery. It returns only connection state, protocol/server versions,
tool count, and the presence of `search_workflows` and `call_workflow`; it never
returns the API key, MCP session ID, workflow payloads, or tool results. The
public-evidence route fails closed unless both checked-in artifacts pass schema,
digest, URL-binding, and anchor-integrity verification.

## Mutation routes

### Build a proposal

```http
POST /api/cycle
Authorization: Bearer …
Content-Type: application/json

{}
```

This route always calls `runCycle({ execute: false })`. Client-supplied execute
or approval flags are ignored. A proposal may create a pending approval, but it
cannot broadcast.

### Apply an exact approval

```http
POST /api/approvals/:approvalId/apply
Authorization: Bearer …
Content-Type: application/json

{}
```

The server atomically claims a pending approval, verifies that it exists and is
unexpired, and executes the action stored under that approval ID. A consumed,
rejected, expired, or unknown approval returns `409`.

### Reset fixture demonstrations

```http
POST /api/demo/reset
Authorization: Bearer …
Content-Type: application/json

{}
```

Only fixture rows are removed. Live evidence is preserved.

## Error shape

```json
{
  "error": {
    "code": "approval_unavailable",
    "message": "Approval is missing, expired, rejected, or already consumed",
    "nextAction": "Refresh approvals and inspect the current policy receipt.",
    "requestId": "..."
  }
}
```

Errors redact credential-shaped values. Responses use `no-store`, a restrictive
Content Security Policy, frame denial, referrer controls, and disabled
unnecessary browser permissions.

## TypeScript surface

| API | Role |
| --- | --- |
| `runCycle(options)` | observe, detect, decide, optionally simulate/execute, verify, persist |
| `PolicyEngine.decide(action)` | pure `allowed`, `approval_required`, or `blocked` verdict |
| `ApprovalQueue.create(action)` | bind SHA-256 digest and expiry to exact action |
| `KeeperHubClient.simulate(action)` | dry-run direct execution |
| `KeeperHubClient.simulateCheckAndExecute(action, intent)` | dry-run atomic condition |
| `KeeperHubClient.execute(action)` | idempotent direct execution and reconciliation |
| `EvidenceStore.readAll()` | valid records plus explicit read issues |
| `exportProofBundle(...)` | machine/human bundle plus manifest |
| `verifyProofBundle(...)` | independent digest validation |

## KeeperHub upstream calls

| Method | Path | Use |
| --- | --- | --- |
| `GET` | `/api/chains` | numeric network discovery |
| `GET` | `/api/user/wallet` | active organization wallet |
| `GET` | `/api/user/wallet/balances` | gas/value readiness |
| `GET` | `/api/mcp/schemas` | authenticated discovery |
| `POST` | `/api/execute/contract-call` | simulation and direct execution |
| `POST` | `/api/execute/check-and-execute` | atomic condition + action |
| `GET` | `/api/execute/:id/status` | terminal receipt reconciliation |

Authentication is `Authorization: Bearer kh_…`. Numeric `chainId` is used
throughout. Simulation sends boolean `true`; execution removes only that field
from the otherwise identical intent.
