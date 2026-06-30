import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadGoldClaims } from "../src/eval/gold.js";
import { writeFailureCases } from "../src/coevo/failure_cases.js";

describe("writeFailureCases", () => {
  it("writes one JSONL record per failure, joined to gold snippet/rationale by (claim,cited_source)", () => {
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    const g = gold[0]!;
    const failures = [{ claim: g.claim_text, gold: g.label, pred: "supports", cited_source: g.cited_source }];
    const out = mkdtempSync(join(tmpdir(), "fc-"));
    const path = writeFailureCases(failures, gold, { outDir: out, judge_model: "mock", prompt_version: "check-1.0", run_id: "r1" });
    const recs = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(recs.length).toBe(1);
    expect(recs[0]).toMatchObject({ claim: g.claim_text, cited_source: g.cited_source, gold_label: g.label, pred_label: "supports", snippet: g.snippet, rationale: g.rationale, judge_model: "mock", run_id: "r1" });
  });
});
