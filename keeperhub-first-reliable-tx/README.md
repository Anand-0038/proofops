# First reliable KeeperHub transaction

Go from a fresh API key to one independently verifiable testnet transaction
without guessing which request was simulated, accidentally duplicating a
broadcast, or mistaking fixture output for onchain proof.

This is the standalone onboarding artifact for the KeeperHub onboarding bounty.
It uses the live KeeperHub REST API directly; no private key or local signer is
needed.

## The five-minute path

You need Node 20+, a verified KeeperHub account, and an organization API key
whose value starts with `kh_`.

From the parent project:

```bash
cp .env.example .env
```

Set only these values first:

```dotenv
KEEPERHUB_API_KEY=kh_your_organization_key
CHAIN_ID=11155111
```

Create the key under **KeeperHub → Settings → API Keys → Organisation**. Keep
it in `.env`; neither script prints it.

Then run:

```bash
corepack pnpm run preflight
corepack pnpm run first-tx
```

`preflight` stops before broadcast and checks:

1. Node is supported and the key is an organization key.
2. `GET /api/chains` reports the numeric chain as enabled and testnet.
3. `GET /api/user/wallet` resolves the active organization wallet.
4. `GET /api/user/wallet/balances` is reachable and flags a zero balance.
5. A `0.000001` native-token self-transfer simulates without reverting.

`first-tx` then repeats the same intent, removes only `simulate`, broadcasts it
once with a UUID idempotency key, retries only the byte-identical body with that
same key, honors `X-Poll-Interval-Hint`, and accepts success only from a
terminal receipt containing a valid transaction hash and HTTPS explorer link.

The authoritative API sequence follows KeeperHub’s
[Safe First-Write Sequence](https://docs.keeperhub.com/api/direct-execution)
and discovers networks from the
[Chains API](https://docs.keeperhub.com/api/chains).

## Truth modes

| Command | Network use | Can broadcast? | Counts as live proof? |
| --- | --- | --- | --- |
| `corepack pnpm run first-tx -- --fixture` | none | no | no |
| `corepack pnpm run preflight` | read + dry-run | no | no |
| `corepack pnpm run first-tx` | live KeeperHub | yes, after simulate | only with a validated terminal receipt |

Fixture output begins with:

```text
FIXTURE — NO TRANSACTION BROADCAST
```

It writes null transaction, execution, and explorer fields and never marks the
report confirmed. This makes the walkthrough useful before credentials arrive
without creating fake bounty evidence.

## What success looks like

The command writes both:

```text
keeperhub-first-reliable-tx/docs/time-to-first-tx.json
keeperhub-first-reliable-tx/docs/time-to-first-tx.md
```

A successful live report has:

- `evidenceMode: "live"`
- `confirmed: true`
- KeeperHub `executionId`
- a 32-byte EVM `txHash`
- an HTTPS `explorerUrl`
- KeeperHub request ID when available
- automated elapsed time and a separately stated manual-step count

Anything less remains `confirmed: false`.

## Failure recovery

| Failure | Meaning | Next move |
| --- | --- | --- |
| `unauthorized` / `insufficient_scope` | Wrong key type or organization context | Create a `kh_` key in the Organisation tab and rerun preflight |
| `wallet_not_configured` | Active organization has no usable wallet | Finish Settings → Wallet provisioning |
| zero or insufficient balance | Wallet cannot pay value plus gas | Fund the displayed organization address from a testnet faucet |
| `spending_cap_exceeded` | Organization daily cap rejected the intent | Raise the cap or lower the amount, then simulate again |
| `rate_limited` | Direct-execution budget is temporarily exhausted | Honor `Retry-After`; preserve body and idempotency key |
| network interruption after broadcast | Outcome is ambiguous | Retry the exact body/key, then reconcile the original execution ID |
| `receipt_incomplete` | No authoritative onchain proof yet | Do not rebroadcast or claim success; resume status polling |

Every API error preserves the stable error code and request ID while turning
changeable detail text into a concrete next action. Secrets are never included
in reports.

## The small reusable client

[`src/keeperhub.ts`](src/keeperhub.ts) is intentionally dependency-light and
teaches five rules in code:

1. use numeric `chainId`, never the deprecated `network` alias;
2. send `simulate` as boolean `true`;
3. broadcast the same intent with only `simulate` removed;
4. keep one idempotency key for an unchanged-body transport retry;
5. treat the status endpoint’s hash and link as authoritative.

The focused tests run without credentials:

```bash
corepack pnpm test -- tests/onboardingStarter.test.ts
```

They cover bare and `{data}` response shapes, structured errors, cap/funding
guidance, request parity, interrupted retry, poll hints, and fixture honesty.

## Security boundary

- The organization wallet remains in KeeperHub custody.
- This starter never imports a local wallet, mnemonic, or private key.
- Dry-run simulation neither signs nor broadcasts.
- A different request body requires a new idempotency key and a new simulation.
- A Safe-routed organization should read KeeperHub’s documented simulation
  limitation: dry-run sender semantics use the organization EOA.

For authentication scope, see the official
[Authentication guide](https://docs.keeperhub.com/api/authentication).
