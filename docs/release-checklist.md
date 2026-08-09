# ProofOps release checklist

The release gate deliberately reports two states:

- **local complete** means the repository, proof verifier, browser journey,
  security checks, and container are reproducible without KeeperHub
  credentials;
- **submission complete** additionally requires organizer-controlled live
  credentials, public URLs, and an authoritative KeeperHub transaction.

## Local completion

- [x] Current KeeperHub numeric-chain and direct-execution contract implemented
- [x] Deterministic policy and exact-action approval tests pass
- [x] Simulation, idempotency, reconciliation, and terminal status tests pass
- [x] Fixture, mixed, and live evidence invariants enforced
- [x] Tamper-evident proof manifest verifies
- [x] ActionLog attestation path uses KeeperHub only
- [x] Operator API authentication, origin, media, size, and redaction tests pass
- [x] Desktop/mobile browser journey passes with no console errors
- [x] Required incident, simulation, retry, receipt, and mobile screenshots exist
- [x] Production dependency audit has no high or critical finding
- [x] Non-root multi-stage container builds and health endpoint responds
- [x] Tracked-text secret and local-signing scans pass
- [x] Public documentation has no stale private-window or placeholder claim
- [x] Internal Markdown links resolve

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run verify:local
docker build -t proofops:local .
```

## Submission completion

- [x] Configure a real KeeperHub `kh_` organization key locally
- [x] Confirm the KeeperHub organization wallet owns the incident contract
- [x] Record a live simulation-blocked state with zero broadcast
- [x] Record a real confirmed happy-path execution
- [ ] Record a genuine retry or reconciliation state
- [x] Verify transaction hash, explorer link, KeeperHub execution ID, audit URL, and post-state
- [x] Export and verify the final proof bundle
- [ ] Anchor its manifest through `ActionLog.recordAction` via KeeperHub
- [x] Publish the GitHub repository and set `PUBLIC_REPOSITORY_URL`
- [ ] Publish the under-three-minute demo and set `DEMO_VIDEO_URL`
- [ ] Publish the dashboard and set `PUBLIC_DEMO_URL`
- [ ] Run strict `corepack pnpm run release:gate`

The retry/reconciliation row still needs a genuine live failure observation;
the remaining dashboard, video, and attestation rows require external handoff.
Fixture data must never be used to check them.
