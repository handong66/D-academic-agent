import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";

describe("runCli", () => {
  it("eval --mock writes a report offline", async () => {
    const out = mkdtempSync(join(tmpdir(), "cli-"));
    await runCli(["eval", "--mock", "--out", out]);
    expect(existsSync(join(out, "report.md"))).toBe(true);
  });
});
