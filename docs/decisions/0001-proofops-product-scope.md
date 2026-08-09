# Decision 0001: ProofOps product scope

**Date:** 2026-07-30  
**Status:** Accepted

## Context

The KeeperHub hackathon rewards real onchain execution, deep use of KeeperHub,
reliability evidence, originality, and integration quality. A generic alert bot
or automation dashboard would not demonstrate why KeeperHub is indispensable.

The existing repository already contains a useful deterministic policy engine,
typed incident runbooks, KeeperHub integration, Solidity fixtures, and an
evidence trail. Its strongest opportunity is to make execution safety and
recovery visible and verifiable.

## Decision

Build **ProofOps**, a bounded DeFi incident responder with an **Incident Flight
Recorder**.

The golden path is:

```text
observe → classify drift → select typed runbook → deterministic policy
→ human approval when required → KeeperHub simulate/conditional recheck
→ KeeperHub execute → reconcile → verify post-state → export and anchor proof
```

KeeperHub is the only execution authority for judged state changes, including
the final `ActionLog` proof attestation. The product will emphasize:

- current KeeperHub API semantics and managed execution;
- deterministic bounded authority;
- identical-intent simulation before execution;
- idempotent retry and authoritative reconciliation;
- explicit fixture/live trust labels;
- proof-bundle integrity;
- a judge-readable execution rail;
- a separate first-reliable-transaction onboarding artifact.

Payment rails, generic agent frameworks, multi-agent systems, and broad workflow
builders remain out of scope until the core incident proof is complete.

## Consequences

- Reliability and evidence work precede visual polish.
- Human approval is a separate input and never changes incident severity.
- Synthetic scenario data can demonstrate UI states but cannot create explorer
  links or count toward live execution totals.
- The local package can be complete without credentials, but the submission
  remains blocked until a real KeeperHub transaction, public repository, and
  demo video are verified.

## References

- [`architecture.md`](../architecture.md)
- [`judge-guide.md`](../judge-guide.md)
- [`reliability.md`](../reliability.md)
