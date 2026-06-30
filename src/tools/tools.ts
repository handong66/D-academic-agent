import { z } from "zod";
import type { Source } from "../types.js";
import type { HybridRetriever } from "../retrieve/index.js";
import type { Judge } from "../check/judge.js";
import { checkClaim, type CheckResult } from "../check/check.js";
import { Tracer, type TraceEvent } from "../trace/trace.js";
import { CitationResolver, type Resolution } from "../citation/resolver.js";
import { MockPlanner, type Planner } from "../plan/planner.js";
import type { Embedder } from "../retrieve/types.js";

// Classified tool layer (spec §11): pure functions over M1; return TraceEvents (only CLI/runner persists).
export interface ToolContext {
  sources: Source[];
  texts: Map<string, string>;
  retriever: HybridRetriever;
  judge: Judge;
  planner: Planner;
  resolver: CitationResolver;
  embedder?: Embedder; // the active embedder (when built via a provider) so run_eval reflects the selected config
}
export function makeToolContext(sources: Source[], texts: Map<string, string>, retriever: HybridRetriever, judge: Judge, embedder?: Embedder, planner: Planner = new MockPlanner()): ToolContext {
  const map = Object.fromEntries(sources.map((s) => [s.citation_metadata.bibtex_key, s.id]));
  return { sources, texts, retriever, judge, planner, resolver: new CitationResolver(sources, map), embedder };
}
const tracer = () => new Tracer({ model_id: "tool", prompt_version: "tool-1.0" });

export const SearchInput = z.object({ query: z.string(), k: z.number().int().positive().default(3), sourceId: z.string().optional() });
export async function searchSources(ctx: ToolContext, raw: z.input<typeof SearchInput>): Promise<{ hits: { id: string; source_id: string; text: string; rrf_score: number }[]; traces: TraceEvent[] }> {
  const a = SearchInput.parse(raw);
  const t = tracer();
  const hits = await ctx.retriever.retrieve(a.query, { k: a.k, sourceId: a.sourceId });
  t.add({ event_type: "search_sources", input: a, output: hits.map((h) => h.chunk.id), source_hashes: hits.map((h) => h.chunk.source_hash), retrieval: hits.map((h) => ({ bm25_rank: h.bm25_rank, vector_distance: h.vector_distance, rrf_score: h.rrf_score, final_rank: h.final_rank })) });
  return { hits: hits.map((h) => ({ id: h.chunk.id, source_id: h.chunk.source_id, text: h.chunk.text, rrf_score: h.rrf_score })), traces: t.drain() };
}

export const FulltextInput = z.object({ source_id: z.string() });
export async function getFulltext(ctx: ToolContext, raw: z.input<typeof FulltextInput>): Promise<{ text: string; traces: TraceEvent[] }> {
  const a = FulltextInput.parse(raw);
  const t = tracer();
  const src = ctx.sources.find((s) => s.id === a.source_id);
  const text = src ? (ctx.texts.get(src.id) ?? "") : "";
  t.add({ event_type: "get_fulltext", input: a, output: { len: text.length }, source_hashes: src ? [src.source_hash] : [] });
  return { text, traces: t.drain() };
}

export const CheckInput = z.object({ claim: z.string(), cited_source: z.string() });
export async function checkClaimTool(ctx: ToolContext, raw: z.input<typeof CheckInput>): Promise<CheckResult> {
  const a = CheckInput.parse(raw);
  return checkClaim(a, ctx.retriever, ctx.judge);
}

export const ExtractInput = z.object({ raw_citation: z.string() });
export function extractCitations(ctx: ToolContext, raw: z.input<typeof ExtractInput>): { resolution: Resolution; traces: TraceEvent[] } {
  const a = ExtractInput.parse(raw);
  const t = tracer();
  const resolution = ctx.resolver.resolve(a.raw_citation);
  t.add({ event_type: "extract_citations", input: a, output: resolution });
  return { resolution, traces: t.drain() };
}

export type ToolKind = "read-only" | "writes-local";
export const TOOL_REGISTRY: { name: string; kind: ToolKind; input: z.ZodTypeAny }[] = [
  { name: "search_sources", kind: "read-only", input: SearchInput },
  { name: "get_fulltext", kind: "read-only", input: FulltextInput },
  { name: "check_claim", kind: "read-only", input: CheckInput },
  { name: "extract_citations", kind: "read-only", input: ExtractInput },
  { name: "build_matrix", kind: "writes-local", input: z.object({ outDir: z.string() }) },
  { name: "run_eval", kind: "writes-local", input: z.object({ outDir: z.string() }) },
];
