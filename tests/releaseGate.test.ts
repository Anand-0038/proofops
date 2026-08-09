import { describe, expect, it } from "vitest";
import {
  evaluateReleaseFacts,
  findPublicDocProblems,
  validateSubmissionEvidence,
  type ReleaseFacts,
} from "../src/release/readiness.js";

const HASH = `0x${"1234abcd".repeat(8)}`;

function localReadyFacts(): ReleaseFacts {
  return {
    requiredFilesMissing: [],
    typecheckPassed: true,
    unitTestsPassed: true,
    contractTestsPassed: true,
    browserTestsPassed: true,
    proofVerified: true,
    dependencyAuditPassed: true,
    secretFindings: [],
    localSigningFindings: [],
    publicDocProblems: [],
    brokenInternalLinks: [],
    screenshots: [
      "proofops-incident-context.png",
      "proofops-simulation-block.png",
      "proofops-retry-recovery.png",
      "proofops-proof-receipt.png",
    ],
    liveApiKeyConfigured: false,
    evidenceRecords: [],
    repositoryUrl: "",
    demoVideoUrl: "",
    publicDemoUrl: "",
  };
}

function verifiedEvidence() {
  return {
    evidenceMode: "live",
    status: "confirmed",
    txHash: HASH,
    keeperhubExecutionId: "direct_real_123",
    explorerUrl: `https://sepolia.etherscan.io/tx/${HASH}`,
    keeperhubAuditReference:
      "https://app.keeperhub.com/api/execute/direct_real_123/status",
  };
}

describe("release readiness gate", () => {
  it("separates local completeness from externally gated submission completeness", () => {
    const result = evaluateReleaseFacts(localReadyFacts());

    expect(result.localComplete).toBe(true);
    expect(result.submissionComplete).toBe(false);
    expect(
      result.submissionChecks.filter((check) => !check.ok).map((check) => check.id),
    ).toEqual([
      "live_api_key",
      "verified_live_execution",
      "public_repository",
      "demo_video",
      "public_demo",
    ]);
  });

  it("rejects synthetic hashes, fixture IDs, non-HTTPS links, and fake hosts", () => {
    const candidates = [
      {
        ...verifiedEvidence(),
        txHash: `0x${"a".repeat(64)}`,
      },
      {
        ...verifiedEvidence(),
        evidenceMode: "fixture",
      },
      {
        ...verifiedEvidence(),
        keeperhubExecutionId: "dry_fixture_1",
      },
      {
        ...verifiedEvidence(),
        explorerUrl: `http://localhost/tx/${HASH}`,
      },
      {
        ...verifiedEvidence(),
        keeperhubAuditReference:
          "https://example.com/api/execute/direct_real_123/status",
      },
    ];

    for (const candidate of candidates) {
      expect(validateSubmissionEvidence(candidate).ok).toBe(false);
    }
  });

  it("requires a complete KeeperHub receipt and all public submission URLs", () => {
    const facts = {
      ...localReadyFacts(),
      liveApiKeyConfigured: true,
      evidenceRecords: [verifiedEvidence()],
      repositoryUrl: "https://github.com/proofops/incident-flight-recorder",
      demoVideoUrl: "https://www.youtube.com/watch?v=proofops-demo",
      publicDemoUrl: "https://proofops.vercel.app",
    };

    const result = evaluateReleaseFacts(facts);

    expect(result.localComplete).toBe(true);
    expect(result.submissionComplete).toBe(true);
    expect(result.verifiedLiveEvidenceCount).toBe(1);
  });

  it("blocks secrets, local signing, placeholders, broken links, and stale claims", () => {
    const credentialShapedValue =
      "kh_" + "A9z8Y7x6W5v4U3t2S1r0Q9p8O7n6M5";
    const files = new Map([
      ["README.md", "Ship it soon. TODO. Private until 27 Jul 2026. [bad](missing.md)"],
      ["src/agent/unsafe.ts", 'import { privateKeyToAccount } from "viem/accounts";'],
      ["docs/key.md", `Bearer ${credentialShapedValue}`],
    ]);
    const problems = findPublicDocProblems(files, () => false);
    const result = evaluateReleaseFacts({
      ...localReadyFacts(),
      secretFindings: problems.secrets,
      localSigningFindings: problems.localSigning,
      publicDocProblems: problems.markers,
      brokenInternalLinks: problems.brokenLinks,
    });

    expect(problems.secrets).not.toHaveLength(0);
    expect(problems.localSigning).not.toHaveLength(0);
    expect(problems.markers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("TODO"),
        expect.stringContaining("Private until 27 Jul 2026"),
      ]),
    );
    expect(problems.brokenLinks).not.toHaveLength(0);
    expect(result.localComplete).toBe(false);
  });

  it("requires the complete deterministic screenshot proof set", () => {
    const facts = localReadyFacts();
    facts.screenshots = ["proofops-incident-context.png"];

    const result = evaluateReleaseFacts(facts);

    expect(
      result.localChecks.find((check) => check.id === "browser_screenshots"),
    ).toMatchObject({ ok: false });
    expect(result.localComplete).toBe(false);
  });
});
