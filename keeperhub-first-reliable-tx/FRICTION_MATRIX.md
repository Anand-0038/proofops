# Onboarding friction matrix

The canonical, evidence-linked matrix is
[`../docs/FRICTION_LOG.md`](../docs/FRICTION_LOG.md). The starter directly
addresses its highest-leverage first-write boundaries:

| Boundary | Starter response |
| --- | --- |
| Wrong key scope | validates a `kh_` organization key without printing it |
| Unsupported chain | discovers an enabled testnet from `GET /api/chains` |
| Missing organization wallet | checks the active organization before simulate |
| Funding or daily cap | reports separate, actionable recovery paths |
| Simulation drift | derives simulate and broadcast from one typed intent |
| Ambiguous transport failure | replays one byte-identical body/key, then reconciles |
| Poll pressure | honors bounded `X-Poll-Interval-Hint` seconds |
| Fixture/live confusion | fixture report cannot contain a confirmed receipt |

Run `corepack pnpm test -- tests/onboardingStarter.test.ts` for the executable evidence.
