export const REQUIRED_SCREENSHOTS = [
  "proofops-incident-context.png",
  "proofops-simulation-block.png",
  "proofops-retry-recovery.png",
  "proofops-proof-receipt.png",
] as const;

export interface ReleaseFacts {
  requiredFilesMissing: string[];
  typecheckPassed: boolean;
  unitTestsPassed: boolean;
  contractTestsPassed: boolean;
  browserTestsPassed: boolean;
  proofVerified: boolean;
  publicEvidencePassed: boolean;
  dependencyAuditPassed: boolean;
  secretFindings: string[];
  localSigningFindings: string[];
  publicDocProblems: string[];
  brokenInternalLinks: string[];
  screenshots: string[];
  liveApiKeyConfigured: boolean;
  evidenceRecords: unknown[];
  repositoryUrl: string;
  demoVideoUrl: string;
  publicDemoUrl: string;
}

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ReleaseReadiness {
  localComplete: boolean;
  submissionComplete: boolean;
  verifiedLiveEvidenceCount: number;
  localChecks: ReadinessCheck[];
  submissionChecks: ReadinessCheck[];
}

export interface SubmissionReadiness {
  submissionComplete: boolean;
  verifiedLiveEvidenceCount: number;
  submissionChecks: ReadinessCheck[];
}

export interface SubmissionReadinessFacts {
  liveApiKeyConfigured: boolean;
  evidenceRecords: unknown[];
  repositoryUrl: string;
  demoVideoUrl: string;
  publicDemoUrl: string;
}

export interface PublicDocProblems {
  secrets: string[];
  localSigning: string[];
  markers: string[];
  brokenLinks: string[];
}

interface SubmissionEvidence {
  evidenceMode?: unknown;
  status?: unknown;
  txHash?: unknown;
  keeperhubExecutionId?: unknown;
  explorerUrl?: unknown;
  keeperhubAuditReference?: unknown;
}

function check(
  id: string,
  ok: boolean,
  success: string,
  failure: string,
): ReadinessCheck {
  return { id, ok, detail: ok ? success : failure };
}

function publicHttpsUrl(
  value: string,
  allowedHosts?: (host: string) => boolean,
): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const reserved =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "example.com" ||
      host.endsWith(".example.com") ||
      host === "example.org" ||
      host.endsWith(".example.org") ||
      host.endsWith(".invalid");
    if (
      url.protocol !== "https:" ||
      reserved ||
      (allowedHosts && !allowedHosts(host))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function validateSubmissionEvidence(
  value: unknown,
): { ok: boolean; reason: string } {
  if (value === null || typeof value !== "object") {
    return { ok: false, reason: "record is not an object" };
  }
  const record = value as SubmissionEvidence;
  if (record.evidenceMode !== "live" && record.evidenceMode !== "mixed") {
    return { ok: false, reason: "evidence mode is not live or mixed" };
  }
  if (record.status !== "confirmed") {
    return { ok: false, reason: "status is not confirmed" };
  }
  if (
    typeof record.txHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(record.txHash)
  ) {
    return { ok: false, reason: "transaction hash is malformed" };
  }
  const payload = record.txHash.slice(2).toLowerCase();
  if (
    /^([a-f0-9])\1{63}$/.test(payload) ||
    /^(deadbeef){8}$/.test(payload)
  ) {
    return { ok: false, reason: "transaction hash is synthetic" };
  }
  if (
    typeof record.keeperhubExecutionId !== "string" ||
    record.keeperhubExecutionId.length < 6 ||
    /(?:^|[_-])(dry|fixture|mock|fake)(?:[_-]|$)/i.test(
      record.keeperhubExecutionId,
    )
  ) {
    return { ok: false, reason: "KeeperHub execution ID is missing or synthetic" };
  }
  if (typeof record.explorerUrl !== "string") {
    return { ok: false, reason: "explorer URL is missing" };
  }
  const explorer = publicHttpsUrl(record.explorerUrl);
  if (
    !explorer ||
    !explorer.pathname.toLowerCase().includes(record.txHash.toLowerCase())
  ) {
    return {
      ok: false,
      reason: "explorer URL is not public HTTPS or does not bind the tx hash",
    };
  }
  if (typeof record.keeperhubAuditReference !== "string") {
    return { ok: false, reason: "KeeperHub audit reference is missing" };
  }
  const audit = publicHttpsUrl(
    record.keeperhubAuditReference,
    (host) => host === "keeperhub.com" || host.endsWith(".keeperhub.com"),
  );
  if (
    !audit ||
    /(?:dry|fixture|mock|fake)/i.test(
      `${audit.pathname}${audit.search}`,
    )
  ) {
    return {
      ok: false,
      reason: "audit reference is not an authoritative KeeperHub HTTPS URL",
    };
  }
  return { ok: true, reason: "complete live KeeperHub receipt" };
}

function validRepositoryUrl(value: string): boolean {
  const url = publicHttpsUrl(value, (host) => host === "github.com");
  return Boolean(
    url &&
      url.pathname.split("/").filter(Boolean).length >= 2 &&
      !url.pathname.toLowerCase().includes("your-"),
  );
}

function validVideoUrl(value: string): boolean {
  return Boolean(
    publicHttpsUrl(value, (host) =>
      [
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "loom.com",
        "www.loom.com",
        "vimeo.com",
        "www.vimeo.com",
      ].includes(host),
    ),
  );
}

export function evaluateReleaseFacts(
  facts: ReleaseFacts,
): ReleaseReadiness {
  const screenshotSet = new Set(facts.screenshots);
  const screenshotsPresent = REQUIRED_SCREENSHOTS.every((name) =>
    screenshotSet.has(name),
  );
  const localChecks: ReadinessCheck[] = [
    check(
      "required_files",
      facts.requiredFilesMissing.length === 0,
      "all required files present",
      `missing: ${facts.requiredFilesMissing.join(", ")}`,
    ),
    check("typecheck", facts.typecheckPassed, "passed", "failed"),
    check("unit_tests", facts.unitTestsPassed, "passed", "failed"),
    check("contract_tests", facts.contractTestsPassed, "passed", "failed"),
    check("browser_tests", facts.browserTestsPassed, "passed", "failed"),
    check("proof_manifest", facts.proofVerified, "verified", "missing or invalid"),
    check(
      "public_live_evidence",
      facts.publicEvidencePassed,
      "sanitized KeeperHub receipts verified",
      "public receipt ledger is missing, invalid, or tampered",
    ),
    check(
      "dependency_audit",
      facts.dependencyAuditPassed,
      "no known production vulnerability",
      "production dependency audit failed",
    ),
    check(
      "secret_scan",
      facts.secretFindings.length === 0,
      "no credential-shaped literals",
      facts.secretFindings.join("; "),
    ),
    check(
      "keeperhub_only_execution",
      facts.localSigningFindings.length === 0,
      "no local signer in judged paths",
      facts.localSigningFindings.join("; "),
    ),
    check(
      "public_docs",
      facts.publicDocProblems.length === 0,
      "no placeholders or stale release claims",
      facts.publicDocProblems.join("; "),
    ),
    check(
      "internal_links",
      facts.brokenInternalLinks.length === 0,
      "all internal Markdown links resolve",
      facts.brokenInternalLinks.join("; "),
    ),
    check(
      "browser_screenshots",
      screenshotsPresent,
      `${REQUIRED_SCREENSHOTS.length} required screenshots present`,
      `requires: ${REQUIRED_SCREENSHOTS.filter((name) => !screenshotSet.has(name)).join(", ")}`,
    ),
  ];

  const submissionReadiness = evaluateSubmissionReadiness({
    liveApiKeyConfigured: facts.liveApiKeyConfigured,
    evidenceRecords: facts.evidenceRecords,
    repositoryUrl: facts.repositoryUrl,
    demoVideoUrl: facts.demoVideoUrl,
    publicDemoUrl: facts.publicDemoUrl,
  });

  const localComplete = localChecks.every((entry) => entry.ok);
  return {
    localComplete,
    submissionComplete:
      localComplete && submissionReadiness.submissionComplete,
    verifiedLiveEvidenceCount: submissionReadiness.verifiedLiveEvidenceCount,
    localChecks,
    submissionChecks: submissionReadiness.submissionChecks,
  };
}

export function evaluateSubmissionReadiness(
  facts: SubmissionReadinessFacts,
): SubmissionReadiness {
  const verifiedLiveEvidenceCount = facts.evidenceRecords.filter(
    (record) => validateSubmissionEvidence(record).ok,
  ).length;
  const submissionChecks: ReadinessCheck[] = [
    check(
      "live_api_key",
      facts.liveApiKeyConfigured,
      "configured without disclosure",
      "real kh_ organization key is not configured",
    ),
    check(
      "verified_live_execution",
      verifiedLiveEvidenceCount >= 1,
      `${verifiedLiveEvidenceCount} authoritative receipt(s)`,
      "need at least one confirmed KeeperHub execution with bound tx and audit URLs",
    ),
    check(
      "public_repository",
      validRepositoryUrl(facts.repositoryUrl),
      "valid public GitHub URL",
      "PUBLIC_REPOSITORY_URL is missing or invalid",
    ),
    check(
      "demo_video",
      validVideoUrl(facts.demoVideoUrl),
      "valid public video URL",
      "DEMO_VIDEO_URL is missing or invalid",
    ),
    check(
      "public_demo",
      Boolean(publicHttpsUrl(facts.publicDemoUrl)),
      "valid public HTTPS demo",
      "PUBLIC_DEMO_URL is missing or invalid",
    ),
  ];
  return {
    submissionComplete: submissionChecks.every((entry) => entry.ok),
    verifiedLiveEvidenceCount,
    submissionChecks,
  };
}

function looksLikeRealKeeperHubKey(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    /^kh_[a-zA-Z0-9_-]{24,}$/.test(value) &&
    !["your", "test", "fake", "example", "redacted", "do_not_leak"].some(
      (marker) => lower.includes(marker),
    )
  );
}

export function findPublicDocProblems(
  files: Map<string, string>,
  internalLinkExists: (source: string, target: string) => boolean,
): PublicDocProblems {
  const result: PublicDocProblems = {
    secrets: [],
    localSigning: [],
    markers: [],
    brokenLinks: [],
  };
  const markerPatterns = [
    /\bTODO\b/g,
    /\bTBD\b/g,
    /\bPLACEHOLDER\b/g,
    /Private until 27 Jul 2026/gi,
    /publish after 27 Jul/gi,
    /Code-complete for Phase 0/gi,
  ];
  const signerPatterns = [
    /\bprivateKeyToAccount\b/,
    /\bsignTransaction\b/,
    /\bmnemonicToAccount\b/,
    /from\s+["']viem\/accounts["']/,
  ];

  for (const [path, content] of files) {
    for (const candidate of content.match(/\bkh_[a-zA-Z0-9_-]{24,}\b/g) ?? []) {
      if (looksLikeRealKeeperHubKey(candidate)) {
        result.secrets.push(`${path}: credential-shaped KeeperHub key`);
      }
    }
    const privateKeyAssignment =
      /\b(?:PRIVATE_KEY|privateKey)\s*[:=]\s*["']?0x[a-fA-F0-9]{64}\b/.test(
        content,
      );
    if (privateKeyAssignment) {
      result.secrets.push(`${path}: literal private key assignment`);
    }

    const judgedPath =
      (path.startsWith("src/") ||
        path.startsWith("scripts/") ||
        path.startsWith("keeperhub-first-reliable-tx/")) &&
      path !== "scripts/deploy-oracle.ts" &&
      !path.endsWith(".md");
    if (
      judgedPath &&
      signerPatterns.some((pattern) => pattern.test(content))
    ) {
      result.localSigning.push(`${path}: local signing primitive`);
    }

    const publicDoc =
      path === "README.md" ||
      path === "DEPLOYMENTS.md" ||
      (path.startsWith("docs/") &&
        path.endsWith(".md") &&
        !path.startsWith("docs/superpowers/")) ||
      (path.startsWith("keeperhub-first-reliable-tx/") &&
        path.endsWith(".md"));
    if (!publicDoc) continue;
    for (const pattern of markerPatterns) {
      for (const match of content.match(pattern) ?? []) {
        result.markers.push(`${path}: ${match}`);
      }
    }
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1]!.trim().replace(/^<|>$/g, "");
      const target = rawTarget.split("#")[0]!;
      if (
        !target ||
        /^(?:https?:|mailto:|app:)/i.test(target) ||
        target.startsWith("#")
      ) {
        continue;
      }
      if (!internalLinkExists(path, target)) {
        result.brokenLinks.push(`${path} → ${rawTarget}`);
      }
    }
  }
  return result;
}
