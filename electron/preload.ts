import { contextBridge, ipcRenderer } from "electron";

type PreloadVerdict = "supports" | "weakly_supports" | "unsupported" | "contradicts" | "unclear";

interface PreloadLocator {
  source_id: string;
  source_hash: string;
  char_start: number;
  char_end: number;
  page?: number;
  section: string;
  chunker_version: string;
}

interface PreloadMentionSupport {
  verdict: PreloadVerdict;
  locator: PreloadLocator;
  quote: string;
  reason: string;
  suggested_rewrite: string;
  confidence: number;
}

interface PreloadMentionAudit {
  raw_citation: string;
  char_start: number;
  char_end: number;
  status: "resolved" | "unresolved" | "ambiguous";
  source_id?: string;
  support?: PreloadMentionSupport;
  counterevidence_found?: boolean;
}

interface PreloadSentenceAudit {
  index: number;
  char_start: number;
  char_end: number;
  text: string;
  mentions: PreloadMentionAudit[];
}

interface PreloadDraftAudit {
  sentences: PreloadSentenceAudit[];
  traces: unknown[];
}

interface PreloadSourceSummary {
  id: string;
  title: string;
  year: string;
  type: string;
  doi?: string;
  referenceCount?: number;
}

interface PreloadEvalResult {
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

interface PreloadMatrixResult {
  dir: string;
  markdown: string;
}

interface PreloadSourceText {
  sourceId: string;
  text: string;
}

interface PreloadReference {
  title?: string;
  author?: string;
  year?: string;
  doi?: string;
}

type PreloadPlanRelation = "supports" | "contradicts" | "unrelated";

interface PreloadPlanFinding {
  source_id: string;
  subquery: string;
  snippet: string;
  locator: PreloadLocator;
  relation: PreloadPlanRelation;
  reason: string;
}

interface PreloadThesisVerdict {
  verdict: "supported" | "contested" | "refuted" | "insufficient";
  consensus: number;
  decisiveness: number;
  supporting: number;
  contradicting: number;
  mixed: number;
}

interface PreloadPlanCheckResult {
  thesis: string;
  subqueries: string[];
  findings: PreloadPlanFinding[];
  summary: { supporting_sources: string[]; contradicting_sources: string[] };
  thesis_verdict: PreloadThesisVerdict;
}

type PreloadWritingClaimStatus = "supported" | "weakly_supported" | "needs_citation" | "overclaimed" | "contradicted" | "unclear";

type PreloadWritingClaimType = "background" | "association" | "causal" | "comparison" | "method" | "limitation" | "definition";

interface PreloadWritingEvidenceCard {
  sourceId: string;
  quote: string;
  locator: PreloadLocator;
  verdict: PreloadVerdict;
}

interface PreloadAnalyzedClaim {
  id: string;
  text: string;
  sentenceIndex: number;
  claimType: PreloadWritingClaimType;
  citedKeys: string[];
  isFactual: boolean;
  status: PreloadWritingClaimStatus;
  localEvidence: PreloadWritingEvidenceCard[];
  riskNotes: string[];
  suggestedRewrite?: string;
}

interface PreloadWritingReport {
  input: string;
  claims: PreloadAnalyzedClaim[];
  paragraphSummary: Record<PreloadWritingClaimStatus, number>;
}

interface PreloadPlanStage {
  stage: string;
  detail: string;
}

interface PreloadAblationRow {
  label: string;
  macro_f1: number;
  answer_groundedness: number;
  overclaim_recall: number;
  retrieval_recall_at_k: number;
  outbound_chars: number;
}

interface PreloadAblationResult {
  rows: PreloadAblationRow[];
  mdPath: string;
  skipped: string[];
}

interface PreloadEmbedderConfig {
  provider: string;
  model?: string;
  baseURL?: string;
  dim?: number;
}

interface PreloadJudgeConfig {
  provider: string;
  model?: string;
  baseURL?: string;
}

interface PreloadPdfConfig {
  provider: string;
  baseURL?: string;
}

interface PreloadAppConfig {
  embedder: PreloadEmbedderConfig;
  judge: PreloadJudgeConfig;
  pdf: PreloadPdfConfig;
  corpus: string;
  library?: string;
  keyRef?: string;
  // Round-tripped untouched through the bridge; typed from the src schema so it stays in sync
  // with HarnessAppConfig (renderer) and a future field rename fails at compile time.
  externalResearch?: import("../src/providers/config.js").ExternalResearchConfig;
}

interface PreloadConfigApplied {
  type: "config_applied";
}

type PreloadModelStatus = "present" | "absent";

type PreloadExternalProviderId = "scite" | "consensus" | "consensus-mcp";

type PreloadReferenceExternalSignalRisk = "ok" | "needs_care" | "risky" | "blocked" | "unknown";

type PreloadExternalResearchCapability =
  | "paper_search"
  | "paper_metadata"
  | "full_text_excerpts"
  | "citation_contexts"
  | "citation_polarity"
  | "editorial_notices"
  | "study_snapshot"
  | "consensus_meter"
  | "reference_health";

interface PreloadReferenceExternalSignal {
  provider: string;
  doi?: string;
  supportCount?: number;
  pushbackCount?: number;
  mentionCount?: number;
  unclassifiedCount?: number;
  citingPublicationCount?: number;
  editorialNotices?: Array<{ status?: string; date?: string; noticeDoi?: string; urls?: string[] }>;
  retracted?: boolean;
  risk: PreloadReferenceExternalSignalRisk;
}

interface PreloadExternalPaper {
  provider: PreloadExternalProviderId;
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
  referenceSignal?: PreloadReferenceExternalSignal;
}

interface PreloadExternalEvidenceCard {
  provider: PreloadExternalProviderId;
  paper: PreloadExternalPaper;
  quote?: string;
  relation?: "supports" | "contradicts" | "mentions" | "unclear";
  section?: string;
  sourceDoi?: string;
  targetDoi?: string;
  editorialNotices?: Array<{ status?: string; date?: string; noticeDoi?: string; urls?: string[] }>;
  access?: { url?: string; source?: string; accessType?: string; contentType?: string; description?: string };
}

interface PreloadExternalProviderStatus {
  id: PreloadExternalProviderId;
  enabled: boolean;
  connected: boolean;
  capabilities: PreloadExternalResearchCapability[];
  message?: string;
}

interface PreloadExternalSearchResult {
  provider: PreloadExternalProviderId;
  papers: PreloadExternalPaper[];
  evidence: PreloadExternalEvidenceCard[];
}

contextBridge.exposeInMainWorld("harness", {
  auditDraft: (text: string): Promise<PreloadDraftAudit> => ipcRenderer.invoke("audit", text),
  listSources: (): Promise<PreloadSourceSummary[]> => ipcRenderer.invoke("list_sources"),
  listLibrary: (): Promise<PreloadSourceSummary[]> => ipcRenderer.invoke("list_library"),
  importPdf: (bytesBase64: string): Promise<{ source: PreloadSourceSummary; duplicate: boolean }> => ipcRenderer.invoke("import_pdf", bytesBase64),
  removeSource: (sourceId: string): Promise<void> => ipcRenderer.invoke("remove_source", sourceId),
  runEval: (): Promise<PreloadEvalResult> => ipcRenderer.invoke("run_eval"),
  runAblation: (): Promise<PreloadAblationResult> => ipcRenderer.invoke("run_ablation"),
  planAndCheck: (thesis: string): Promise<PreloadPlanCheckResult> => ipcRenderer.invoke("plan_and_check", thesis),
  analyzeParagraph: (paragraph: string): Promise<PreloadWritingReport> => ipcRenderer.invoke("analyze_paragraph", paragraph),
  externalProviderStatus: (): Promise<PreloadExternalProviderStatus[]> => ipcRenderer.invoke("external_provider_status"),
  oauthSignIn: (providerId: PreloadExternalProviderId): Promise<PreloadExternalProviderStatus> => ipcRenderer.invoke("oauth_sign_in", providerId),
  oauthDisconnect: (providerId: PreloadExternalProviderId): Promise<PreloadExternalProviderStatus> => ipcRenderer.invoke("oauth_disconnect", providerId),
  externalSearch: (providerId: PreloadExternalProviderId, query: string, opts?: Record<string, unknown>): Promise<PreloadExternalSearchResult> =>
    ipcRenderer.invoke("external_search", providerId, query, opts),
  libraryReferenceHealth: (dois: string[]): Promise<PreloadReferenceExternalSignal[]> => ipcRenderer.invoke("library_reference_health", dois),
  onPlanStage: (cb: (d: PreloadPlanStage) => void): (() => void) => {
    const h = (_event: Electron.IpcRendererEvent, d: PreloadPlanStage) => cb(d);
    ipcRenderer.on("plan-stage", h);
    return () => ipcRenderer.removeListener("plan-stage", h);
  },
  getSourceText: (sourceId: string): Promise<PreloadSourceText> => ipcRenderer.invoke("get_source_text", sourceId),
  getSourceReferences: (sourceId: string): Promise<PreloadReference[]> => ipcRenderer.invoke("get_source_references", sourceId),
  getConfig: (): Promise<PreloadAppConfig> => ipcRenderer.invoke("get_config"),
  setConfig: (config: PreloadAppConfig): Promise<PreloadConfigApplied> => ipcRenderer.invoke("set_config", config),
  setKey: (keyRef: string, key: string): Promise<void> => ipcRenderer.invoke("set_key", keyRef, key),
  modelStatus: (id: string): Promise<PreloadModelStatus> => ipcRenderer.invoke("model_status", id),
  downloadModel: (id: string): Promise<void> => ipcRenderer.invoke("download_model", id),
  buildMatrix: (outDir = "out/electron-matrix"): Promise<PreloadMatrixResult> => ipcRenderer.invoke("build_matrix", outDir),
});
