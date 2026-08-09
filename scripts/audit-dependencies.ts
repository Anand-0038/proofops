#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const reportPath = "docs/dependency-audit.json";
const lockPath = "pnpm-lock.yaml";
const update = process.argv.includes("--update");

function lockDigest(): string {
  return createHash("sha256")
    .update(readFileSync(lockPath))
    .digest("hex");
}

interface AuditAttestation {
  schemaVersion: 2;
  lockfile: "pnpm-lock.yaml";
  lockfileSha256: string;
  productionOnly: true;
  auditLevel: "high";
  vulnerabilities: {
    info: number;
    low: number;
    moderate: number;
    high: number;
    critical: number;
    total: number;
  };
  generatedAt: string;
  command: string;
}

function verify(report: AuditAttestation): void {
  if (
    report.schemaVersion !== 2 ||
    report.lockfile !== lockPath ||
    report.lockfileSha256 !== lockDigest() ||
    report.productionOnly !== true ||
    report.vulnerabilities.high !== 0 ||
    report.vulnerabilities.critical !== 0
  ) {
    throw new Error(
      "Dependency audit attestation is missing, stale, or contains a high/critical production vulnerability. Run corepack pnpm run audit:dependencies.",
    );
  }
  console.log(
    `Dependency audit verified for current lockfile: ${report.vulnerabilities.total} total, 0 high, 0 critical.`,
  );
}

if (update) {
  const result = spawnSync(
    "corepack",
    ["pnpm", "audit", "--prod", "--audit-level=high", "--json"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  let parsed: {
    metadata?: {
      vulnerabilities?: Partial<AuditAttestation["vulnerabilities"]>;
    };
  };
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch {
    throw new Error(
      `corepack pnpm audit did not return JSON: ${result.stderr.trim().slice(0, 240)}`,
    );
  }
  const counts = parsed.metadata?.vulnerabilities ?? {};
  const report: AuditAttestation = {
    schemaVersion: 2,
    lockfile: lockPath,
    lockfileSha256: lockDigest(),
    productionOnly: true,
    auditLevel: "high",
    vulnerabilities: {
      info: counts.info ?? 0,
      low: counts.low ?? 0,
      moderate: counts.moderate ?? 0,
      high: counts.high ?? 0,
      critical: counts.critical ?? 0,
      total: counts.total ?? 0,
    },
    generatedAt: new Date().toISOString(),
    command: "corepack pnpm audit --prod --audit-level=high --json",
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  verify(report);
} else {
  if (!existsSync(reportPath)) {
    throw new Error(
      `Missing ${reportPath}. Run corepack pnpm run audit:dependencies while online.`,
    );
  }
  verify(
    JSON.parse(readFileSync(reportPath, "utf8")) as AuditAttestation,
  );
}
