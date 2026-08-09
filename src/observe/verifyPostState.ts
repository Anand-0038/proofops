import type { ObservedState } from "./ReadLayer.js";
import type { ProposedAction } from "../agent/PolicyEngine.js";

export interface PostStateVerification {
  ok: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  summary: string;
}

/**
 * Verify on-chain post-state matches the intent of the executed action.
 * Pure comparison — no writes.
 */
export function verifyPostState(
  pre: ObservedState,
  post: ObservedState,
  action: ProposedAction,
): PostStateVerification {
  const checks: PostStateVerification["checks"] = [];

  if (action.functionName === "pause") {
    const passed = post.paused === true;
    checks.push({
      name: "paused",
      passed,
      detail: passed
        ? "Contract is paused after pause()"
        : `Expected paused=true, got ${String(post.paused)}`,
    });
  }

  if (action.functionName === "unpause") {
    const passed = post.paused === false;
    checks.push({
      name: "unpaused",
      passed,
      detail: passed
        ? "Contract is unpaused"
        : `Expected paused=false, got ${String(post.paused)}`,
    });
  }

  if (action.functionName === "setHeartbeat") {
    const expected = action.args?.[0] !== undefined ? Number(action.args[0]) : undefined;
    const passed =
      expected === undefined
        ? (post.lastUpdated ?? 0) > (pre.lastUpdated ?? 0)
        : post.heartbeatSeconds === expected;
    checks.push({
      name: "heartbeat",
      passed,
      detail: passed
        ? `Heartbeat/update verified (hb=${post.heartbeatSeconds}, lastUpdated=${post.lastUpdated})`
        : `Heartbeat mismatch: expected ${expected ?? "fresher lastUpdated"}, got hb=${post.heartbeatSeconds} lastUpdated=${post.lastUpdated}`,
    });
  }

  if (action.functionName === "setMaxDeviationBps") {
    const expected = action.args?.[0] !== undefined ? Number(action.args[0]) : undefined;
    const passed =
      expected === undefined
        ? post.maxDeviationBps !== pre.maxDeviationBps
        : post.maxDeviationBps === expected;
    checks.push({
      name: "maxDeviationBps",
      passed,
      detail: passed
        ? `maxDeviationBps=${post.maxDeviationBps}`
        : `Expected ${expected}, got ${post.maxDeviationBps}`,
    });
  }

  if (!checks.length) {
    checks.push({
      name: "generic",
      passed: true,
      detail: `No specific verifier for ${action.functionName}; recorded post-state only`,
    });
  }

  const ok = checks.every((c) => c.passed);
  return {
    ok,
    checks,
    summary: ok
      ? `Post-state verified for ${action.functionName}`
      : `Post-state verification FAILED: ${checks
          .filter((c) => !c.passed)
          .map((c) => c.detail)
          .join("; ")}`,
  };
}
