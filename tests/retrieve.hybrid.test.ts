import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";

describe("HybridRetriever", () => {
  it("source-filtered retrieval returns only cited-source chunks (filter before rank)", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await buildIndex(sources, texts, new HashEmbedder(256));
    const hits = await r.retrieve("does social media cause depression", { k: 5, sourceId: "twenge2018" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.chunk.source_id === "twenge2018")).toBe(true);
  });

  it("excludeSourceId omits the excluded source from both lexical and vector halves", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await buildIndex(sources, texts, new HashEmbedder(256));
    const hits = await r.retrieve("social media adolescent mental health", { k: 5, excludeSourceId: "twenge2018" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.chunk.source_id !== "twenge2018")).toBe(true);
  });
});
