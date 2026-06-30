import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEval } from "../src/eval/runner.js";
import { loadGoldClaims } from "../src/eval/gold.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";

describe("M1 end-to-end (ingest→index→retrieve→check→eval→trace)", () => {
  it("produces reporting-only metrics over the full gold set with persisted trace", async () => {
    const goldPath = "fixtures/gold_claims.jsonl";
    const r = await runEval({ corpusDir: "fixtures/corpus", goldPath, outDir: mkdtempSync(join(tmpdir(), "m1-")) }, new HashEmbedder(256), new MockJudge());
    expect(r.n).toBe(loadGoldClaims(goldPath).length);
    expect(Object.keys(r.per_class)).toHaveLength(5);
    expect(r.retrieval_recall_at_k).toBeGreaterThan(0);
  });
});
