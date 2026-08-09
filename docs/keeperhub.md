# KeeperHub integration

KeeperHub is ProofOps’ execution and recovery boundary, not an interchangeable
RPC provider.

## Load-bearing capabilities

| KeeperHub surface | ProofOps use | Why it is necessary |
| --- | --- | --- |
| Direct execution dry-run | simulate the exact contract intent | blocks a revert before gas and signing |
| Check-and-execute | recheck drift and execute atomically | closes the observation-to-action race |
| Managed organization wallet | signs incident and ActionLog writes | no local signer or key custody |
| Idempotency key | binds retries of the same body | prevents duplicated mitigation intent |
| Status polling and hints | reconcile to a terminal receipt | handles ambiguous submission outcomes |
| Execution audit reference | joins KeeperHub truth to EvidenceRecord | makes the receipt independently inspectable |
| Chains/wallet/balances APIs | deterministic onboarding preflight | catches scope, wallet, chain, and funding issues early |
| Hosted MCP discovery | real `initialize` + `tools/list` + `search_workflows` session with organization auth | proves agent-visible KeeperHub tools without granting write authority |

Workflow creation remains an optional deployment convenience. Payment rails are
intentionally excluded because they do not strengthen the incident safety
proof.

## Safe request contract

ProofOps follows five non-negotiable request rules:

1. discover and send numeric `chainId`;
2. represent dry-run as boolean `simulate: true`;
3. construct simulation and broadcast from one typed intent;
4. reuse one idempotency key only for an unchanged request body;
5. accept success only from a terminal status with a complete receipt.

For conditional runbooks, the check and action travel in one KeeperHub request.
If the condition is false, the evidence status records the skipped action
without presenting it as a failure or transaction.

## Ambiguous failure recovery

```text
submit body + key
  ├─ accepted + executionId ──► poll that execution
  ├─ idempotency in progress ─► adopt original executionId
  ├─ retryable transport error ► retry same body + same key
  └─ terminal client error ────► fail closed

poll timeout ──► one final reconciliation read
                  ├─ terminal: record receipt
                  └─ nonterminal: record ambiguity; do not mint a new intent
```

Backoff is bounded and honors KeeperHub’s poll/retry hints. Error records retain
stable error codes and request IDs while redacting credentials.

## First reliable transaction artifact

The standalone
[first reliable transaction starter](../keeperhub-first-reliable-tx/README.md)
reduces the first write to:

```bash
corepack pnpm run preflight
corepack pnpm run first-tx
```

It validates the organization key shape, supported testnet, wallet readiness,
balances, exact dry-run, interrupted retry, poll hints, and terminal receipt.
The fixture command is offline and visibly refuses to claim success.

The top-level onboarding check also performs a bounded, read-only MCP
initialize probe against Blockscout when `BLOCKSCOUT_MCP_URL` is configured.
Because hosted MCP transports keep their SSE connection open, the probe reads
the first `serverInfo` event and cancels the stream instead of waiting for the
connection to close.

Reproducible onboarding observations and suggested upstream improvements are in
the [friction log](FRICTION_LOG.md).

## Security ownership

The incident fixture must be owned by the KeeperHub organization wallet before
a live mitigation. Foundry can deploy and transfer a test contract, but the
agent never reads that deployer key. `ActionLog.recordAction` also uses
KeeperHub, so even the final evidence attestation preserves the execution
boundary.

## Official references

- [Direct execution](https://docs.keeperhub.com/api/direct-execution)
- [Supported chains](https://docs.keeperhub.com/api/chains)
- [Authentication](https://docs.keeperhub.com/api/authentication)
- [User and wallet](https://docs.keeperhub.com/api/user)
- [KeeperHub API](https://docs.keeperhub.com/api)

## Live validation status

All request parity, simulation, retry, reconciliation, error, fixture-integrity,
MCP discovery, and receipt-validation paths are covered locally. A real organization
credential is configured only in the ignored local environment. Two terminal
KeeperHub executions are verified on Sepolia, including the primary mitigation
receipt and its independent `paused == true` post-state. The corrected unsafe
call is also recorded as a live zero-submission simulation block. The remaining
live handoff is durable ActionLog proof hosting and public submission metadata;
follow the [live runbook](live-runbook.md) for that boundary.
