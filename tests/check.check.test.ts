import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { checkClaim, verdictToRelation } from "../src/check/check.js";
import type { Verdict } from "../src/types.js";

describe("checkClaim", () => {
  it("maps judge verdicts into plan/check relations without changing weak support behavior", () => {
    expect(verdictToRelation("contradicts")).toBe("contradicts");
    expect(verdictToRelation("supports")).toBe("supports");
    expect(verdictToRelation("weakly_supports")).toBe("unrelated");
    expect(verdictToRelation("unsupported")).toBe("unrelated");
    expect(verdictToRelation("unclear")).toBe("unrelated");
  });

  it("returns structured cited-support + counterevidence + §10 traces (snippet-only)", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const retriever = await buildIndex(sources, texts, new HashEmbedder(256));
    const r = await checkClaim({ claim: "Social media use causes depression", cited_source: "twenge2018" }, retriever, new MockJudge());
    expect(r.cited_source_support.locator.source_id).toBe("twenge2018");
    expect(r.cited_source_support).toHaveProperty("suggested_rewrite");
    expect(typeof r.corpus_counterevidence.found).toBe("boolean");
    for (const it of r.corpus_counterevidence.items) {
      expect(it).toHaveProperty("relation");
      expect(it.source_id).not.toBe("twenge2018"); // independent cross-source path
    }
    expect(r.traces[0]?.schema_version).toBe("1.0");
    // every cross hit was judged (a judge_counter trace per item)
    const counterJudged = r.traces.filter((t) => t.event_type === "judge_counter").length;
    expect(counterJudged).toBe(r.corpus_counterevidence.items.length);
  });

  it("found is true iff a cross-source snippet is judged contradicts (relation-gated)", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const retriever = await buildIndex(sources, texts, new HashEmbedder(256));
    const contradictJudge = { model: "stub", async judge() { return { verdict: "contradicts" as const, reason: "stub", confidence: 1, suggested_rewrite: "" }; } };
    const r = await checkClaim({ claim: "Social media use causes depression", cited_source: "twenge2018" }, retriever, contradictJudge);
    expect(r.corpus_counterevidence.items.length).toBeGreaterThan(0);
    expect(r.corpus_counterevidence.found).toBe(true);
    expect(r.corpus_counterevidence.items.every((i) => i.relation === "contradicts")).toBe(true);
  });

  it("pins counter-evidence trace ordering and item shape before refactoring relation mapping", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const retriever = await buildIndex(sources, texts, new HashEmbedder(256));
    const verdicts: Verdict[] = ["supports", "contradicts", "supports", "weakly_supports", "unsupported", "unclear"];
    let calls = 0;
    const stubJudge = {
      model: "stub-counter-sequence",
      async judge() {
        const verdict = verdicts[calls++] ?? "unclear";
        return { verdict, reason: `stub ${verdict}`, confidence: 1, suggested_rewrite: "" };
      },
    };

    const r = await checkClaim({ claim: "Social media use causes depression", cited_source: "twenge2018" }, retriever, stubJudge, 5);

    expect(r.traces.map((t) => t.event_type)).toEqual([
      "retrieve_cited",
      "judge_cited",
      "retrieve_counter",
      ...r.corpus_counterevidence.items.map(() => "judge_counter"),
    ]);
    expect(r.corpus_counterevidence.items).toHaveLength(5);
    expect(r.corpus_counterevidence.items.map((item) => item.relation)).toEqual([
      "contradicts",
      "supports",
      "unrelated",
      "unrelated",
      "unrelated",
    ]);
    for (const item of r.corpus_counterevidence.items) {
      expect(Object.keys(item).sort()).toEqual(["locator", "reason", "relation", "snippet", "source_id"]);
      expect(item).toEqual({
        source_id: expect.any(String),
        locator: expect.objectContaining({
          source_id: expect.any(String),
          source_hash: expect.any(String),
          char_start: expect.any(Number),
          char_end: expect.any(Number),
          section: expect.any(String),
          chunker_version: expect.any(String),
        }),
        snippet: expect.any(String),
        relation: expect.stringMatching(/^(contradicts|supports|unrelated)$/),
        reason: expect.any(String),
      });
    }
  });
});
