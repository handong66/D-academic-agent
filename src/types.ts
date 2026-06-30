export interface CitationMetadata {
  bibtex_key: string;
  doi?: string;
  raw?: Record<string, unknown>;
}

export interface Source {
  id: string;
  title: string;
  authors: string[]; // surnames in order
  year: string;
  type: "scholarly_article" | "book" | "webpage" | "lecture_note" | "pdf" | "other";
  path_or_url: string;
  source_hash: string;
  citation_metadata: CitationMetadata; // spec §4
  fulltext_status: "unavailable" | "extracted" | "indexed";
}

export interface CitationMention {
  draft_sentence_id: string;
  char_start: number; // citation span in draft (was "CitationSpan")
  char_end: number;
  raw_citation: string;
  resolved_source_id?: string; // AUTHORITATIVE binding
  resolution_status: "resolved" | "unresolved" | "ambiguous";
}

export interface ClaimCitationPair {
  claim_id: string;
  citation_mention_id: string;
  source_id: string;
}

// §4 invariant as an executable guard (gates-over-memory): only resolved mentions form pairs,
// and pair.source_id is a copy of the authoritative resolved_source_id.
export function makeClaimCitationPair(
  claim_id: string,
  citation_mention_id: string,
  mention: CitationMention,
): ClaimCitationPair {
  if (mention.resolution_status !== "resolved" || !mention.resolved_source_id) {
    throw new Error(
      `HARNESS-§4-PAIR-INVARIANT: cannot form ClaimCitationPair from a non-resolved mention (${mention.raw_citation})`,
    );
  }
  return { claim_id, citation_mention_id, source_id: mention.resolved_source_id };
}

export const VERDICTS = ["supports", "weakly_supports", "unsupported", "contradicts", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];
export function isVerdict(x: unknown): x is Verdict {
  return typeof x === "string" && (VERDICTS as readonly string[]).includes(x);
}
