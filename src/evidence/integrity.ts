import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import {
  formatEvidenceMarkdown,
  isVerifiedLiveExecution,
  type EvidenceReadIssue,
  type EvidenceRecord,
} from "./EvidenceRecord.js";
import {
  aggregateEvidence,
  formatMetricsMarkdown,
} from "./aggregate.js";

export interface ProofBundleInput {
  outDir: string;
  records: EvidenceRecord[];
  evidenceIssues: EvidenceReadIssue[];
  exportedAt?: string;
  agentVersion: string;
  policyVersion: string;
  chainId: number;
  network: string;
}

export interface ProofBundle {
  schemaVersion: "proofops.bundle.v1";
  exportedAt: string;
  agentVersion: string;
  policyVersion: string;
  chainId: number;
  network: string;
  readiness: {
    localEvidencePresent: boolean;
    verifiedLiveExecutions: number;
    submissionProofComplete: boolean;
  };
  metrics: ReturnType<typeof aggregateEvidence>;
  evidenceIssues: EvidenceReadIssue[];
  runs: EvidenceRecord[];
  note: string;
}

export interface ProofManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ProofManifest {
  schemaVersion: "proofops.bundle.v1";
  generatedAt: string;
  recordCount: number;
  verifiedLiveExecutions: number;
  evidenceModes: {
    fixture: number;
    live: number;
    mixed: number;
  };
  files: ProofManifestFile[];
}

export interface ProofVerification {
  ok: boolean;
  checkedFiles: number;
  manifestSha256?: string;
  issues: string[];
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileMetadata(root: string, path: string): ProofManifestFile {
  const absolute = join(root, path);
  return {
    path,
    bytes: statSync(absolute).size,
    sha256: sha256Bytes(readFileSync(absolute)),
  };
}

function markdownForBundle(bundle: ProofBundle): string {
  return [
    "# ProofOps incident proof bundle",
    "",
    `Exported: ${bundle.exportedAt}`,
    `Evidence modes: fixture=${bundle.metrics.evidenceModes.fixture}, live=${bundle.metrics.evidenceModes.live}, mixed=${bundle.metrics.evidenceModes.mixed}`,
    `Verified live KeeperHub executions: ${bundle.readiness.verifiedLiveExecutions}`,
    "",
    bundle.readiness.submissionProofComplete
      ? "**Submission proof gate:** satisfied by verified live execution evidence."
      : "**Submission proof gate:** not satisfied; fixture/local evidence does not replace a live KeeperHub transaction.",
    "",
    formatMetricsMarkdown(bundle.metrics),
    "",
    `## Evidence read issues (${bundle.evidenceIssues.length})`,
    "",
    ...(bundle.evidenceIssues.length
      ? bundle.evidenceIssues.map(
          (issue) =>
            `- line ${issue.line} [${issue.code}]: ${issue.message}`,
        )
      : ["- None"]),
    "",
    `## Runs (${bundle.runs.length})`,
    "",
    ...bundle.runs.map(
      (record) => `${formatEvidenceMarkdown(record)}\n\n---\n`,
    ),
  ].join("\n");
}

export function writeProofBundle(input: ProofBundleInput): {
  bundle: ProofBundle;
  manifest: ProofManifest;
  verification: ProofVerification;
} {
  mkdirSync(input.outDir, { recursive: true });
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const metrics = aggregateEvidence(input.records);
  const verifiedLiveExecutions = input.records.filter(
    isVerifiedLiveExecution,
  ).length;
  const bundle: ProofBundle = {
    schemaVersion: "proofops.bundle.v1",
    exportedAt,
    agentVersion: input.agentVersion,
    policyVersion: input.policyVersion,
    chainId: input.chainId,
    network: input.network,
    readiness: {
      localEvidencePresent: input.records.length > 0,
      verifiedLiveExecutions,
      submissionProofComplete: verifiedLiveExecutions > 0,
    },
    metrics,
    evidenceIssues: input.evidenceIssues,
    runs: input.records,
    note:
      "KeeperHub status responses and transaction links are authoritative. Fixture evidence is excluded from live proof totals.",
  };

  writeFileSync(
    join(input.outDir, "proof-bundle.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(input.outDir, "proof-bundle.md"),
    `${markdownForBundle(bundle)}\n`,
    "utf8",
  );

  const manifest: ProofManifest = {
    schemaVersion: "proofops.bundle.v1",
    generatedAt: exportedAt,
    recordCount: input.records.length,
    verifiedLiveExecutions,
    evidenceModes: metrics.evidenceModes,
    files: ["proof-bundle.json", "proof-bundle.md"].map((path) =>
      fileMetadata(input.outDir, path),
    ),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(input.outDir, "manifest.json"), manifestText, "utf8");

  const verification: ProofVerification = {
    ok: true,
    checkedFiles: manifest.files.length,
    manifestSha256: sha256Bytes(manifestText),
    issues: [],
  };
  writeFileSync(
    join(input.outDir, "verification.json"),
    `${JSON.stringify(verification, null, 2)}\n`,
    "utf8",
  );

  return { bundle, manifest, verification };
}

function safeManifestPath(root: string, path: string): string | null {
  if (basename(path) !== path) return null;
  const absolute = resolve(root, path);
  const resolvedRoot = resolve(root);
  return absolute.startsWith(`${resolvedRoot}/`) ? absolute : null;
}

export function verifyProofBundle(outDir: string): ProofVerification {
  const issues: string[] = [];
  let manifest: ProofManifest;
  let manifestText: string;
  try {
    manifestText = readFileSync(join(outDir, "manifest.json"), "utf8");
    manifest = JSON.parse(manifestText) as ProofManifest;
  } catch (error) {
    return {
      ok: false,
      checkedFiles: 0,
      issues: [
        `Manifest unreadable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  let checkedFiles = 0;
  for (const file of manifest.files ?? []) {
    const absolute = safeManifestPath(outDir, file.path);
    if (!absolute) {
      issues.push(`Unsafe manifest path: ${file.path}`);
      continue;
    }
    try {
      const bytes = readFileSync(absolute);
      checkedFiles += 1;
      if (bytes.byteLength !== file.bytes) {
        issues.push(
          `Byte-size mismatch for ${file.path}: expected ${file.bytes}, got ${bytes.byteLength}`,
        );
      }
      const digest = sha256Bytes(bytes);
      if (digest !== file.sha256) {
        issues.push(
          `Digest mismatch for ${file.path}: expected ${file.sha256}, got ${digest}`,
        );
      }
    } catch (error) {
      issues.push(
        `File unreadable ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    ok: issues.length === 0,
    checkedFiles,
    manifestSha256: sha256Bytes(manifestText),
    issues,
  };
}
