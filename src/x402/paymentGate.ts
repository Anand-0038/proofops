/**
 * x402 decision (Prompt 8): SKIP for MVP — documented rationale.
 *
 * Genuine one-shot paid-call use case exists in theory: a third-party protocol
 * team paying USDC to trigger one verified incident-response run (detect→policy→
 * simulate→execute→evidence). That is a real unit of value.
 *
 * However, shipping x402 before we have (a) a listed KeeperHub marketplace
 * workflow with a stable slug, (b) agentic-wallet autopay wired, and (c) ≥20
 * live confirmed executions would be decorative surface-counting instead of a
 * coherent, reliable execution path.
 *
 * Load-bearing surfaces for this submission:
 * 1. MCP / REST direct execution
 * 2. simulate-before-submit
 * 3. retry + gas adaptation + idempotency
 * 4. get_execution audit trail → evidence dashboard
 *
 * MPP: not needed — no sustained high-frequency session billing.
 *
 * Revisit x402 in Phase 2 once live reliability numbers exist; scaffold below
 * is intentionally a no-op gate that refuses to weaken PolicyEngine.
 */

export interface PaymentGateResult {
  allowed: boolean;
  reason: string;
  paymentRef?: string;
}

export async function requirePaymentForRun(_opts?: {
  priceUsdc?: string;
}): Promise<PaymentGateResult> {
  return {
    allowed: false,
    reason:
      "x402 payment gate disabled by product decision — see docs/keeperhub.md. PolicyEngine remains authoritative; payment never bypasses policy.",
  };
}
