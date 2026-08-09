# ProofOps deployment record

This file distinguishes reproducible local artifacts from authoritative public
and onchain deployments. Empty public fields are represented as unchecked
release gates; no fixture address or link is substituted.

## Current record

| Component | Environment | Verified address or URL | State |
| --- | --- | --- | --- |
| Incident Flight Recorder | local | `http://127.0.0.1:3847` | verified locally |
| ProofOps container | local | image `proofops:release` | built, non-root, healthy |
| IncidentOracle | Sepolia | [`0x7e66bb0ed4fc562b6990ae44aa532a43d702dd39`](https://sepolia.etherscan.io/address/0x7e66bb0ed4fc562b6990ae44aa532a43d702dd39) | deployed; owner independently verified |
| ActionLog | Sepolia | [`0x237059c736caef4f99190ec0896d16f212257da3`](https://sepolia.etherscan.io/address/0x237059c736caef4f99190ec0896d16f212257da3) | deployed |
| KeeperHub organization wallet | Sepolia | `0x4F2f0B0f6E60CFE0917968cebAeD67CEE1051e97` | funded; owns IncidentOracle |
| KeeperHub mitigation receipt | Sepolia | [`0xbcad80956a720cba16077992426b1aaa3abd915e5830c9893c3b50e65011bcea`](https://sepolia.etherscan.io/tx/0xbcad80956a720cba16077992426b1aaa3abd915e5830c9893c3b50e65011bcea) | confirmed via KeeperHub |
| Public evidence anchor | Sepolia | [`0x9fae87849620150fa8073daef43e1cb435aec68545a432d5f0e588fe6bcd5fa4`](https://sepolia.etherscan.io/tx/0x9fae87849620150fa8073daef43e1cb435aec68545a432d5f0e588fe6bcd5fa4) | ActionLog index 0; confirmed via KeeperHub |
| Public repository | public HTTPS | [`github.com/Anand-0038/proofops`](https://github.com/Anand-0038/proofops) | verified public |
| Public dashboard | public HTTPS | no verified URL recorded | external gate |
| Demo video | public video host | no verified URL recorded | external gate |

## Local deployment

```bash
cp .env.example .env
corepack pnpm install --frozen-lockfile
corepack pnpm run verify:local
docker compose up --build
```

Health: `GET http://127.0.0.1:3847/api/health`

The response must report `localReady: true`. It will report
`submissionReady: false` until an authoritative live EvidenceRecord exists.

## Public console

Deploy the console as one Node web service. Production configures
`KEEPERHUB_API_KEY` as a secret environment variable and may leave
`PROOFOPS_OPERATOR_TOKEN` unset. The server then generates a private operator
token at startup, while public users remain read-only and cannot propose,
approve, reset, or execute anything.

Build command:

```bash
corepack enable && corepack pnpm install --frozen-lockfile && corepack pnpm build && corepack pnpm scenarios -- --small && corepack pnpm export:proof && corepack pnpm verify:proof
```

Start command: `corepack pnpm start`. Health path: `/api/health`.
Verification must cover the dashboard, `/api/health`, `/api/public-evidence`,
and `/api/integrations/keeperhub`; a provider `live` state alone is not proof.

## Testnet deployment record

The burner deployer key was used only by Foundry to create the Sepolia test
fixtures. ProofOps did not read it and cannot use it to execute a judged
mitigation. Rotate or revoke that burner key after this test run because it was
shared during setup.

```bash
cd contracts
forge script script/Deploy.s.sol:DeployIncidentOracle \
  --rpc-url "$RPC_URL" \
  --broadcast
```

Deploy the proof attestation contract with the matching one-time deployer:

```bash
cd contracts
forge script script/DeployActionLog.s.sol:DeployActionLog \
  --rpc-url "$RPC_URL" \
  --broadcast
cd ..
```

The IncidentOracle creation transaction was
`0xb90751b6e56c747f1fcc8cbb5178df7f34a283cf5e33287b5bbea7dc41feddcd`.
The ActionLog creation transaction was
`0x90ba473265eb17f49ddda7782b25b0fe401a827a41fc015947ae92061076461c`.
Ownership transfer was confirmed in transaction
`0xc11a0539363c856fb86d19c8a41f2d590979ff97a0d0704d53d34b43cc007664`.

The primary KeeperHub mitigation used execution ID
`psamqlx3v0g4xe8yvm8o7`, transaction
`0xbcad80956a720cba16077992426b1aaa3abd915e5830c9893c3b50e65011bcea`, and
audit reference
`https://app.keeperhub.com/api/execute/psamqlx3v0g4xe8yvm8o7/status`.
Independent RPC verification confirmed `paused == true` and the owner matched
the KeeperHub wallet. A corrected unsafe-call injector then produced a live
simulation block with zero submission attempts; its earlier harness regression
also created a second real pause receipt, which remains visible in the local
evidence store and is not used as the safety-block proof.

Follow [docs/live-runbook.md](docs/live-runbook.md) for the exact preflight,
simulation, execution, reconciliation, verification, and export sequence.

## Completion gates

- [x] IncidentOracle address is independently visible on the Sepolia explorer
- [x] KeeperHub organization wallet owns the incident contract
- [x] ActionLog address is independently visible on the Sepolia explorer
- [x] A confirmed KeeperHub mitigation receipt passes strict validation
- [x] The public evidence ledger digest is anchored through KeeperHub
- [ ] Public dashboard and video URLs are configured
- [ ] `corepack pnpm run release:gate` reports `Submission: COMPLETE`

Update this record only from terminal receipts and public pages. Never paste a
KeeperHub key, deployer key, operator token, or unverified transaction claim.
