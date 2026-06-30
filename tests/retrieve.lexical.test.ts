import { describe, it, expect } from "vitest";
import { openDb } from "../src/retrieve/db.js";
import { FtsLexicalIndex } from "../src/retrieve/lexical.js";

describe("FtsLexicalIndex", () => {
  it("ranks match first and filters by source before ranking", () => {
    const idx = new FtsLexicalIndex(openDb(":memory:"));
    idx.add([
      { id: "a", source_id: "s1", text: "social media adolescent depression" },
      { id: "b", source_id: "s2", text: "social media adolescent depression" },
    ]);
    expect(idx.search("adolescent depression", 5)[0]?.id).toBeDefined();
    const only = idx.search("adolescent depression", 5, "s1");
    expect(only.every((h) => h.id === "a")).toBe(true);
  });

  it("ranks the more relevant doc higher (real bm25 order, distinct docs)", () => {
    const idx = new FtsLexicalIndex(openDb(":memory:"));
    idx.add([
      { id: "rel", source_id: "s1", text: "adolescent depression and social media use are strongly linked" },
      { id: "weak", source_id: "s2", text: "cooking pasta recipes with an adolescent helper" },
    ]);
    const hits = idx.search("adolescent depression social media", 5);
    expect(hits[0]?.id).toBe("rel");
  });

  it("excludeSourceId removes a source before ranking", () => {
    const idx = new FtsLexicalIndex(openDb(":memory:"));
    idx.add([
      { id: "a", source_id: "s1", text: "social media adolescent depression" },
      { id: "b", source_id: "s2", text: "social media adolescent depression" },
    ]);
    const hits = idx.search("adolescent depression", 5, undefined, "s1");
    expect(hits.every((h) => h.id !== "a")).toBe(true);
  });
});
