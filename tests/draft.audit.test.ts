import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { makeToolContext } from "../src/tools/tools.js";
import { auditDraft } from "../src/draft/audit.js";

async function ctx() {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  return makeToolContext(sources, texts, await buildIndex(sources, texts, new HashEmbedder(256)), new MockJudge());
}

describe("auditDraft", () => {
  it("returns per-sentence diagnosis with resolved citations + verdicts (+ traces), no gold metrics", async () => {
    const draft = "Social media use is associated with adolescent depression (Twenge, 2018). Sleep is unrelated here (Orben, 2019).";
    const r = await auditDraft(draft, await ctx());
    expect(r.sentences.length).toBe(2);
    const m0 = r.sentences[0]!.mentions[0]!;
    expect(m0.status).toBe("resolved");
    expect(m0.source_id).toBe("twenge2018");
    expect(typeof m0.support?.verdict).toBe("string");
    expect(m0.support?.reason).toBeTruthy();
    expect(r.traces.length).toBeGreaterThan(0);
    expect(r).not.toHaveProperty("macro_f1");
  });

  it("marks an unresolvable citation without crashing", async () => {
    const r = await auditDraft("This cites nobody real (Nonexistent, 1999).", await ctx());
    expect(r.sentences[0]!.mentions[0]!.status).not.toBe("resolved");
    expect(r.sentences[0]!.mentions[0]!.support).toBeUndefined();
  });

  it("keeps multiple mentions in the same sentence", async () => {
    const draft = "Prior work reports mixed effects [1][2].";
    const r = await auditDraft(draft, await ctx());
    expect(r.sentences).toHaveLength(1);
    expect(r.sentences[0]!.mentions.map((x) => x.raw_citation)).toEqual(["[1]", "[2]"]);
  });

  it("returns an empty mentions array for a sentence with no mentions", async () => {
    const r = await auditDraft("This sentence makes no citation claim.", await ctx());
    expect(r.sentences).toHaveLength(1);
    expect(r.sentences[0]!.mentions).toEqual([]);
  });

  it("includes counterevidence_found on resolved mention audits", async () => {
    const r = await auditDraft("Social media use is associated with adolescent depression (Twenge, 2018).", await ctx());
    expect(r.sentences[0]!.mentions[0]).toHaveProperty("counterevidence_found");
  });

  it("adds traces for each resolved mention", async () => {
    const toolCtx = await ctx();
    const single = await auditDraft("Social media use is associated with adolescent depression (Twenge, 2018).", toolCtx);
    const multiple = await auditDraft("Social media use is associated with adolescent depression (Twenge, 2018) and sleep issues (Orben, 2019).", toolCtx);
    expect(multiple.sentences[0]!.mentions.filter((x) => x.status === "resolved")).toHaveLength(2);
    expect(multiple.traces.length).toBeGreaterThan(single.traces.length);
  });
});
