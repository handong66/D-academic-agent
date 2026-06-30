import type { HybridRetriever } from "../retrieve/index.js";
import type { Planner } from "../plan/planner.js";
import { loadGoldClaims } from "./gold.js";
import { runPlan } from "../plan/orchestrate.js";
import { recallAtK } from "./metrics.js";

// Planner-recall eval (spec §7): plan vs single retrieval at EQUAL budget, scored by gold-locator
// span overlap (reuse M1 recallAtK). Plan side uses the planner's ACTUAL evidence spans.
export async function evalPlannerRecall(retriever: HybridRetriever, planner: Planner, goldPath: string, budget = 6): Promise<{ n: number; budget: number; plan_recall_at_budget: number; single_recall_at_budget: number }> {
  const gold = loadGoldClaims(goldPath);
  const planItems: { gold: [number, number]; retrieved: [number, number][] }[] = [];
  const singleItems: { gold: [number, number]; retrieved: [number, number][] }[] = [];
  for (const g of gold) {
    const goldSpan: [number, number] = [g.locator.char_start, g.locator.char_end];
    // single: one retrieval at full budget
    const single = await retriever.retrieve(g.claim_text, { k: budget });
    singleItems.push({ gold: goldSpan, retrieved: single.filter((h) => h.chunk.source_id === g.cited_source).map((h) => [h.chunk.char_start, h.chunk.char_end] as [number, number]) });
    // plan: sub-queries each at budget/|subqueries|, capped at the SAME total budget
    const plan = await runPlan(retriever, planner, g.claim_text, { budget });
    const planSpans = plan.evidence
      .filter((e) => e.source_id === g.cited_source)
      .slice(0, budget)
      .map((e) => [e.char_start, e.char_end] as [number, number]); // planner's ACTUAL evidence spans (no substitution)
    planItems.push({ gold: goldSpan, retrieved: planSpans });
  }
  return { n: gold.length, budget, plan_recall_at_budget: recallAtK(planItems, budget), single_recall_at_budget: recallAtK(singleItems, budget) };
}
