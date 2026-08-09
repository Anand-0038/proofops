import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scenario runner execution authority", () => {
  it("defaults to fixture-only and requires an explicit live flag", () => {
    const source = readFileSync("scripts/run-scenarios.ts", "utf8");

    expect(source).toContain('process.argv.includes("--live")');
    expect(source).toMatch(/const DRY = !LIVE/);
    expect(source).toContain(
      "Fixture mode is the default; --live is required for KeeperHub execution.",
    );
  });
});
