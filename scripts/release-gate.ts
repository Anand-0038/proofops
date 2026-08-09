#!/usr/bin/env tsx
import { config as loadDotenv } from "dotenv";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { EvidenceStore } from "../src/evidence/EvidenceRecord.js";
import {
  evaluateReleaseFacts,
  evaluateSubmissionReadiness,
  findPublicDocProblems,
  type ReleaseFacts,
  type PublicDocProblems,
} from "../src/release/readiness.js";

loadDotenv();

const localMode = process.argv.includes("--local");
const jsonMode = process.argv.includes("--json");
const submissionOnlyMode = process.argv.includes("--submission-only");

if (submissionOnlyMode && localMode) {
  console.log(
    "[release-gate] ignoring --local because --submission-only performs only external submission checks",
  );
}

const requiredFiles = [
  "README.md",
  "DEPLOYMENTS.md",
  "Dockerfile",
  ".dockerignore",
  ".env.example",
  ".github/workflows/ci.yml",
  "app/dashboard/index.html",
  "app/dashboard/assets/logo.svg",
  "app/dashboard/assets/og-image.svg",
  "contracts/script/DeployActionLog.s.sol",
  "docs/architecture.md",
  "docs/api.md",
  "docs/evidence/verified-live-receipts.json",
  "docs/judge-guide.md",
  "docs/live-runbook.md",
  "docs/release-checklist.md",
  "docs/reliability-report.md",
  "docs/security.md",
  "keeperhub-first-reliable-tx/README.md",
  "src/agent/PolicyEngine.ts",
  "src/demo/server.ts",
  "src/evidence/integrity.ts",
  "src/keeperhub/execution.ts",
  "src/observe/blockscoutMcp.ts",
  "tests/browser/proofops.spec.py",
  "tests/blockscoutMcp.test.ts",
];

function trackedTextFiles(): Map<string, string> {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "buffer",
    },
  );
  if (listed.status !== 0) return new Map();
  const textExtensions =
    /\.(?:ts|tsx|js|mjs|cjs|json|md|yml|yaml|toml|sol|sh|env|txt)$/;
  const candidateFiles = listed.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(
      (path) =>
        textExtensions.test(path) ||
        ["Dockerfile", ".dockerignore", ".gitignore"].includes(path),
    );

  const missingTextFiles = candidateFiles.filter((path) => !existsSync(path));
  if (missingTextFiles.length > 0) {
    console.log(
      `[release-gate] tracked text files deleted from working tree: ${missingTextFiles.join(", ")}`,
    );
  }

  const readableFiles = candidateFiles.filter((path) => existsSync(path));
  return new Map(
    readableFiles.map((path) => [path, readFileSync(path, "utf8")] as const),
  );
}

function run(
  command: string,
  args: string[],
): { ok: boolean; detail: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 180_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .trim()
    .split("\n")
    .filter(Boolean);
  const detail =
    result.status === 0
      ? "passed"
      : output.slice(-3).join(" · ").slice(0, 500) ||
        `exited ${result.status ?? "without status"}`;
  return { ok: result.status === 0, detail };
}

function internalLinkExists(source: string, target: string): boolean {
  const withoutQuery = target.split("?")[0]!;
  const targetPath = withoutQuery.startsWith("/")
    ? resolve(process.cwd(), `.${withoutQuery}`)
    : resolve(process.cwd(), dirname(source), withoutQuery);
  return existsSync(targetPath);
}

const runLocalChecks = !submissionOnlyMode;
const commandDetails: Record<string, string> = {
  typecheck: "skipped",
  unit: "skipped",
  contracts: "skipped",
  browser: "skipped",
  proof: "skipped",
  dependencyAudit: "skipped",
};

let typecheck = { ok: true, detail: "skipped in submission-only mode" };
let unit = { ok: true, detail: "skipped in submission-only mode" };
let contracts = { ok: true, detail: "skipped in submission-only mode" };
let browser = { ok: true, detail: "skipped in submission-only mode" };
let proof = { ok: true, detail: "skipped in submission-only mode" };
let publicEvidence = { ok: true, detail: "skipped in submission-only mode" };
let dependencyAudit = {
  ok: true,
  detail: "skipped in submission-only mode",
};
let files = new Map<string, string>();
let docProblems: PublicDocProblems = {
  secrets: [],
  localSigning: [],
  markers: [],
  brokenLinks: [],
};

if (runLocalChecks) {
  console.log("ProofOps release gate: collecting authoritative local evidence…");
  typecheck = run("corepack", ["pnpm", "run", "typecheck"]);
  commandDetails.typecheck = typecheck.detail;
  unit = run("corepack", ["pnpm", "run", "test"]);
  commandDetails.unit = unit.detail;
  contracts = run("corepack", ["pnpm", "run", "test:contracts"]);
  commandDetails.contracts = contracts.detail;
  browser = run("corepack", ["pnpm", "run", "test:browser"]);
  commandDetails.browser = browser.detail;
  proof = run("corepack", ["pnpm", "run", "verify:proof"]);
  commandDetails.proof = proof.detail;
  publicEvidence = run("corepack", ["pnpm", "run", "verify:public-evidence"]);
  commandDetails.publicEvidence = publicEvidence.detail;
  dependencyAudit = run("corepack", ["pnpm", "run", "audit:verify"]);
  commandDetails.dependencyAudit = dependencyAudit.detail;

  files = trackedTextFiles();
  docProblems = findPublicDocProblems(files, internalLinkExists);
}

const evidencePath =
  process.env.EVIDENCE_STORE_PATH ?? "data/evidence.jsonl";
const evidenceRead = new EvidenceStore(evidencePath).readAll();
const screenshotDir = "docs/assets/screenshots";
const screenshots = existsSync(screenshotDir)
  ? readdirSync(screenshotDir).filter((name) => name.endsWith(".png"))
  : [];
const apiKey = process.env.KEEPERHUB_API_KEY ?? "";

const facts: ReleaseFacts = {
  requiredFilesMissing: requiredFiles.filter((path) => !existsSync(path)),
  typecheckPassed: typecheck.ok,
  unitTestsPassed: unit.ok,
  contractTestsPassed: contracts.ok,
  browserTestsPassed: browser.ok,
  proofVerified: proof.ok,
  publicEvidencePassed: publicEvidence.ok,
  dependencyAuditPassed: dependencyAudit.ok,
  secretFindings: docProblems.secrets,
  localSigningFindings: docProblems.localSigning,
  publicDocProblems: docProblems.markers,
  brokenInternalLinks: docProblems.brokenLinks,
  screenshots,
  liveApiKeyConfigured:
    apiKey.startsWith("kh_") &&
    !apiKey.toLowerCase().includes("your") &&
    apiKey.length >= 8,
  evidenceRecords: evidenceRead.records,
  repositoryUrl: process.env.PUBLIC_REPOSITORY_URL ?? "",
  demoVideoUrl: process.env.DEMO_VIDEO_URL ?? "",
  publicDemoUrl: process.env.PUBLIC_DEMO_URL ?? "",
};

const submissionReadiness = evaluateSubmissionReadiness({
  liveApiKeyConfigured: facts.liveApiKeyConfigured,
  evidenceRecords: facts.evidenceRecords,
  repositoryUrl: facts.repositoryUrl,
  demoVideoUrl: facts.demoVideoUrl,
  publicDemoUrl: facts.publicDemoUrl,
});

const readiness = runLocalChecks
  ? evaluateReleaseFacts(facts)
  : {
      localComplete: false,
      localChecks: [],
      verifiedLiveEvidenceCount: submissionReadiness.verifiedLiveEvidenceCount,
      submissionChecks: submissionReadiness.submissionChecks,
      submissionComplete: submissionReadiness.submissionComplete,
    };

if (submissionOnlyMode) {
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          submissionComplete: submissionReadiness.submissionComplete,
          verifiedLiveEvidenceCount: submissionReadiness.verifiedLiveEvidenceCount,
          submissionChecks: submissionReadiness.submissionChecks,
          commandDetails,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("\nSUBMISSION COMPLETENESS (external gates only)");
    for (const entry of submissionReadiness.submissionChecks) {
      console.log(
        `${entry.ok ? "PASS" : "WAIT"} ${entry.id.padEnd(28)} ${entry.detail}`,
      );
    }
    console.log(
      `\nSubmission: ${
        submissionReadiness.submissionComplete
          ? "COMPLETE"
          : "WAITING ON EXTERNAL GATES"
      }`,
    );
  }
} else if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        ...readiness,
        evidenceReadIssues: evidenceRead.issues.length,
        commandDetails: {
          typecheck: typecheck.detail,
          unit: unit.detail,
          contracts: contracts.detail,
          browser: browser.detail,
          proof: proof.detail,
          dependencyAudit: dependencyAudit.detail,
        },
      },
      null,
      2,
    ),
  );
} else {
  console.log("\nLOCAL COMPLETENESS");
  for (const entry of readiness.localChecks) {
    console.log(
      `${entry.ok ? "PASS" : "FAIL"} ${entry.id.padEnd(28)} ${entry.detail}`,
    );
  }
  console.log("\nSUBMISSION COMPLETENESS");
  for (const entry of readiness.submissionChecks) {
    console.log(
      `${entry.ok ? "PASS" : "WAIT"} ${entry.id.padEnd(28)} ${entry.detail}`,
    );
  }
  console.log(
    `\nLocal: ${readiness.localComplete ? "COMPLETE" : "INCOMPLETE"} · Submission: ${
      readiness.submissionComplete ? "COMPLETE" : "WAITING ON EXTERNAL GATES"
    }`,
  );
  if (evidenceRead.issues.length > 0) {
    console.log(
      `${evidenceRead.issues.length} malformed legacy evidence row(s) remain quarantined and excluded.`,
    );
  }
}

if (submissionOnlyMode) {
  process.exitCode = submissionReadiness.submissionComplete ? 0 : 1;
} else {
  process.exitCode = localMode
    ? readiness.localComplete
      ? 0
      : 1
    : readiness.submissionComplete
      ? 0
      : 1;
}
