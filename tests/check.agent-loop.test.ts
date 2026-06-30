import { describe, it, expect } from "vitest";
import { checkClaim, shouldContinue } from "../src/check/check.js";
import type { Judge, JudgeOutput } from "../src/check/judge.js";
import type { HybridRetriever } from "../src/retrieve/index.js";
import type { Chunk, RetrievalHit } from "../src/retrieve/types.js";
import type { TraceEvent } from "../src/trace/trace.js";
import type { Verdict } from "../src/types.js";

function chunk(id: string, text: string, ordinal: number): Chunk {
  const start = ordinal * 100;
  return {
    id,
    source_id: "src-1",
    source_hash: "hash-src-1",
    ordinal,
    section: "body",
    char_start: start,
    char_end: start + text.length,
    text,
    chunker_version: "1.0",
    embedding_model: "test",
    embedding_dim: 2,
  };
}

function hit(id: string, text: string, finalRank: number): RetrievalHit {
  return {
    chunk: chunk(id, text, finalRank - 1),
    bm25_rank: finalRank,
    vector_rank: finalRank,
    vector_distance: finalRank / 10,
    rrf_score: 1 / finalRank,
    final_rank: finalRank,
  };
}

function retriever(citedHits: RetrievalHit[], counterHits: RetrievalHit[] = []): HybridRetriever {
  return {
    async retrieve(_query: string, opts: { sourceId?: string; excludeSourceId?: string }) {
      return opts.sourceId ? citedHits : counterHits;
    },
  } as unknown as HybridRetriever;
}

class ScriptedJudge implements Judge {
  readonly model = "scripted-judge";

  constructor(private readonly bySnippet: Record<string, Verdict>) {}

  async judge({ snippet }: { snippet: string }): Promise<JudgeOutput> {
    const verdict = this.bySnippet[snippet] ?? "unclear";
    return {
      verdict,
      reason: `scripted:${verdict}`,
      confidence: verdict === "unclear" ? 0.2 : 0.9,
      suggested_rewrite: verdict === "unclear" ? "retrieve more evidence" : "",
    };
  }
}

function citedJudges(events: TraceEvent[]): TraceEvent[] {
  return events.filter((event) => event.event_type === "judge_cited");
}

function withoutTs(events: TraceEvent[]): Omit<TraceEvent, "ts">[] {
  return events.map(({ ts: _ts, ...event }) => event);
}

describe("agent-loop cited-source checker", () => {
  it("shouldContinue continues only for unclear verdicts within budget", () => {
    expect(shouldContinue("supports", 1, 3)).toBe(false);
    expect(shouldContinue("unclear", 1, 3)).toBe(true);
    expect(shouldContinue("unclear", 3, 3)).toBe(false);
  });

  it("defaults to single-shot behavior and matches explicit maxCandidates=1 semantically", async () => {
    const hits = [hit("A", "snippet A is ambiguous", 1), hit("B", "snippet B supports the claim", 2)];
    const judge = new ScriptedJudge({ "snippet A is ambiguous": "unclear", "snippet B supports the claim": "supports" });

    const implicit = await checkClaim({ claim: "claim", cited_source: "src-1" }, retriever(hits), judge, 3);
    const explicit = await checkClaim({ claim: "claim", cited_source: "src-1" }, retriever(hits), judge, 3, { maxCandidates: 1 });

    expect(explicit.cited_source_support).toEqual(implicit.cited_source_support);
    expect(withoutTs(explicit.traces)).toEqual(withoutTs(implicit.traces));
    expect(citedJudges(explicit.traces)).toHaveLength(1);
    expect(citedJudges(explicit.traces)[0]?.retrieval).toBeUndefined();
  });

  it("keeps maxCandidates=1 unclear but lets maxCandidates=3 stop on the first decisive lower candidate", async () => {
    const hits = [hit("A", "snippet A is ambiguous", 1), hit("B", "snippet B supports the claim", 2)];
    const judge = new ScriptedJudge({ "snippet A is ambiguous": "unclear", "snippet B supports the claim": "supports" });

    const single = await checkClaim({ claim: "claim", cited_source: "src-1" }, retriever(hits), judge, 3, { maxCandidates: 1 });
    const agentic = await checkClaim({ claim: "claim", cited_source: "src-1" }, retriever(hits), judge, 3, { maxCandidates: 3 });

    expect(single.cited_source_support.verdict).toBe("unclear");
    expect(single.cited_source_support.quote).toBe("snippet A is ambiguous");
    expect(citedJudges(single.traces)).toHaveLength(1);
    expect(agentic.cited_source_support.verdict).toBe("supports");
    expect(agentic.cited_source_support.quote).toBe("snippet B supports the claim");
    expect(citedJudges(agentic.traces).length).toBeGreaterThanOrEqual(2);
    expect(citedJudges(agentic.traces)[1]?.retrieval).toEqual([
      { bm25_rank: 2, vector_distance: 0.2, rrf_score: 0.5, final_rank: 2 },
    ]);
  });

  it("returns the top-ranked candidate when every examined candidate remains unclear", async () => {
    const hits = [
      hit("A", "top snippet remains unclear", 1),
      hit("B", "lower snippet also unclear", 2),
      hit("C", "last snippet also unclear", 3),
    ];
    const judge = new ScriptedJudge({});

    const result = await checkClaim({ claim: "claim", cited_source: "src-1" }, retriever(hits), judge, 3, { maxCandidates: 3 });

    expect(result.cited_source_support.verdict).toBe("unclear");
    expect(result.cited_source_support.quote).toBe("top snippet remains unclear");
    expect(result.cited_source_support.locator.char_start).toBe(0);
    expect(citedJudges(result.traces)).toHaveLength(3);
  });

  it("documents the noisy-judge failure mode: a lower false decisive verdict can flip unclear to supports", async () => {
    const hits = [hit("A", "correctly unclear top snippet", 1), hit("B", "noisy lower snippet", 2)];
    const noisyJudge = new ScriptedJudge({ "correctly unclear top snippet": "unclear", "noisy lower snippet": "supports" });

    const result = await checkClaim({ claim: "claim", cited_source: "src-1" }, retriever(hits), noisyJudge, 3, { maxCandidates: 3 });

    expect(result.cited_source_support.verdict).toBe("supports");
    expect(result.cited_source_support.quote).toBe("noisy lower snippet");
  });
});
