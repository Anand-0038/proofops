# Reliability Report

Window: 2026-07-30T02:53:52.527Z → 2026-08-09T09:09:10.949Z
Total runs (denominator): **144**

## Outcomes

| Outcome | Count |
| --- | ---: |
| Confirmed | 2 |
| Verified live KeeperHub executions | 2 |
| Fixture recovery demonstrations | 46 |
| Failed | 0 |
| Policy blocked | 50 |
| Simulation blocked | 3 |
| Approval required | 1 |

## Rates (explicit denominators)

- Success rate: 1.4% (2/144) — confirmed / all runs
- First-attempt success: 4.2% (0/2) — confirmed-on-attempt-1 / attempted
- Recovery rate: 100.0% (46 recovered / multi-attempt runs)
- Simulation catch rate: 60.0% (simulation_blocked / (sim_blocked+confirmed+failed))

## Latency & gas

- Median confirmation latency: 334 ms
- P95 confirmation latency: 334 ms
- Average gas used: 72416

## Scenario distribution (this invocation)

| Scenario | Planned |
| --- | ---: |
| happy_path | 1 |
| pre_simulation_rejection | 1 |
| transient_error | 1 |
| gas_adjustment_retry | 1 |
| policy_blocked_unsafe | 1 |

## Outcomes by scenario:status

- happy_path:skipped: 1
- pre_simulation_rejection:policy_blocked: 1
- transient_error:fixture_recovered: 1
- gas_adjustment_retry:fixture_recovered: 1
- policy_blocked_unsafe:policy_blocked: 1

Target confirmed executions: 50
Actual confirmed in store: 2
Fixture recovery demonstrations: 46
Quarantined evidence rows: 8
NOTE: fixture mode used synthetic recovery rows for non-live modes. Replace with explicit --live KeeperHub runs before submission.