import { describe, it, expect } from "vitest";
import { assembleSources } from "../src/corpus/assemble.js";
import { CitationResolver } from "../src/citation/resolver.js";
import { loadGoldClaims } from "../src/eval/gold.js";

describe("gold citations resolve against the frozen corpus", () => {
  it("every gold raw_citation resolves to its cited_source", () => {
    const { sources, bibKeyToSourceId } = assembleSources("fixtures/corpus");
    const r = new CitationResolver(sources, bibKeyToSourceId);
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    expect(gold.length).toBeGreaterThan(0); // self-contained: don't vacuously pass on empty gold
    for (const g of gold) {
      expect(r.resolve(g.raw_citation)).toEqual({ source_id: g.cited_source, status: "resolved" });
    }
  });
});
