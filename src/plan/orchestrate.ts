import type { HybridRetriever } from "../retrieve/index.js";
import type { Judge } from "../check/judge.js";
import { verdictToRelation, type Locator } from "../check/check.js";
import type { Planner } from "./planner.js";
import { synthesizeThesisVerdict, type ThesisVerdict } from "./synthesize.js";
import { Tracer, type TraceEvent } from "../trace/trace.js";

// Plan-driven retrieval (spec §7): planner_plan + one plan_retrieve per UNIQUE sub-query.
// Dedup happens HERE (orchestrator), not in the planner. Evidence carries the chunk's full
// locator fields so a finding can expose a structured, integrity-checkable Locator (§6).
export interface PlanEvidence { chunk_id: string; source_id: string; source_hash: string; text: string; char_start: number; char_end: number; section: string; chunker_version: string; page_start?: number; rrf_score: number; subquery: string; }
export interface PlanFinding {
  source_id: string;
  subquery: string;
  snippet: string;
  locator: Locator;
  relation: "contradicts" | "supports" | "unrelated";
  reason: string;
}
export interface PlanCheckResult {
  thesis: string;
  subqueries: string[];
  findings: PlanFinding[];
  summary: {
    supporting_sources: string[];
    contradicting_sources: string[];
  };
  thesis_verdict: ThesisVerdict;
  traces: TraceEvent[];
}

export async function runPlan(retriever: HybridRetriever, planner: Planner, question: string, opts: { k?: number; budget?: number } = {}): Promise<{ plan: { question: string; subqueries: string[] }; evidence: PlanEvidence[]; traces: TraceEvent[] }> {
  const t = new Tracer({ model_id: planner.model, prompt_version: "plan-1.0" });
  const raw = await planner.plan(question);
  const subqueries = [...new Set(raw.subqueries.map((q) => q.trim()).filter(Boolean))]; // dedup in orchestrator, not planner
  // equal-budget: a total `budget` is split across the ACTUAL unique sub-query count (not a hardcoded 3).
  const k = opts.budget !== undefined ? Math.max(1, Math.ceil(opts.budget / Math.max(1, subqueries.length))) : (opts.k ?? 3);
  t.add({ event_type: "planner_plan", input: { question }, output: subqueries });
  const seen = new Set<string>();
  const evidence: PlanEvidence[] = [];
  for (const q of subqueries) {
    const hits = await retriever.retrieve(q, { k });
    t.add({ event_type: "plan_retrieve", input: { subquery: q }, output: hits.map((h) => h.chunk.id), source_hashes: hits.map((h) => h.chunk.source_hash), retrieval: hits.map((h) => ({ bm25_rank: h.bm25_rank, vector_distance: h.vector_distance, rrf_score: h.rrf_score, final_rank: h.final_rank })) });
    for (const h of hits) {
      if (!seen.has(h.chunk.id)) {
        seen.add(h.chunk.id);
        evidence.push({ chunk_id: h.chunk.id, source_id: h.chunk.source_id, source_hash: h.chunk.source_hash, text: h.chunk.text, char_start: h.chunk.char_start, char_end: h.chunk.char_end, section: h.chunk.section, chunker_version: h.chunk.chunker_version, page_start: h.chunk.page_start, rrf_score: h.rrf_score, subquery: q });
      }
    }
  }
  return { plan: { question, subqueries }, evidence, traces: t.drain() };
}

export async function runPlanAndCheck(
  retriever: HybridRetriever,
  planner: Planner,
  judge: Judge,
  thesis: string,
  opts: { k?: number; budget?: number; judgeBudget?: number; onStage?: (stage: string, detail: string) => void } = {},
): Promise<PlanCheckResult> {
  const { plan, evidence, traces } = await runPlan(retriever, planner, thesis, opts);
  opts.onStage?.("plan", `${plan.subqueries.length} subqueries`);
  opts.onStage?.("retrieve", `${evidence.length} evidence`);
  // judgeBudget caps post-dedupe judged evidence (a public boundary): floor + min 1 so a stray
  // negative/fractional value can't silently empty or skew the map (Codex 互评).
  const judged = evidence.slice(0, Math.max(1, Math.floor(opts.judgeBudget ?? 6)));
  const t = new Tracer({ model_id: judge.model, prompt_version: "plancheck-1.0" });
  const findings: PlanFinding[] = [];

  for (const [i, e] of judged.entries()) {
    const j = await judge.judge({ claim: thesis, snippet: e.text });
    const relation = verdictToRelation(j.verdict);
    t.add({ event_type: "plan_judge", input: { source: e.source_id, snippet: e.text }, output: { relation }, outbound_snippets: [e.text] });
    const locator: Locator = { source_id: e.source_id, source_hash: e.source_hash, char_start: e.char_start, char_end: e.char_end, section: e.section, chunker_version: e.chunker_version };
    if (e.page_start !== undefined) locator.page = e.page_start;
    findings.push({
      source_id: e.source_id,
      subquery: e.subquery,
      snippet: e.text,
      locator,
      relation,
      reason: j.reason,
    });
    opts.onStage?.("judge", `${i + 1}/${judged.length} judged`);
  }
  const thesis_verdict = synthesizeThesisVerdict(findings);
  opts.onStage?.("report", thesis_verdict.verdict);

  return {
    thesis,
    subqueries: plan.subqueries,
    findings,
    summary: {
      supporting_sources: [...new Set(findings.filter((f) => f.relation === "supports").map((f) => f.source_id))],
      contradicting_sources: [...new Set(findings.filter((f) => f.relation === "contradicts").map((f) => f.source_id))],
    },
    thesis_verdict,
    traces: [...traces, ...t.drain()],
  };
}
