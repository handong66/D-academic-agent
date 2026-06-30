import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";

describe("M2 CLI", () => {
  it("eval --mock writes trace; replay summarizes; plan --mock and drill run", async () => {
    const out = mkdtempSync(join(tmpdir(), "m2-"));
    await runCli(["eval", "--mock", "--out", out]);
    await runCli(["replay", "--trace", join(out, "trace.jsonl")]);
    await runCli(["plan", "--mock", "--q", "social media adolescent depression"]);
    await runCli(["drill", "--out", join(out, "drill")]);
    expect(existsSync(join(out, "trace.jsonl"))).toBe(true);
    expect(existsSync(join(out, "drill", "report.md"))).toBe(true); // drill ran its own eval
  });
});
