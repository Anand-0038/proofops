import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyEvidence } from "../src/evidence/EvidenceRecord.js";
import {
  verifyProofBundle,
  writeProofBundle,
} from "../src/evidence/integrity.js";

describe("proof bundle integrity", () => {
  it("writes a manifest with file digests and verifies cleanly", () => {
    const outDir = mkdtempSync(join(tmpdir(), "proof-"));
    const record = createEmptyEvidence({
      runId: "fixture-1",
      workflowId: "wf",
      workflowVersion: "1",
      triggerType: "scenario",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    record.status = "fixture_recovered";

    const written = writeProofBundle({
      outDir,
      records: [record],
      evidenceIssues: [],
      exportedAt: "2026-07-30T00:00:00.000Z",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });

    expect(written.manifest).toMatchObject({
      schemaVersion: "proofops.bundle.v1",
      recordCount: 1,
      evidenceModes: { fixture: 1, live: 0, mixed: 0 },
    });
    expect(written.manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "proof-bundle.json",
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          path: "proof-bundle.md",
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
    expect(verifyProofBundle(outDir)).toMatchObject({
      ok: true,
      checkedFiles: 2,
      issues: [],
    });
    expect(
      JSON.parse(readFileSync(join(outDir, "verification.json"), "utf8")),
    ).toMatchObject({ ok: true });
  });

  it("detects a one-byte mutation", () => {
    const outDir = mkdtempSync(join(tmpdir(), "proof-"));
    writeProofBundle({
      outDir,
      records: [],
      evidenceIssues: [],
      exportedAt: "2026-07-30T00:00:00.000Z",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });
    appendFileSync(join(outDir, "proof-bundle.json"), " ", "utf8");

    const result = verifyProofBundle(outDir);

    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toMatch(/digest mismatch/i);
  });

  it("keeps an empty bundle honest about missing live proof", () => {
    const outDir = mkdtempSync(join(tmpdir(), "proof-"));
    const written = writeProofBundle({
      outDir,
      records: [],
      evidenceIssues: [{ line: 1, code: "malformed_json", message: "bad row" }],
      exportedAt: "2026-07-30T00:00:00.000Z",
      agentVersion: "0.1.0",
      policyVersion: "0.1.0",
      chainId: 11155111,
      network: "sepolia",
    });

    expect(written.bundle.readiness).toEqual({
      localEvidencePresent: false,
      verifiedLiveExecutions: 0,
      submissionProofComplete: false,
    });
    expect(written.bundle.evidenceIssues).toHaveLength(1);
  });
});
