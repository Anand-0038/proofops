# ProofOps judge guide

ProofOps is designed to be understood in 90 seconds and inspected deeply in
under 10 minutes.

## The thesis

Most agents prove that they can choose a transaction. ProofOps proves the full
incident story: why the action was allowed, whether the same intent simulated,
how an ambiguous submission recovered, what changed onchain, and whether the
exported receipt was altered.

The memorable object is the **Incident Flight Recorder**—an eight-stage,
investigation-grade execution rail.

## 90-second local journey

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run scenarios -- --small
corepack pnpm run export:proof
corepack pnpm run demo:server
```

Open `http://127.0.0.1:3847`. The server prints the path of a local operator
token. Paste its contents into the token field.

1. Read the hero and local product status. `LOCAL READY` confirms the local
   recorder is available; submission gates remain in the release CLI and are
   not presented as product state.
2. Select the `simulation_blocked` row, then the **SIMULATE** stage. Confirm
   `would_revert` and zero submissions.
3. Select `fixture_recovered`, then **RECONCILE**. Confirm two submissions and
   the recorded recovery reason.
4. Click **Build mitigation proof**. The API creates only a proposal.
5. Click **Approve exact action**. The dedicated route consumes the bound
   approval; in fixture mode it still refuses to invent a transaction.
6. Download `JSON`, then run `corepack pnpm run verify:proof`.

## Five code locations worth inspecting

| Question | File |
| --- | --- |
| Can a prompt authorize an unsafe call? | `src/agent/PolicyEngine.ts` |
| Can approval be reused for a different action? | `src/agent/ApprovalQueue.ts` |
| Can a retry duplicate an ambiguous write? | `src/keeperhub/execution.ts` |
| Can fixture data look live? | `src/evidence/EvidenceRecord.ts` |
| Can the browser bypass approval? | `src/demo/server.ts` |

## KeeperHub depth

ProofOps uses KeeperHub for the behaviors that are hardest to build safely:

- exact-intent simulation;
- atomic check-and-execute;
- managed-wallet signing;
- idempotent submission;
- hint-aware terminal reconciliation;
- execution/audit references;
- a live KeeperHub-only public-evidence attestation through `ActionLog`.

The independent RPC/Blockscout layer never writes. Removing KeeperHub leaves
only an alerting system.

## Verification commands

```bash
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run test:contracts
corepack pnpm run test:browser
corepack pnpm run export:proof
corepack pnpm run verify:proof
corepack pnpm run verify:public-evidence
corepack pnpm run audit:verify
corepack pnpm run release:gate -- --local
docker build -t proofops:local .
```

Expected local evidence:

| Gate | Expected |
| --- | ---: |
| Vitest | 117 pass, 2 live tests skipped without credentials |
| Foundry | 11 pass |
| Browser | 1440, 390, and 320 pixel journeys pass |
| Screenshots | 6 |
| Dependency audit | 0 known production vulnerabilities |
| Proof manifest | valid |
| Local readiness | complete |
| Submission readiness | waiting for external gates |

The local totals are release evidence. The public receipt ledger includes two
verified KeeperHub executions on Sepolia; submission readiness still waits on
the hosted dashboard and video URL.

## Screenshot trail

| Moment | Artifact |
| --- | --- |
| Full incident console | [incident console](assets/screenshots/proofops-incident-console.png) |
| Incident context and rail | [incident context](assets/screenshots/proofops-incident-context.png) |
| Revert prevented | [simulation block](assets/screenshots/proofops-simulation-block.png) |
| Interrupted call recovered | [retry recovery](assets/screenshots/proofops-retry-recovery.png) |
| Downloadable proof | [proof receipt](assets/screenshots/proofops-proof-receipt.png) |
| Responsive console | [mobile console](assets/screenshots/proofops-mobile-console.png) |

## Honest boundary

This repository exposes two sanitized, schema-validated live KeeperHub receipts
with explorer, audit, and post-state evidence. The dashboard does not present a
submission-ready claim. The strict gate still waits for a public dashboard and
video URL.

That gate is a feature: the project cannot accidentally ship a fixture as
submission evidence.
