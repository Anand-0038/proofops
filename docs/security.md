# ProofOps security model

ProofOps is a bounded incident-response controller. It can recommend and
orchestrate a mitigation, but deterministic code and KeeperHub remain the
authority boundary. No prompt, dashboard field, or fixture can authorize a
transaction by itself.

## Trust boundaries

| Boundary | Untrusted input | Control | Failure behavior |
| --- | --- | --- | --- |
| Observation | RPC, Blockscout, fixture state | typed read model, source timestamp, explicit `mockLabeled` | degrade to labeled fixture or stop |
| Runbook selection | drift findings | finite typed runbooks and allowlisted calls | no matching action means no write |
| Policy | proposed call, severity, approval context | deterministic allowlist, value caps, cooldown, blocklist | fail closed with reason code |
| Human approval | operator click and approval ID | 15-minute expiry and SHA-256 binding to the exact action | missing, stale, mismatched, rejected, or replayed approval fails |
| Simulation | KeeperHub response | strict boolean `simulate`, same-intent comparison | revert or false condition yields zero broadcast attempts |
| Execution | network ambiguity and retries | KeeperHub-only broadcast, canonical body hash, idempotency key, bounded retry | reconcile original execution before another intent |
| Evidence | JSONL and external URLs | Zod validation, quarantine, fixture/live invariants, HTTPS validation | malformed rows excluded and reported |
| Operator API | browser origin, bearer token, JSON body | constant-time token check, same-origin allowlist, size/media validation | structured error with redacted detail |
| Proof export | files on disk | SHA-256 manifest plus independent verifier | digest mismatch fails release gate |

## Execution authority

- Incident mitigations and `ActionLog.recordAction` attestations are sent only
  through KeeperHub.
- Judged execution modules import no local signer, mnemonic, or private-key
  account primitive.
- The separate Foundry deployment helper may use a deployer key for one-time
  test-contract setup. It is outside the mitigation path, never consumed by the
  agent, and ownership must be transferred to the KeeperHub organization
  wallet before a live run.
- Read-only observation uses public RPC or Blockscout credentials only.

## API and browser controls

Mutation endpoints require:

1. a bearer operator token of at least 16 characters;
2. a trusted browser `Origin` when the header is present;
3. `application/json`;
4. a bounded request body;
5. the dedicated approval route for execution.

`POST /api/cycle` is proposal-only even if the body contains forged execution
flags. The browser keeps the token only in the input’s in-memory DOM state; it
does not use cookies, local storage, or query parameters.

Responses set a same-origin Content Security Policy, deny framing, disable
credential-bearing referrers, disable unnecessary browser permissions, and use
`no-store` for API data. API-derived UI content is inserted with `textContent`;
fixture evidence cannot create transaction or audit anchors.

## Secrets

- `.env`, local operator tokens, PEM files, runtime evidence, and build outputs
  are ignored.
- `kh_…` and bearer values are redacted from error copy.
- `.env.example` contains recognizable non-secret examples only.
- The release gate scans tracked text for credential-shaped KeeperHub keys and
  literal private-key assignments.
- The lockfile-bound production dependency audit currently reports zero known
  vulnerabilities; see [`dependency-audit.json`](dependency-audit.json).

Never paste credentials into issues, demo narration, screenshots, proof
bundles, or chat.

## Container boundary

The runtime image:

- is built in a separate stage with `corepack pnpm install --frozen-lockfile`;
- contains production dependencies only;
- runs as the unprivileged `node` user;
- generates its operator token inside the writable data volume;
- exposes only port 3847;
- has a health check;
- is run by Compose with a read-only root filesystem, all Linux capabilities
  dropped, `no-new-privileges`, and a bounded temporary filesystem.

## Residual risks and operator duties

| Risk | Current status | Operator duty |
| --- | --- | --- |
| KeeperHub or upstream RPC compromise | external trust | verify the terminal receipt and independent post-state |
| Safe-routed simulation sender differs from Safe execution semantics | documented KeeperHub limitation | test Safe-specific authorization on testnet |
| Publicly reachable local demo token | configuration risk | set a strong token, TLS, and network access controls; the bundled server is a demo |
| JSONL concurrency under multiple server replicas | local single-writer design | use one demo replica or replace stores with transactional persistence |
| Live retry/reconciliation evidence | not yet credential-verified | perform the live runbook and retain request IDs |
| Screenshot accessibility beyond automated checks | partially manual | retain keyboard, contrast, mobile, and reduced-motion review in release checklist |

Security contact for a published repository should use GitHub private
vulnerability reporting rather than a public issue.
