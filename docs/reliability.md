# Reliability model

ProofOps measures incident outcomes, not vanity transaction volume. Every rate
names its denominator and every failure claim names its evidence mode.

## Scenario matrix

| Scenario | Expected control | Local proof | Live proof |
| --- | --- | --- | --- |
| happy path | policy and simulation pass | proposed fixture receipt | 2 confirmed KeeperHub receipts; primary post-state independently verified |
| reverting action | simulation blocks, zero submission | browser + unit receipt | live ActionLog `pause()` simulation block with 0 submissions |
| interrupted submission | identical body/key retries | executor and onboarding tests | awaiting credentialed run |
| gas constraint | controlled multiplier change | fixture recovery receipt | awaiting credentialed run |
| status timeout | final reconciliation of original execution | executor tests | awaiting credentialed run |
| idempotency conflict | adopt original execution ID | executor tests | awaiting credentialed run |
| stale approval | reject before KeeperHub | approval tests | deterministic local control |
| changed drift condition | KeeperHub condition prevents action | conditional runbook tests | awaiting credentialed run |
| unsafe recommendation | policy blocks before simulation | policy receipt and tests | deterministic local control |
| malformed evidence | quarantine and exclude | evidence tests + dashboard count | applies to all modes |

Fixture scenarios are the default:

```bash
corepack pnpm run scenarios -- --small
```

Live behavior requires the explicit `--live` flag. This prevents a local or CI
command from accidentally broadcasting because credentials happened to exist.

## Metrics

```text
success rate = confirmed / all valid runs

first-attempt success = confirmed on attempt 1 / runs that submitted

recovery rate = recovered after retry / multi-attempt runs

simulation catch rate =
  simulation_blocked / (simulation_blocked + confirmed + failed)
```

If a denominator is zero, the report prints `n/a`. Policy and simulation blocks
remain real outcomes in the all-runs denominator; they are not silently removed
to improve success rate.

## Current measured window

The committed [reliability report](reliability-report.md) currently contains:

- 144 valid runs;
- 52 fixture rehearsals, including 46 recovery demonstrations;
- 3 simulation blocks, including 1 live zero-submission block;
- 50 deterministic policy blocks;
- 2 confirmed KeeperHub transactions;
- 8 schema-invalid legacy rows quarantined and excluded.

The displayed 100% recovery rate is explicitly **46/46 fixture multi-attempt
runs**, not a live KeeperHub reliability claim. The two confirmed live receipts
prove execution and reconciliation for this run, not a long-term platform
reliability rate. One is the intended mitigation; the other is retained as a
transparent record of the unsafe-injector regression and is not safety-block
evidence.

## Claim policy

| Claim label | Meaning |
| --- | --- |
| verified locally | deterministic test, fixture, browser, or contract proof |
| verified live | authoritative KeeperHub receipt and public transaction |
| awaiting live validation | implemented path without a credentialed terminal receipt |
| external dependency | behavior owned by KeeperHub or a network provider |

The demo may show the confirmed live receipt for the bounded pause path. It must
still say “fixture recovery demonstration” for retry scenarios without a live
terminal receipt. Nonce management and platform-managed gas behavior remain
external dependencies unless the live audit explicitly exposes them.

## Regeneration

```bash
corepack pnpm run scenarios -- --small
corepack pnpm run report
corepack pnpm run export:proof
corepack pnpm run verify:proof
```

Run live scenarios only through the guarded procedure in
[live-runbook.md](live-runbook.md). Preserve the original evidence store before
any experiment and never edit a receipt by hand.
