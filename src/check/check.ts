import type { Verdict } from "../types.js";
import type { HybridRetriever } from "../retrieve/index.js";
import type { Judge } from "./judge.js";
import { Tracer, type TraceEvent } from "../trace/trace.js";

export interface Locator {
  source_id: string;
  source_hash: string;
  char_start: number;
  char_end: number;
  page?: number;
  section: string;
  chunker_version: string;
}
export interface CitedSourceSupport {
  verdict: Verdict;
  locator: Locator;
  quote: string;
  reason: string;
  suggested_rewrite: string;
  confidence: number;
}
export interface CounterItem {
  source_id: string;
  locator: Locator;
  snippet: string;
  relation: "contradicts" | "supports" | "unrelated";
  reason: string;
}
export interface CorpusCounterevidence {
  found: boolean;
  items: CounterItem[];
}
export interface CheckResult {
  cited_source_support: CitedSourceSupport;
  corpus_counterevidence: CorpusCounterevidence;
  traces: TraceEvent[];
}

export function shouldContinue(verdict: Verdict, examined: number, limit: number): boolean {
  return verdict === "unclear" && examined < limit;
}

export function verdictToRelation(verdict: Verdict): "contradicts" | "supports" | "unrelated" {
  return verdict === "contradicts" ? "contradicts" : verdict === "supports" ? "supports" : "unrelated";
}

const loc = (c: { source_id: string; source_hash: string; char_start: number; char_end: number; page_start?: number; section: string; chunker_version: string }): Locator => {
  const locator: Locator = {
    source_id: c.source_id,
    source_hash: c.source_hash,
    char_start: c.char_start,
    char_end: c.char_end,
    section: c.section,
    chunker_version: c.chunker_version,
  };
  if (typeof c.page_start === "number") locator.page = c.page_start;
  return locator;
};

const retrievalScore = (h: { bm25_rank: number; vector_distance: number; rrf_score: number; final_rank: number }) => ({
  bm25_rank: h.bm25_rank,
  vector_distance: h.vector_distance,
  rrf_score: h.rrf_score,
  final_rank: h.final_rank,
});

export async function checkClaim(input: { claim: string; cited_source: string }, retriever: HybridRetriever, judge: Judge, k = 3, opts?: { maxCandidates?: number }): Promise<CheckResult> {
  const tracer = new Tracer({ model_id: judge.model, prompt_version: "check-1.0" });

  // (a) cited-source support — retrieve WITHIN the cited source, judging one snippet at a time
  const inSrc = await retriever.retrieve(input.claim, { k, sourceId: input.cited_source });
  tracer.add({ event_type: "retrieve_cited", input: { claim: input.claim, source: input.cited_source }, output: inSrc.map((h) => h.chunk.id), source_hashes: inSrc.map((h) => h.chunk.source_hash), retrieval: inSrc.map(retrievalScore) });
  const top = inSrc[0];
  let cited_source_support: CitedSourceSupport;
  if (!top) {
    const snippet = "";
    // unknown/missing cited source → don't judge an empty snippet (Codex review)
    const j = { verdict: "unclear" as const, reason: "cited source has no indexed chunks", confidence: 0, suggested_rewrite: "" };
    tracer.add({ event_type: "judge_cited", input: { snippet }, output: { verdict: j.verdict }, outbound_snippets: [snippet] });
    cited_source_support = {
      verdict: j.verdict,
      locator: { source_id: input.cited_source, source_hash: "", char_start: 0, char_end: 0, section: "body", chunker_version: "1.0" },
      quote: snippet,
      reason: j.reason,
      suggested_rewrite: j.suggested_rewrite,
      confidence: j.confidence,
    };
  } else {
    // `|| 1` guards a NaN/0 maxCandidates from an untyped runtime caller (would otherwise skip the loop
    // and hit the firstResult! assertion); Math.max(1, …) handles negatives. (Codex 互评 NIT)
    const limit = Math.max(1, Math.min(Math.floor(opts?.maxCandidates ?? 1) || 1, inSrc.length));
    let firstResult: { hit: typeof top; j: Awaited<ReturnType<Judge["judge"]>> } | undefined;
    let chosen: { hit: typeof top; j: Awaited<ReturnType<Judge["judge"]>> } | undefined;

    for (let i = 0; i < limit; i++) {
      const hit = inSrc[i]!;
      const snippet = hit.chunk.text;
      const j = await judge.judge({ claim: input.claim, snippet });
      const trace = { event_type: "judge_cited", input: { snippet }, output: { verdict: j.verdict }, outbound_snippets: [snippet] };
      tracer.add(limit === 1 ? trace : { ...trace, retrieval: [retrievalScore(hit)] });
      if (i === 0) firstResult = { hit, j };
      if (!shouldContinue(j.verdict, i + 1, limit)) {
        if (j.verdict !== "unclear") chosen = { hit, j };
        break;
      }
    }

    const result = chosen ?? firstResult!;
    cited_source_support = {
      verdict: result.j.verdict,
      locator: loc(result.hit.chunk),
      quote: result.hit.chunk.text,
      reason: result.j.reason,
      suggested_rewrite: result.j.suggested_rewrite,
      confidence: result.j.confidence,
    };
  }

  // (b) counter-evidence — independent OTHER-source candidate path, judged for a `contradicts` RELATION
  const cross = await retriever.retrieve(input.claim, { k, excludeSourceId: input.cited_source });
  tracer.add({ event_type: "retrieve_counter", input: { claim: input.claim, exclude: input.cited_source }, output: cross.map((h) => h.chunk.id), source_hashes: cross.map((h) => h.chunk.source_hash), retrieval: cross.map((h) => ({ bm25_rank: h.bm25_rank, vector_distance: h.vector_distance, rrf_score: h.rrf_score, final_rank: h.final_rank })) });
  const items: CounterItem[] = [];
  for (const h of cross) {
    const rj = await judge.judge({ claim: input.claim, snippet: h.chunk.text });
    const relation = verdictToRelation(rj.verdict);
    tracer.add({ event_type: "judge_counter", input: { source: h.chunk.source_id, snippet: h.chunk.text }, output: { relation }, outbound_snippets: [h.chunk.text] });
    items.push({ source_id: h.chunk.source_id, locator: loc(h.chunk), snippet: h.chunk.text, relation, reason: rj.reason });
  }
  const corpus_counterevidence: CorpusCounterevidence = { found: items.some((i) => i.relation === "contradicts"), items };

  return { cited_source_support, corpus_counterevidence, traces: tracer.drain() };
}
