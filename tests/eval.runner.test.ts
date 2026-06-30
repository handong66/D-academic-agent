import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEval } from "../src/eval/runner.js";
import { loadGoldClaims } from "../src/eval/gold.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { sourceHash } from "../src/ingest/hash.js";
import { MockJudge, type Judge, type JudgeInput, type JudgeOutput } from "../src/check/judge.js";
import type { Verdict } from "../src/types.js";

class ClaimVerdictJudge implements Judge {
  readonly model = "claim-verdict-judge";

  constructor(private readonly verdicts: Record<string, Verdict>) {}

  async judge({ claim }: JudgeInput): Promise<JudgeOutput> {
    const verdict = this.verdicts[claim] ?? "unclear";
    return { verdict, reason: `forced ${verdict}`, confidence: 1, suggested_rewrite: "" };
  }
}

describe("runEval", () => {
  it("writes report (with confusion + failures) + trace.jsonl; reporting-only", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "eval-")), "nested"); // dir does not exist yet
    const goldPath = "fixtures/gold_claims.jsonl";
    const res = await runEval({ corpusDir: "fixtures/corpus", goldPath, outDir: out }, new HashEmbedder(256), new MockJudge());
    expect(res.n).toBe(loadGoldClaims(goldPath).length);
    expect(res).not.toHaveProperty("passed");
    expect(existsSync(join(out, "trace.jsonl"))).toBe(true);
    const report = readFileSync(join(out, "report.md"), "utf8");
    expect(report).toContain("Confusion");
    expect(report).toContain("Failures");
    expect(report).toContain("answer groundedness=");
    expect(report).toContain("policy grounded locators=");
    expect(report).toContain("snippet-only=");
    expect(report).toContain("outbound chars=");
    expect(typeof res.answer_groundedness).toBe("number");
    expect(typeof res.policy_compliance.grounded_locator_rate).toBe("number");
    expect(typeof res.policy_compliance.snippet_only_rate).toBe("number");
    expect(typeof res.policy_compliance.outbound_chars).toBe("number");
    expect(typeof res.retrieval_recall_at_k).toBe("number");
    expect(res.failures.every((f) => typeof f.cited_source === "string")).toBe(true); // M2 Task 0: drilldown key
  });

  it("reports answer_groundedness as support-decision precision", async () => {
    const corpusDir = mkdtempSync(join(tmpdir(), "eval-groundedness-corpus-"));
    const goldPath = join(corpusDir, "gold.jsonl");
    const out = join(mkdtempSync(join(tmpdir(), "eval-groundedness-")), "out");
    const content = [
      "Alpha evidence supports the first claim.",
      "Beta limitation does not support the second claim.",
      "Gamma evidence partially supports the third claim.",
    ].join(" ");
    const hash = sourceHash(content);
    writeFileSync(join(corpusDir, "refs.bib"), "@article{toy2026, author={Toy, Test}, year={2026}, title={Toy source}}\n");
    writeFileSync(join(corpusDir, "toy2026.txt"), content);

    const line = (claim_text: string, snippet: string, label: Verdict) => JSON.stringify({
      claim_text,
      cited_source: "toy2026",
      raw_citation: "(Toy, 2026)",
      snippet,
      locator: {
        source_id: "toy2026",
        source_hash: hash,
        char_start: content.indexOf(snippet),
        char_end: content.indexOf(snippet) + snippet.length,
      },
      label,
      rationale: "test fixture",
      annotator: "test",
      label_schema_version: "1.0",
    });
    writeFileSync(goldPath, [
      line("first claim supported", "Alpha evidence supports the first claim.", "supports"),
      line("second claim supported", "Beta limitation does not support the second claim.", "unsupported"),
      line("third claim weak support", "Gamma evidence partially supports the third claim.", "weakly_supports"),
    ].join("\n") + "\n");

    const report = await runEval(
      { corpusDir, goldPath, outDir: out, k: 1 },
      new HashEmbedder(256),
      new ClaimVerdictJudge({
        "first claim supported": "supports",
        "second claim supported": "supports",
        "third claim weak support": "weakly_supports",
      }),
    );

    expect(report.answer_groundedness).toBeCloseTo(2 / 3, 10);
    expect(report.policy_compliance.grounded_locator_rate).toBe(1);
  });
});
