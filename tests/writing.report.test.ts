import { describe, it, expect } from "vitest";
import { CitationResolver } from "../src/citation/resolver.js";
import type { Judge, JudgeOutput } from "../src/check/judge.js";
import type { HybridRetriever } from "../src/retrieve/index.js";
import type { Chunk, RetrievalHit } from "../src/retrieve/types.js";
import { MockPlanner } from "../src/plan/planner.js";
import { analyzeParagraph } from "../src/writing/report.js";
import type { ToolContext } from "../src/tools/tools.js";
import type { Source, Verdict } from "../src/types.js";

function source(id: string, author: string, year: string): Source {
  return {
    id,
    title: `${author} ${year}`,
    authors: [author],
    year,
    type: "scholarly_article",
    path_or_url: `${id}.txt`,
    source_hash: `hash-${id}`,
    citation_metadata: { bibtex_key: id },
    fulltext_status: "indexed",
  };
}

function chunk(sourceId: string, quote: string): Chunk {
  return {
    id: `${sourceId}#0`,
    source_id: sourceId,
    source_hash: `hash-${sourceId}`,
    ordinal: 0,
    section: "body",
    char_start: 0,
    char_end: quote.length,
    text: quote,
    chunker_version: "1.0",
    embedding_model: "fixture",
    embedding_dim: 2,
  };
}

function hit(sourceId: string, quote: string): RetrievalHit {
  return {
    chunk: chunk(sourceId, quote),
    bm25_rank: 1,
    vector_rank: 1,
    vector_distance: 0.1,
    rrf_score: 1,
    final_rank: 1,
  };
}

class FixtureRetriever {
  readonly calls: { query: string; opts: { k: number; sourceId?: string; excludeSourceId?: string } }[] = [];

  constructor(
    private readonly bySource: Record<string, RetrievalHit[]>,
    private readonly byClaim: Record<string, RetrievalHit[]>,
  ) {}

  async retrieve(query: string, opts: { k: number; sourceId?: string; excludeSourceId?: string }): Promise<RetrievalHit[]> {
    this.calls.push({ query, opts });
    if (opts.sourceId) return this.bySource[opts.sourceId] ?? [];
    if (opts.excludeSourceId) return [];
    return this.byClaim[query] ?? [];
  }
}

class ScriptedJudge implements Judge {
  readonly model = "scripted-writing-report";

  constructor(private readonly verdictByQuote: Record<string, Verdict>) {}

  async judge({ snippet }: { claim: string; snippet: string }): Promise<JudgeOutput> {
    const verdict = this.verdictByQuote[snippet] ?? "unclear";
    return {
      verdict,
      reason: `scripted ${verdict}`,
      confidence: verdict === "unclear" ? 0.2 : 0.9,
      suggested_rewrite: "",
    };
  }
}

function context(retriever: FixtureRetriever, judge: Judge): ToolContext {
  const sources = [
    source("smith2020", "Smith", "2020"),
    source("doe2020", "Doe", "2020"),
    source("jones2021", "Jones", "2021"),
    source("brown2022", "Brown", "2022"),
    source("garcia2023", "Garcia", "2023"),
    source("lee2024", "Lee", "2024"),
    source("kim2024", "Kim", "2024"),
    source("library2025", "Library", "2025"),
  ];
  const bibKeyToSourceId = Object.fromEntries(sources.map((item) => [item.citation_metadata.bibtex_key, item.id]));
  return {
    sources,
    texts: new Map(sources.map((item) => [item.id, ""])),
    retriever: retriever as unknown as HybridRetriever,
    judge,
    planner: new MockPlanner(),
    resolver: new CitationResolver(sources, bibKeyToSourceId),
  };
}

describe("analyzeParagraph", () => {
  it("derives claim statuses, evidence cards, risk notes, and summary counts by the Writing Desk precedence", async () => {
    const uncitedClaim = "Exercise improves memory.";
    const unresolvedClaim = "Mindfulness improves focus (Unknown, 2020).";
    const retriever = new FixtureRetriever(
      {
        smith2020: [hit("smith2020", "Screen-time records contradict a direct sleep-loss effect.")],
        doe2020: [hit("doe2020", "Phone use is associated with anxiety in the cohort.")],
        jones2021: [hit("jones2021", "Therapy improves sleep quality in the trial.")],
        brown2022: [hit("brown2022", "Diet is linked to energy in adjusted models.")],
        garcia2023: [hit("garcia2023", "The paper measured music exposure but reported no stress result.")],
        lee2024: [hit("lee2024", "Combined therapy was linked with retention.")],
        kim2024: [hit("kim2024", "Combined therapy improves retention across follow-up.")],
      },
      {
        [uncitedClaim]: [hit("library2025", "Exercise improves memory in a controlled task.")],
        [unresolvedClaim]: [hit("library2025", "Mindfulness improves focus in the library source.")],
      },
    );
    const judge = new ScriptedJudge({
      "Screen-time records contradict a direct sleep-loss effect.": "contradicts",
      "Phone use is associated with anxiety in the cohort.": "supports",
      "Therapy improves sleep quality in the trial.": "supports",
      "Diet is linked to energy in adjusted models.": "weakly_supports",
      "The paper measured music exposure but reported no stress result.": "unsupported",
      "Combined therapy was linked with retention.": "weakly_supports",
      "Combined therapy improves retention across follow-up.": "supports",
      "Exercise improves memory in a controlled task.": "supports",
      "Mindfulness improves focus in the library source.": "supports",
    });

    const report = await analyzeParagraph(
      [
        "Screen time causes sleep loss (Smith, 2020).",
        uncitedClaim,
        unresolvedClaim,
        "Phone use causes anxiety (Doe, 2020).",
        "Therapy improves sleep quality (Jones, 2021).",
        "Diet is linked to energy (Brown, 2022).",
        "Music affects stress (Garcia, 2023).",
        "Combined therapy improves retention (Lee, 2024) (Kim, 2024).",
      ].join(" "),
      context(retriever, judge),
    );

    expect(report.paragraphSummary).toEqual({
      supported: 2,
      weakly_supported: 1,
      needs_citation: 2,
      overclaimed: 1,
      contradicted: 1,
      unclear: 1,
    });
    expect(report.claims.map((claim) => claim.status)).toEqual([
      "contradicted",
      "needs_citation",
      "needs_citation",
      "overclaimed",
      "supported",
      "weakly_supported",
      "unclear",
      "supported",
    ]);

    const unresolved = report.claims[2]!;
    expect(unresolved.riskNotes.join(" ")).toMatch(/unresolved/i);
    expect(retriever.calls.some((call) => call.opts.sourceId === "(Unknown, 2020)")).toBe(false);

    const overclaimed = report.claims[3]!;
    expect(overclaimed.riskNotes.join(" ")).toMatch(/association/i);
    expect(overclaimed.localEvidence).toEqual([
      {
        sourceId: "doe2020",
        quote: "Phone use is associated with anxiety in the cohort.",
        verdict: "supports",
        locator: expect.objectContaining({ source_id: "doe2020" }),
      },
    ]);

    const multi = report.claims[7]!;
    expect(multi.status).toBe("supported");
    expect(multi.localEvidence.map((card) => [card.sourceId, card.verdict])).toEqual([
      ["lee2024", "weakly_supports"],
      ["kim2024", "supports"],
    ]);
  });

  it("skips judging non-factual claims and marks them unclear without evidence", async () => {
    const retriever = new FixtureRetriever({}, {});
    const report = await analyzeParagraph("Does this need evidence?", context(retriever, new ScriptedJudge({})));

    expect(report.claims).toHaveLength(1);
    expect(report.claims[0]).toMatchObject({ status: "unclear", localEvidence: [], riskNotes: [] });
    expect(retriever.calls).toEqual([]);
    expect(report.paragraphSummary).toEqual({
      supported: 0,
      weakly_supported: 0,
      needs_citation: 0,
      overclaimed: 0,
      contradicted: 0,
      unclear: 1,
    });
  });
});
