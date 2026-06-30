import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { makeToolContext, TOOL_REGISTRY, searchSources, getFulltext, extractCitations } from "../src/tools/tools.js";

async function ctx() {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  return makeToolContext(sources, texts, await buildIndex(sources, texts, new HashEmbedder(256)), new MockJudge());
}

describe("tool layer", () => {
  it("registry covers the full §11 surface with correct kinds", () => {
    const names = TOOL_REGISTRY.map((t) => t.name).sort();
    expect(names).toEqual(["build_matrix", "check_claim", "extract_citations", "get_fulltext", "run_eval", "search_sources"]);
    expect(TOOL_REGISTRY.filter((t) => t.kind === "writes-local").map((t) => t.name).sort()).toEqual(["build_matrix", "run_eval"]);
  });
  it("search_sources applies schema defaults + returns traces", async () => {
    const r = await searchSources(await ctx(), { query: "social media depression", sourceId: "twenge2018" }); // no k -> default 3
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.length).toBeLessThanOrEqual(3);
    expect(r.traces[0]?.event_type).toBe("search_sources");
  });
  it("get_fulltext + extract_citations return traces", async () => {
    const c = await ctx();
    expect((await getFulltext(c, { source_id: "twenge2018" })).text.length).toBeGreaterThan(0);
    const e = extractCitations(c, { raw_citation: "(Twenge, 2018)" });
    expect(e.resolution.source_id).toBe("twenge2018");
    expect(e.traces[0]?.event_type).toBe("extract_citations");
  });
});
