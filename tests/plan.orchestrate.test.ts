import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { runPlan } from "../src/plan/orchestrate.js";

const dupPlanner = { model: "dup", async plan(question: string) { return { question, subqueries: ["social media depression", "social media depression"] }; } };

describe("runPlan", () => {
  it("dedupes sub-queries and traces planner + one plan_retrieve per UNIQUE sub-query", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await runPlan(await buildIndex(sources, texts, new HashEmbedder(256)), dupPlanner, "q", { k: 3 });
    expect(r.plan.subqueries).toEqual(["social media depression"]); // deduped in runPlan
    expect(r.traces.filter((t) => t.event_type === "plan_retrieve").length).toBe(1);
    expect(r.traces.find((t) => t.event_type === "plan_retrieve")?.source_hashes.length).toBeGreaterThan(0);
  });
  it("splits a total budget across the actual unique sub-query count (not hardcoded 3)", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const idx = await buildIndex(sources, texts, new HashEmbedder(256));
    const oneQ = { model: "one", async plan(question: string) { return { question, subqueries: ["social media depression adolescent"] }; } };
    const r = await runPlan(idx, oneQ, "q", { budget: 6 }); // 1 unique sub-query -> k = ceil(6/1) = 6
    const ret = r.traces.filter((t) => t.event_type === "plan_retrieve");
    expect(ret.length).toBe(1);
    expect(ret[0]?.retrieval?.length ?? 0).toBeGreaterThan(2); // k=6, not the old hardcoded budget/3=2
  });
});
