import { checkClaim, type Locator } from "../check/check.js";
import type { ToolContext } from "../tools/tools.js";
import type { Verdict } from "../types.js";
import type { Chunk } from "../retrieve/types.js";
import { classifyClaimText, extractClaims, type WritingClaim } from "./claims.js";
import { suggestRewrite } from "./rewrite.js";

export type WritingClaimStatus = "supported" | "weakly_supported" | "needs_citation" | "overclaimed" | "contradicted" | "unclear";

export interface EvidenceCard {
  sourceId: string;
  quote: string;
  locator: Locator;
  verdict: Verdict;
}

export interface AnalyzedClaim extends WritingClaim {
  status: WritingClaimStatus;
  localEvidence: EvidenceCard[];
  riskNotes: string[];
  suggestedRewrite?: string;
}

export interface WritingDeskReport {
  input: string;
  claims: AnalyzedClaim[];
  paragraphSummary: {
    supported: number;
    weakly_supported: number;
    needs_citation: number;
    overclaimed: number;
    contradicted: number;
    unclear: number;
  };
}

type LibraryJudgment = { verdict: Verdict; quote: string; locator: Locator };

const STATUSES: readonly WritingClaimStatus[] = [
  "supported",
  "weakly_supported",
  "needs_citation",
  "overclaimed",
  "contradicted",
  "unclear",
];

function locatorFromChunk(chunk: Chunk): Locator {
  const locator: Locator = {
    source_id: chunk.source_id,
    source_hash: chunk.source_hash,
    char_start: chunk.char_start,
    char_end: chunk.char_end,
    section: chunk.section,
    chunker_version: chunk.chunker_version,
  };
  if (typeof chunk.page_start === "number") locator.page = chunk.page_start;
  return locator;
}

function evidenceCard(input: LibraryJudgment): EvidenceCard {
  return {
    sourceId: input.locator.source_id,
    quote: input.quote,
    locator: input.locator,
    verdict: input.verdict,
  };
}

function statusSummary(): WritingDeskReport["paragraphSummary"] {
  return {
    supported: 0,
    weakly_supported: 0,
    needs_citation: 0,
    overclaimed: 0,
    contradicted: 0,
    unclear: 0,
  };
}

function hasUsableCitation(claim: WritingClaim, resolvedSourceIds: string[]): boolean {
  return claim.citedKeys.length > 0 && resolvedSourceIds.length > 0;
}

function isAssociationOnlySupport(claim: WritingClaim, evidence: EvidenceCard[]): boolean {
  if (claim.claimType !== "causal") return false;
  const supporting = evidence.filter((card) => card.verdict === "supports" || card.verdict === "weakly_supports");
  if (supporting.length === 0) return false;
  return supporting.every((card) => classifyClaimText(card.quote) === "association");
}

function deriveStatus(claim: WritingClaim, evidence: EvidenceCard[], resolvedSourceIds: string[]): WritingClaimStatus {
  if (evidence.some((card) => card.verdict === "contradicts")) return "contradicted";
  if (claim.isFactual && !hasUsableCitation(claim, resolvedSourceIds)) return "needs_citation";
  if (isAssociationOnlySupport(claim, evidence)) return "overclaimed";
  if (evidence.some((card) => card.verdict === "supports")) return "supported";
  if (evidence.some((card) => card.verdict === "weakly_supports")) return "weakly_supported";
  return "unclear";
}

function unresolvedCitationNote(rawCitation: string, status: "unresolved" | "ambiguous"): string {
  return `Citation ${rawCitation} resolved as ${status}; it was not passed to checkClaim.`;
}

function withRewriteSuggestion(claim: AnalyzedClaim): AnalyzedClaim {
  const suggestion = suggestRewrite(claim);
  return {
    ...claim,
    ...(suggestion.suggestedRewrite ? { suggestedRewrite: suggestion.suggestedRewrite } : {}),
    riskNotes: suggestion.riskNote ? [...claim.riskNotes, suggestion.riskNote] : claim.riskNotes,
  };
}

export async function judgeClaimAgainstLibrary(claimText: string, ctx: ToolContext, k = 3): Promise<LibraryJudgment | undefined> {
  const hits = await ctx.retriever.retrieve(claimText, { k });
  const top = hits[0];
  if (!top) return undefined;
  const quote = top.chunk.text;
  const judgment = await ctx.judge.judge({ claim: claimText, snippet: quote });
  return {
    verdict: judgment.verdict,
    quote,
    locator: locatorFromChunk(top.chunk),
  };
}

export async function analyzeParagraph(paragraph: string, ctx: ToolContext): Promise<WritingDeskReport> {
  const analyzed: AnalyzedClaim[] = [];

  for (const claim of extractClaims(paragraph)) {
    const localEvidence: EvidenceCard[] = [];
    const riskNotes: string[] = [];

    if (!claim.isFactual) {
      analyzed.push(withRewriteSuggestion({ ...claim, status: "unclear", localEvidence, riskNotes }));
      continue;
    }

    const resolvedSourceIds: string[] = [];
    for (const rawCitation of claim.citedKeys) {
      const resolution = ctx.resolver.resolve(rawCitation);
      if (resolution.status === "resolved") {
        if (resolution.source_id) {
          resolvedSourceIds.push(resolution.source_id);
        } else {
          riskNotes.push(`Citation ${rawCitation} resolved without a source id; it was not passed to checkClaim.`);
        }
      } else {
        riskNotes.push(unresolvedCitationNote(rawCitation, resolution.status));
      }
    }

    if (claim.citedKeys.length === 0) {
      riskNotes.push("Factual claim has no inline citation.");
    }

    if (resolvedSourceIds.length > 0) {
      for (const sourceId of resolvedSourceIds) {
        const check = await checkClaim({ claim: claim.text, cited_source: sourceId }, ctx.retriever, ctx.judge);
        localEvidence.push(evidenceCard(check.cited_source_support));
      }
    } else {
      const libraryJudgment = await judgeClaimAgainstLibrary(claim.text, ctx);
      if (libraryJudgment) localEvidence.push(evidenceCard(libraryJudgment));
    }

    const status = deriveStatus(claim, localEvidence, resolvedSourceIds);
    if (status === "overclaimed") {
      riskNotes.push("Causal claim is supported only by association-typed evidence; treat this as a heuristic overclaim risk, not a hard verdict.");
    }

    analyzed.push(withRewriteSuggestion({ ...claim, status, localEvidence, riskNotes }));
  }

  const paragraphSummary = statusSummary();
  for (const claim of analyzed) {
    paragraphSummary[claim.status]++;
  }
  for (const status of STATUSES) {
    paragraphSummary[status] = paragraphSummary[status] ?? 0;
  }

  return {
    input: paragraph,
    claims: analyzed,
    paragraphSummary,
  };
}
