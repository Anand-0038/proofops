# KeeperHub onboarding friction log

This is reproducible product evidence for the onboarding bounty. Each row names
the observed boundary, the exact reproduction, the evidence in this repository,
and a concrete upstream or starter fix. No row is invented from a hypothetical
live failure.

| ID | Boundary | Reproduction | Observed evidence | Builder cost | Implemented mitigation | Suggested KeeperHub improvement | Status |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| KH-ONB-01 | Organization vs webhook key scope is easy to confuse | Put an empty, placeholder, or `wfb_` value in `KEEPERHUB_API_KEY`; run `corepack pnpm run preflight` | Doctor stops before network and points to Settings → API Keys → Organisation; key value is never printed | ~2 min | Prefix and placeholder validation plus scope-specific copy | Put the `kh_` vs `wfb_` table in the first direct-execution quickstart step | Verified locally |
| KH-ONB-02 | Supported-chain aliases can drift and `network` is deprecated | Configure an unavailable numeric ID; run the doctor | `GET /api/chains` is the source of truth; the starter requires `isEnabled=true` and `isTestnet=true` | Prevents a later API round trip | Numeric-chain discovery and validation | Generate copyable chain constants from `/api/chains` in docs | Verified by unit test |
| KH-ONB-03 | A valid key can still point at an organization without a ready wallet | Mock or encounter `{hasWallet:false}` from `GET /api/user/wallet` | Preflight names the active-organization wallet boundary and the exact Settings route | Previously surfaced only at execute | Wallet readiness is checked before simulation | Show active organization and wallet readiness beside API-key creation | Verified by unit test |
| KH-ONB-04 | Funding and spending-cap errors arrive late and look similar to call failures | Use a zero-balance wallet or return `spending_cap_exceeded` during dry-run | The starter separates faucet funding guidance from organization-cap guidance and preserves request ID | One failed simulation instead of a failed broadcast | Balance read plus mandatory dry-run with error-code routing | Add a single read-only “execution readiness” endpoint for wallet, gas balance, and remaining cap | Verified by unit test; live balance pending |
| KH-ONB-05 | “I simulated something similar” is not a safety invariant | Change any transfer field between dry-run and execute in a test | The client constructs one typed intent, adds boolean `simulate:true`, then removes only that field | Eliminates manual body comparison | Test asserts broadcast body equals simulated intent exactly | Show an intent fingerprint in simulate and execute responses | Verified by unit test |
| KH-ONB-06 | Network interruption after broadcast creates duplicate-transaction anxiety | Make the first execute fetch throw, then allow the retry | Both captured requests have byte-identical bodies and the same `Idempotency-Key` | Avoids double spend and manual reconciliation | One bounded same-body retry, then status reconciliation | Return `originalExecutionId` in every idempotency-in-progress response and foreground it in docs | Verified by unit test |
| KH-ONB-07 | Fixed polling examples encourage rate-limit mistakes | Return `X-Poll-Interval-Hint: 1.25` on a running status | Injected sleeper receives 1,250 ms; terminal hint `0` stops | Removes unnecessary polls | Bounded hint-aware polling | Include hint-aware snippets in every language example | Verified by unit test |
| KH-ONB-08 | A demo can accidentally present dry output as a real transaction | Run `corepack pnpm run first-tx -- --fixture` | Report is `evidenceMode=fixture`, `confirmed=false`, with null receipt fields | Prevents false submission evidence | Loud fixture banner and schema-level truth fields | Standardize an `executionMode` field across examples | Verified locally |
| KH-ONB-09 | MCP reachability via a bare browser-like GET is not a stable health check | Probe the hosted MCP URL without an MCP initialize exchange | HTTP status can describe protocol mismatch rather than auth health | ~15 min in the original scaffold | Removed MCP GET from the first-write critical path; REST endpoints prove key/org readiness | Publish a documented MCP health or authenticated initialize probe for CI | Observed locally; upstream opportunity |

## Evidence commands

```bash
corepack pnpm test -- tests/onboardingStarter.test.ts
corepack pnpm run first-tx -- --fixture
corepack pnpm run preflight
```

The first two are offline/local evidence. The final command requires a real
KeeperHub organization key and network access. This workspace now has a live
confirmed receipt; durable proof publication, ActionLog anchoring, and public
submission URLs remain separate gates.
