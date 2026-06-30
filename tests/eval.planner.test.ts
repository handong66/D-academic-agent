import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockPlanner } from "../src/plan/planner.js";
import { evalPlannerRecall } from "../src/eval/planner-eval.js";

describe("evalPlannerRecall", () => {
  it("compares plan vs single at EQUAL budget using locator span overlap", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await evalPlannerRecall(await buildIndex(sources, texts, new HashEmbedder(256)), new MockPlanner(), "fixtures/gold_claims.jsonl", 6);
    expect(r.n).toBeGreaterThanOrEqual(20);
    expect(r.plan_recall_at_budget).toBeGreaterThanOrEqual(0);
    expect(r.single_recall_at_budget).toBeGreaterThanOrEqual(0);
    expect(r.budget).toBe(6);
  });
});
