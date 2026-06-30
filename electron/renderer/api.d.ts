type HarnessVerdict = "supports" | "weakly_supports" | "unsupported" | "contradicts" | "unclear";

interface HarnessLocator {
  source_id: string;
  source_hash: string;
  char_start: number;
  char_end: number;
  page?: number;
  section: string;
  chunker_version: string;
}

interface HarnessMentionSupport {
  verdict: HarnessVerdict;
  locator: HarnessLocator;
  quote: string;
  reason: string;
  suggested_rewrite: string;
  confidence: number;
}

interface HarnessMentionAudit {
  raw_citation: string;
  char_start: number;
  char_end: number;
  status: "resolved" | "unresolved" | "ambiguous";
  source_id?: string;
  support?: HarnessMentionSupport;
  counterevidence_found?: boolean;
}

interface HarnessSentenceAudit {
  index: number;
  char_start: number;
  char_end: number;
  text: string;
  mentions: HarnessMentionAudit[];
}

interface HarnessDraftAudit {
  sentences: HarnessSentenceAudit[];
  traces: unknown[];
}

interface HarnessSourceSummary {
  id: string;
  title: string;
  year: string;
  type: string;
  doi?: string;
  referenceCount?: number;
}

interface HarnessEvalResult {
  macro_f1: number;
  answer_groundedness: number;
  policy_compliance: {
    grounded_locator_rate: number;
    snippet_only_rate: number;
    outbound_chars: number;
  };
  per_class: Record<string, { precision: number; recall: number; f1: number }>;
  confusion: Record<string, Record<string, number>>;
  failures: { claim: string; gold: string; pred: string; cited_source: string }[];
  trace_summary: {
    total: number;
    byEventType: Record<string, number>;
    models: string[];
    outbound_snippet_count: number;
  };
}

interface HarnessMatrixResult {
  dir: string;
  markdown: string;
}

interface HarnessSourceText {
  sourceId: string;
  text: string;
}

interface HarnessReference {
  title?: string;
  author?: string;
  year?: string;
  doi?: string;
}

type HarnessPlanRelation = "supports" | "contradicts" | "unrelated";

interface HarnessPlanFinding {
  source_id: string;
  subquery: string;
  snippet: string;
  locator: HarnessLocator;
  relation: HarnessPlanRelation;
  reason: string;
}

interface HarnessThesisVerdict {
  verdict: "supported" | "contested" | "refuted" | "insufficient";
  consensus: number;
  decisiveness: number;
  supporting: number;
  contradicting: number;
  mixed: number;
}

interface HarnessPlanCheckResult {
  thesis: string;
  subqueries: string[];
  findings: HarnessPlanFinding[];
  summary: { supporting_sources: string[]; contradicting_sources: string[] };
  thesis_verdict: HarnessThesisVerdict;
}

type HarnessWritingClaimStatus = "supported" | "weakly_supported" | "needs_citation" | "overclaimed" | "contradicted" | "unclear";

type HarnessWritingClaimType = "background" | "association" | "causal" | "comparison" | "method" | "limitation" | "definition";

interface HarnessWritingEvidenceCard {
  sourceId: string;
  quote: string;
  locator: HarnessLocator;
  verdict: HarnessVerdict;
}

interface HarnessAnalyzedClaim {
  id: string;
  text: string;
  sentenceIndex: number;
  claimType: HarnessWritingClaimType;
  citedKeys: string[];
  isFactual: boolean;
  status: HarnessWritingClaimStatus;
  localEvidence: HarnessWritingEvidenceCard[];
  riskNotes: string[];
  suggestedRewrite?: string;
}

interface HarnessWritingReport {
  input: string;
  claims: HarnessAnalyzedClaim[];
  paragraphSummary: Record<HarnessWritingClaimStatus, number>;
}

interface HarnessPlanStage {
  stage: string;
  detail: string;
}

interface HarnessAblationRow {
  label: string;
  macro_f1: number;
  answer_groundedness: number;
  overclaim_recall: number;
  retrieval_recall_at_k: number;
  outbound_chars: number;
}

interface HarnessAblationResult {
  rows: HarnessAblationRow[];
  mdPath: string;
  skipped: string[];
}

interface HarnessEmbedderConfig {
  provider: string;
  model?: string;
  baseURL?: string;
  dim?: number;
}

interface HarnessJudgeConfig {
  provider: string;
  model?: string;
  baseURL?: string;
}

interface HarnessPdfConfig {
  provider: string;
}

interface HarnessAppConfig {
  embedder: HarnessEmbedderConfig;
  judge: HarnessJudgeConfig;
  pdf: HarnessPdfConfig;
  corpus: string;
  keyRef?: string;
  // External-provider config is opaque to the renderer in Milestone B (round-tripped untouched; the
  // Settings UI for it lands in C). Referenced inline from the src type so it stays exactly in sync
  // without turning this ambient .d.ts into a module.
  externalResearch: import("../../src/providers/config.js").ExternalResearchConfig;
}

interface HarnessConfigApplied {
  type: "config_applied";
}

type HarnessModelStatus = "present" | "absent";

type HarnessExternalProviderId = import("../../src/external/types.js").ExternalProviderId;
type HarnessExternalPaper = import("../../src/external/types.js").ExternalPaper;
type HarnessExternalEvidenceCard = import("../../src/external/types.js").ExternalEvidenceCard;
type HarnessExternalProviderStatus = import("../../src/external/types.js").ExternalProviderStatus;
type HarnessExternalSearchResult = import("../../src/external/types.js").ExternalSearchResult;
type HarnessReferenceExternalSignal = import("../../src/external/types.js").ReferenceExternalSignal;

interface HarnessApi {
  auditDraft(text: string): Promise<HarnessDraftAudit>;
  listSources(): Promise<HarnessSourceSummary[]>;
  listLibrary(): Promise<HarnessSourceSummary[]>;
  importPdf(bytesBase64: string): Promise<{ source: HarnessSourceSummary; duplicate: boolean }>;
  removeSource(sourceId: string): Promise<void>;
  runEval(): Promise<HarnessEvalResult>;
  runAblation(): Promise<HarnessAblationResult>;
  planAndCheck(thesis: string): Promise<HarnessPlanCheckResult>;
  analyzeParagraph(paragraph: string): Promise<HarnessWritingReport>;
  externalProviderStatus(): Promise<HarnessExternalProviderStatus[]>;
  oauthSignIn(providerId: HarnessExternalProviderId): Promise<HarnessExternalProviderStatus>;
  oauthDisconnect(providerId: HarnessExternalProviderId): Promise<HarnessExternalProviderStatus>;
  externalSearch(providerId: HarnessExternalProviderId, query: string, opts?: Record<string, unknown>): Promise<HarnessExternalSearchResult>;
  libraryReferenceHealth(dois: string[]): Promise<HarnessReferenceExternalSignal[]>;
  onPlanStage(cb: (d: HarnessPlanStage) => void): () => void;
  getSourceText(sourceId: string): Promise<HarnessSourceText>;
  getSourceReferences(sourceId: string): Promise<HarnessReference[]>;
  buildMatrix(outDir?: string): Promise<HarnessMatrixResult>;
  getConfig(): Promise<HarnessAppConfig>;
  setConfig(config: HarnessAppConfig): Promise<HarnessConfigApplied>;
  setKey(keyRef: string, key: string): Promise<void>;
  modelStatus(id: string): Promise<HarnessModelStatus>;
  downloadModel(id: string): Promise<void>;
}

interface Window {
  harness: HarnessApi;
}
