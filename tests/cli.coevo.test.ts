import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";

describe("coevo CLI", () => {
  it("coevo --mock writes failure cases and an ablation report", async () => {
    const out = mkdtempSync(join(tmpdir(), "coevo-"));
    await runCli(["coevo", "--mock", "--out", out]);
    expect(existsSync(join(out, "failure_cases.jsonl"))).toBe(true);
    expect(existsSync(join(out, "ablation.md"))).toBe(true);
  });
});
