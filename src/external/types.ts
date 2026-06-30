import { z } from "zod";

export type ExternalProviderId = "scite" | "consensus" | "consensus-mcp";

export type ExternalResearchCapability =
  | "paper_search"
  | "paper_metadata"
  | "full_text_excerpts"
  | "citation_contexts"
  | "citation_polarity"
  | "editorial_notices"
  | "study_snapshot"
  | "consensus_meter"
  | "reference_health";

export interface ExternalPaper {
  provider: ExternalProviderId;
  providerPaperId?: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  abstract?: string;
  url?: string;
  citationCount?: number;
  qualitySignals?: Record<string, unknown>;
  referenceSignal?: ReferenceExternalSignal;
}

export interface ExternalEvidenceCard {
  provider: ExternalProviderId;
  paper: ExternalPaper;
  quote?: string;
  relation?: "supports" | "contradicts" | "mentions" | "unclear";
  section?: string;
  sourceDoi?: string;
  targetDoi?: string;
  editorialNotices?: Array<{ status?: string; date?: string; noticeDoi?: string; urls?: string[] }>;
  access?: { url?: string; source?: string; accessType?: string; contentType?: string; description?: string };
}

const optionalNullableString = z.string().nullish().transform((value) => value ?? undefined);
const optionalNullableInteger = z.number().int().nonnegative().nullish().transform((value) => value ?? undefined);

export const SciteTallySchema = z.object({
  total: z.number().int().nonnegative(),
  supporting: z.number().int().nonnegative(),
  contradicting: z.number().int().nonnegative(),
  mentioning: z.number().int().nonnegative(),
  unclassified: z.number().int().nonnegative(),
  doi: optionalNullableString,
  citingPublications: optionalNullableInteger,
});

export type SciteTally = z.infer<typeof SciteTallySchema>;

export type ReferenceExternalSignalRisk = "ok" | "needs_care" | "risky" | "blocked" | "unknown";

export interface ReferenceEditorialNotice {
  status?: string;
  date?: string;
  noticeDoi?: string;
  urls?: string[];
}

export interface ReferenceExternalSignal {
  provider: ExternalProviderId;
  doi?: string;
  supportCount?: number;
  pushbackCount?: number;
  mentionCount?: number;
  unclassifiedCount?: number;
  citingPublicationCount?: number;
  editorialNotices?: ReferenceEditorialNotice[];
  retracted?: boolean;
  risk: ReferenceExternalSignalRisk;
}

export interface ExternalProviderStatus {
  id: ExternalProviderId;
  enabled: boolean;
  connected: boolean;
  capabilities: ExternalResearchCapability[];
  message?: string;
}

export interface ExternalSearchResult {
  provider: ExternalProviderId;
  papers: ExternalPaper[];
  evidence: ExternalEvidenceCard[];
}

export interface OutboundRequest {
  provider: ExternalProviderId;
  tool: string;
  query: string;
}
