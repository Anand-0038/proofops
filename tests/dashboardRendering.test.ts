import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const html = read("app/dashboard/index.html");
const script = read("app/dashboard/assets/app.js");
const styles = read("app/dashboard/assets/styles.css");
const reportGenerator = read("scripts/generate-report.ts");

describe("ProofOps Incident Flight Recorder shell", () => {
  it("renders API-derived content without HTML injection sinks", () => {
    expect(script).not.toMatch(
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/,
    );
    expect(script).toMatch(/\btextContent\b/);
    expect(script).toMatch(/\bdocument\.createElement\b/);
  });

  it("creates external anchors only for verified live HTTPS evidence", () => {
    expect(script).toContain('record.evidenceMode !== "fixture"');
    expect(script).toMatch(/url\.protocol === "https:"/);
    expect(script).toMatch(/\^0x\[a-fA-F0-9\]\{64\}\$/);
    expect(script).toContain('anchor.rel = "noreferrer noopener"');
  });

  it("exposes the complete eight-stage flight recorder as keyboard controls", () => {
    const stages = [
      "observe",
      "policy",
      "approval",
      "simulate",
      "execute",
      "reconcile",
      "verify",
      "anchor",
    ];
    const stageButtons = [
      ...html.matchAll(
        /<button[^>]+class="rail-stage"[^>]+data-stage="([^"]+)"/g,
      ),
    ].map((match) => match[1]);

    expect(stageButtons).toEqual(stages);
    expect(html).toContain('aria-controls="stage-detail"');
    expect(html).toContain('id="stage-detail"');
  });

  it("keeps local product status separate from release submission gates", () => {
    expect(html).toContain("LOCAL READY");
    expect(html).not.toContain("SUBMISSION READY");
    expect(html).not.toContain("submission-ready-label");
    expect(html).toContain("FIXTURE");
    expect(html).toContain("MIXED");
    expect(html).toContain("LIVE");
    expect(html).toContain("A fixture is a rehearsal, never a transaction.");
    expect(script).toContain(
      "A live receipt is bound to a real execution and verified post-state.",
    );
    expect(script).toContain("A live observation is not automatically a transaction.");
    expect(styles).toMatch(/\.trust-badge\[data-mode="fixture"\]/);
    expect(styles).toMatch(/\.trust-badge\[data-mode="live"\]/);
  });

  it("includes loading, empty, recoverable error, and responsive states", () => {
    expect(html).toContain('id="loading-state"');
    expect(html).toContain('id="empty-state"');
    expect(html).toContain('id="error-state"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="retry-load"');
    expect(styles).toMatch(/@media\s*\(max-width:\s*760px\)/);
    expect(styles).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    );
    expect(styles).not.toContain("transition: all");
  });

  it("gives judges shortcuts and progressively discloses the evidence index", () => {
    expect(html).toContain('id="inspect-live-proof"');
    expect(html).toContain('id="inspect-safety-proof"');
    expect(html).toContain('id="inspect-recovery-proof"');
    expect(html).toContain('id="evidence-search"');
    expect(html).toContain('id="evidence-trust-filter"');
    expect(html).toContain('id="evidence-outcome-filter"');
    expect(html).toContain('id="show-more-evidence"');
    expect(script).toContain("const EVIDENCE_PAGE_SIZE = 12");
    expect(script).toContain("records.slice(0, state.evidenceLimit)");
    expect(styles).toMatch(/\.judge-route\s*{/);
    expect(styles).toMatch(/tbody tr\[data-selected="true"\]/);
  });

  it("uses the generated forensic visual as a stable, local asset", () => {
    expect(html).toContain(
      'src="/assets/proofops-flight-recorder.webp"',
    );
    expect(html).toContain('width="1672"');
    expect(html).toContain('height="941"');
    expect(html).not.toContain("fonts.googleapis.com");
  });
});

describe("archival report generation", () => {
  it("never overwrites the interactive application shell", () => {
    expect(reportGenerator).toContain(
      'join("data", "proof-bundle", "report.html")',
    );
    expect(reportGenerator).not.toMatch(
      /writeFileSync\(\s*["']app\/dashboard\/index\.html/,
    );
    expect(reportGenerator).toContain("escapeHtml");
  });
});
