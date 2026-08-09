# ProofOps live KeeperHub runbook

This procedure closes the mandatory transaction gate without weakening the
project’s truth or signing boundaries. It is intentionally conservative: stop
at the first mismatch and preserve the evidence.

## Inputs

You need:

- a verified KeeperHub account and `kh_` organization key;
- the KeeperHub organization wallet address;
- Sepolia ETH for the organization wallet and one-time deployer;
- a trusted Sepolia RPC URL;
- authority to publish the final repository, dashboard, and video.

Keep credentials in an untracked `.env` or exported shell environment. Never
paste them into commands that will be recorded, screenshots, issues, or chat.

## 1. Establish a clean local baseline

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run verify:local
git status --short
```

The local gate must be complete before any onchain write. Preserve
`data/evidence.jsonl` and `data/approvals.jsonl` if they contain earlier live
records.

## 2. Configure only local environment

```bash
cp .env.example .env
```

Set:

```dotenv
KEEPERHUB_API_KEY=<organization key>
RPC_URL=<trusted Sepolia RPC>
CHAIN_ID=11155111
NETWORK=sepolia
WALLET_ADDRESS=<KeeperHub organization wallet>
```

The key must come from **KeeperHub → Settings → API Keys → Organisation**.

## 3. Validate the first-write boundary

```bash
corepack pnpm run preflight
```

Preflight must confirm:

1. Sepolia is enabled and recognized by numeric chain ID;
2. the active organization has a ready managed wallet;
3. wallet balances are readable and sufficient for gas;
4. an exact self-transfer dry-run succeeds.

If any check fails, use the printed request ID and next action. Do not continue
by bypassing the client.

Optionally record the smallest independently verifiable KeeperHub write:

```bash
corepack pnpm run first-tx
```

This is useful onboarding proof, but the strongest judged receipt is the
incident mitigation below.

## 4. Deploy test fixtures

Use a one-time Sepolia deployer outside ProofOps:

```bash
corepack pnpm run deploy:oracle -- --broadcast
```

Deploy `ActionLog` with Foundry’s deployment tooling, then record both
addresses in `.env`:

```bash
cd contracts
forge script script/DeployActionLog.s.sol:DeployActionLog \
  --rpc-url "$RPC_URL" \
  --broadcast
cd ..
```

```dotenv
TARGET_CONTRACT_ADDRESS=<IncidentOracle address>
TARGET_ORACLE_ADDRESS=<same address>
ACTION_LOG_ADDRESS=<ActionLog address>
```

Transfer `IncidentOracle` ownership to the KeeperHub organization wallet:

```bash
cd contracts
forge script script/TransferOwnership.s.sol:TransferOwnership \
  --rpc-url "$RPC_URL" \
  --broadcast
cd ..
```

Independently read `owner()` through the explorer or RPC and compare it with
`WALLET_ADDRESS`. Do not continue if they differ.

## 5. Record a zero-broadcast safety receipt

Use a controlled call that simulation will reject:

```bash
corepack pnpm run inject:failure -- unsafe_call
```

Confirm the newest evidence row has:

- `status: "simulation_blocked"`;
- `submissionAttempts: 0`;
- a KeeperHub simulation result with the revert reason;
- no transaction hash or explorer URL.

This is proof of the pre-gas safety gate, not the mandatory transaction.

## 6. Propose and approve the mitigation

Run the detector without execution:

```bash
corepack pnpm run cycle
corepack pnpm run approve -- list
```

Inspect the contract, function, arguments, value, severity, rationale, action
fingerprint, and expiry. If the action is not exactly expected, reject it:

```bash
corepack pnpm run approve -- reject <approval-id>
```

If it is correct, execute the exact approved action:

```bash
corepack pnpm run approve -- <approval-id>
```

Do not use a local signer or direct RPC broadcast as a fallback.

## 7. Verify terminal truth

The resulting record must include:

- evidence mode `live` or `mixed`;
- terminal status `confirmed`;
- KeeperHub execution ID;
- 32-byte transaction hash;
- public HTTPS explorer URL containing that same hash;
- KeeperHub HTTPS audit reference;
- independent post-state matching the mitigation.

Open the explorer and KeeperHub audit pages separately. Compare the full hash,
chain, contract, function, sender, terminal status, and timestamp.

If the request timed out, inspect the original execution ID. Do not create a
new intent until reconciliation proves the first one terminal.

## 8. Export and anchor the incident proof

```bash
corepack pnpm run report
corepack pnpm run export:proof
corepack pnpm run verify:proof
```

Publish the proof bundle at a durable HTTPS or IPFS URI. Then attest its manifest
through KeeperHub:

```bash
corepack pnpm run record:action -- \
  --incident <incident-id> \
  --file data/proof-bundle/manifest.json \
  --uri <durable-proof-uri> \
  --action-log "$ACTION_LOG_ADDRESS" \
  --execute
```

Verify the `ActionRecorded` event and record its transaction separately. The
attestation is an additional proof; it does not replace the mitigation receipt.

## 9. Publish and run the strict gate

Set local release variables after the pages exist:

```dotenv
PUBLIC_REPOSITORY_URL=<public GitHub repository>
PUBLIC_DEMO_URL=<public HTTPS dashboard>
DEMO_VIDEO_URL=<public video>
```

Then:

```bash
corepack pnpm run release:gate
```

Release only when it reports `Submission: COMPLETE`. Copy verified addresses
and URLs into [DEPLOYMENTS.md](../DEPLOYMENTS.md) and the submission form.

## Stop conditions

Stop and preserve logs when:

- simulation and execution intent fingerprints differ;
- ownership is not the KeeperHub organization wallet;
- the response lacks an execution ID;
- the explorer hash does not match the EvidenceRecord;
- post-state cannot be verified independently;
- an approval is expired, reused, or bound to another action;
- any fixture row gains a live-looking field;
- strict release validation rejects the receipt.

A transparent incomplete live run is stronger than an unverifiable success
claim.
