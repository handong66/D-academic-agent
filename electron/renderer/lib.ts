import type { CSSProperties } from "react";
import type { ExternalEvidenceCard, ExternalPaper, ExternalSearchResult, ReferenceExternalSignal } from "../../src/external/types.js";

export function judgeLabel(provider: string): string {
  if (provider === "transformers-nli") return "settings.judge.nliLocal";
  if (provider === "openai-compatible") return "settings.judge.cloudOllama";
  if (provider === "mock") return "settings.judge.mock";
  return provider;
}

export function friendlyErrorMessage(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("worker is not running") || normalized.includes("worker exited")) {
    return t("error.checkerStopped");
  }

  if (normalized.includes("network") || normalized.includes("fetch failed") || normalized.includes("econnrefused")) {
    return t("error.connectionFailed");
  }

  if (normalized.includes("unknown local model")) {
    return t("error.localModelUnknown");
  }

  return `${t("error.unexpectedPrefix")} ${message}`;
}

export type ProviderChoiceKind = "embedder" | "judge" | "pdf";
export type ModelChoiceKind = "embedder" | "judge";

const providerChoiceKeys: Record<ProviderChoiceKind, Record<string, { label: string; help: string }>> = {
  embedder: {
    hash: { label: "settings.choice.embedder.hash.label", help: "settings.choice.embedder.hash.help" },
    "transformers-local": {
      label: "settings.choice.embedder.local.label",
      help: "settings.choice.embedder.local.help",
    },
    "openai-compatible": {
      label: "settings.choice.embedder.openaiCompatible.label",
      help: "settings.choice.embedder.openaiCompatible.help",
    },
  },
  judge: {
    mock: { label: "settings.choice.judge.mock.label", help: "settings.choice.judge.mock.help" },
    "transformers-nli": { label: "settings.choice.judge.nli.label", help: "settings.choice.judge.nli.help" },
    "openai-compatible": {
      label: "settings.choice.judge.openaiCompatible.label",
      help: "settings.choice.judge.openaiCompatible.help",
    },
  },
  pdf: {
    unpdf: { label: "settings.choice.pdf.unpdf.label", help: "settings.choice.pdf.unpdf.help" },
    grobid: { label: "settings.choice.pdf.grobid.label", help: "settings.choice.pdf.grobid.help" },
  },
};

const modelChoiceKeys: Record<ModelChoiceKind, Record<string, { label: string; help: string }>> = {
  embedder: {
    "all-MiniLM-L6-v2": {
      label: "settings.model.embedder.allMiniLM.label",
      help: "settings.model.embedder.allMiniLM.help",
    },
    "bge-small-en-v1.5": {
      label: "settings.model.embedder.bgeSmall.label",
      help: "settings.model.embedder.bgeSmall.help",
    },
    "nomic-embed-text-v1.5": {
      label: "settings.model.embedder.nomic.label",
      help: "settings.model.embedder.nomic.help",
    },
  },
  judge: {
    "nli-deberta-v3-xsmall": {
      label: "settings.model.judge.nliDeberta.label",
      help: "settings.model.judge.nliDeberta.help",
    },
  },
};

export function providerChoiceLabelKey(kind: ProviderChoiceKind, provider: string): string {
  return providerChoiceKeys[kind][provider]?.label ?? provider;
}

export function providerChoiceHelpKey(kind: ProviderChoiceKind, provider: string): string {
  return providerChoiceKeys[kind][provider]?.help ?? "settings.choice.unknown.help";
}

export function modelChoiceLabelKey(kind: ModelChoiceKind, model: string): string {
  return modelChoiceKeys[kind][model]?.label ?? model;
}

export function modelChoiceHelpKey(kind: ModelChoiceKind, model: string): string {
  return modelChoiceKeys[kind][model]?.help ?? "settings.model.unknown.help";
}

export function confidencePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function num(value: number): string {
  return value.toFixed(2);
}

export function formatLocator(locator: { source_id: string; section: string; char_start: number; char_end: number }): string {
  const source = locator.source_id || "unknown-source";
  const range = `${locator.char_start}-${locator.char_end}`;
  return `${source} · ${locator.section} · chars ${range}`;
}

export function representative(
  findings: Array<{ source_id: string; relation: string; [key: string]: unknown }>,
  sourceId: string,
  relation: string,
): { source_id: string; relation: string; [key: string]: unknown } | undefined {
  return findings.find((finding) => finding.source_id === sourceId && finding.relation === relation);
}

export const VERDICT_LABEL: Record<"supported" | "contested" | "refuted" | "insufficient", string> = {
  supported: "verdict.thesis.supported",
  contested: "verdict.thesis.contested",
  refuted: "verdict.thesis.refuted",
  insufficient: "verdict.thesis.insufficient",
};

export const VERDICT_BLURB: Record<"supported" | "contested" | "refuted" | "insufficient", string> = {
  supported: "verdict.thesis.supportedBlurb",
  contested: "verdict.thesis.contestedBlurb",
  refuted: "verdict.thesis.refutedBlurb",
  insufficient: "verdict.thesis.insufficientBlurb",
};

export const verdictLabels: Record<string, string> = {
  supports: "verdict.claim.supports",
  weakly_supports: "verdict.claim.weaklySupports",
  unsupported: "verdict.claim.unsupported",
  contradicts: "verdict.claim.contradicts",
  unclear: "verdict.claim.unclear",
};

export type ReferenceRiskTone = "ok" | "warn" | "risk" | "danger" | "muted";
export type ReferenceSignal = ReferenceExternalSignal;
type ReferenceNotice = NonNullable<ReferenceSignal["editorialNotices"]>[number];

const unknownReferenceRiskLabelKey = "library.refhealth.risk.unknown";
const unknownReferenceRiskTone: ReferenceRiskTone = "muted";

const referenceRiskLabelKeys: Record<string, string> = {
  ok: "library.refhealth.risk.ok",
  needs_care: "library.refhealth.risk.needs_care",
  risky: "library.refhealth.risk.risky",
  blocked: "library.refhealth.risk.blocked",
  unknown: unknownReferenceRiskLabelKey,
};

const referenceRiskTones: Record<string, ReferenceRiskTone> = {
  ok: "ok",
  needs_care: "warn",
  risky: "risk",
  blocked: "danger",
  unknown: unknownReferenceRiskTone,
};

export function referenceRiskLabelKey(risk: string): string {
  return referenceRiskLabelKeys[risk] ?? unknownReferenceRiskLabelKey;
}

export function referenceRiskTone(risk: string): ReferenceRiskTone {
  return referenceRiskTones[risk] ?? unknownReferenceRiskTone;
}

// Which providers support the external_search flow (the REST search adapters in provider-factory).
// consensus-mcp is an OAuth MCP-connection provider, NOT a REST search provider — exclude it from the
// search-provider selectors so the worker never gets an external_search it would reject.
const EXTERNAL_SEARCH_PROVIDER_IDS = new Set(["scite", "consensus"]);

export function isExternalSearchProvider(id: string): boolean {
  return EXTERNAL_SEARCH_PROVIDER_IDS.has(id);
}

export const referenceHealthStyles: Record<string, CSSProperties> = {
  referenceHealth: {
    marginTop: 10,
    padding: 10,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
  },
  referenceHealthHead: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  referenceCounts: {
    marginTop: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  },
  referenceNotice: {
    margin: "8px 0 0",
    padding: "8px 10px",
    border: "1px solid var(--warn-line)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12,
  },
  referenceNoticeBlocked: {
    margin: "8px 0 0",
    padding: "8px 10px",
    border: "1px solid var(--danger-line)",
    background: "var(--danger-bg)",
    color: "var(--danger)",
    fontSize: 12,
    fontWeight: 700,
  },
  referenceHealthActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  referenceHealthActionGroup: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  referenceHealthNote: {
    margin: 0,
    padding: "8px 10px",
  },
  referenceHealthCell: {
    display: "grid",
    gap: 6,
    minWidth: 170,
  },
  referenceHealthBadges: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  referenceHealthDoi: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  },
};

export const referenceRiskBadgeStyles: Record<ReferenceRiskTone, CSSProperties> = {
  ok: {
    border: "1px solid var(--support-line)",
    background: "var(--support-bg)",
    color: "var(--support)",
  },
  warn: {
    border: "1px solid var(--warn-line)",
    background: "var(--warn-bg)",
    color: "var(--warn)",
  },
  risk: {
    border: "1px solid var(--contra-line)",
    background: "var(--contra-bg)",
    color: "var(--contra)",
  },
  danger: {
    border: "1px solid var(--danger-line)",
    background: "var(--danger-bg)",
    color: "var(--danger)",
  },
  muted: {
    border: "1px solid var(--line-strong)",
    background: "var(--slate-bg)",
    color: "var(--slate)",
  },
};

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function normalizeDoi(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
}

export function doiHref(doi: string): string {
  return `https://doi.org/${normalizeDoi(doi)}`;
}

export function paperKey(paper: ExternalPaper, index: number): string {
  return paper.providerPaperId ?? paper.doi ?? `${paper.provider}-${paper.title}-${index}`;
}

export function samePaper(a: ExternalPaper, b: ExternalPaper): boolean {
  if (a.provider !== b.provider) return false;
  if (a.doi && b.doi && normalizeDoi(a.doi).toLowerCase() === normalizeDoi(b.doi).toLowerCase()) return true;
  if (a.providerPaperId && b.providerPaperId && a.providerPaperId === b.providerPaperId) return true;
  return a.title === b.title;
}

export function evidenceForPaper(
  result: ExternalSearchResult,
  paper: ExternalPaper,
  index: number,
): ExternalEvidenceCard | undefined {
  return result.evidence.find((evidence) => samePaper(evidence.paper, paper)) ?? result.evidence[index];
}

export function referenceHealthKey(doi: string): string {
  return normalizeDoi(doi).toLowerCase();
}

export function referenceRiskBadgeClass(tone: ReferenceRiskTone): string {
  return tone === "muted" ? "muted-badge" : "verdict";
}

function hasReferenceCounts(signal: ReferenceSignal): boolean {
  return (
    typeof signal.supportCount === "number" ||
    typeof signal.pushbackCount === "number" ||
    typeof signal.mentionCount === "number"
  );
}

export function referenceCountsText(signal: ReferenceSignal, t: (key: string) => string): string | null {
  if (!hasReferenceCounts(signal)) return null;

  return interpolate(t("library.refhealth.counts"), {
    supporting: `${signal.supportCount ?? 0} ${t("library.refhealth.supporting")}`,
    contradicting: `${signal.pushbackCount ?? 0} ${t("library.refhealth.contradicting")}`,
    mentioning: `${signal.mentionCount ?? 0} ${t("library.refhealth.mentioning")}`,
  });
}

export function referenceNoticeLabel(status: string | undefined, t: (key: string) => string): string {
  const trimmed = status?.trim();
  if (!trimmed) return t("library.refhealth.notice");
  if (/retract/i.test(trimmed)) return t("library.refhealth.retraction");
  if (/concern/i.test(trimmed)) return t("library.refhealth.concern");
  return trimmed.replace(/_/g, " ");
}

export function referenceNoticeText(notice: ReferenceNotice, t: (key: string) => string): string {
  const label = referenceNoticeLabel(notice.status, t);
  return notice.date ? `${label} · ${notice.date}` : label;
}

export function signalsByDoi(signals: ReferenceSignal[]): Map<string, ReferenceSignal> {
  const byDoi = new Map<string, ReferenceSignal>();
  for (const signal of signals) {
    if (signal.doi) byDoi.set(referenceHealthKey(signal.doi), signal);
  }
  return byDoi;
}

const traceEventLabels: Record<string, string> = {
  retrieve_cited: "eval.trace.retrieveCited",
  judge_cited: "eval.trace.checkCited",
  retrieve_counter: "eval.trace.retrieveCounter",
  judge_counter: "eval.trace.checkCounter",
  planner_plan: "eval.trace.planSearches",
  plan_retrieve: "eval.trace.retrievePlanned",
  plan_judge: "eval.trace.checkPlanned",
  search_sources: "eval.trace.searchSources",
  get_fulltext: "eval.trace.openSource",
  extract_citations: "eval.trace.extractCitations",
};

export function resultTypeLabelKey(label: string): string {
  return verdictLabels[label] ?? label;
}

export function traceEventLabelKey(eventType: string): string {
  return traceEventLabels[eventType] ?? eventType;
}

export function verdictClass(verdict: string): string {
  return `verdict verdict-${verdict.replace("_", "-")}`;
}

export function citationStatusLabel(status: string): string {
  if (status === "ambiguous") return "verdict.citation.ambiguous";
  if (status === "unresolved") return "verdict.citation.unresolved";
  return "verdict.citation.resolved";
}

export interface StageDetailLabels {
  running: string;
  empty: string;
  subqueries: string;
  evidence: string;
  judged: string;
  done: string;
}

export function stageDetailText(
  loading: boolean,
  result: { subqueries: string[]; findings: unknown[] } | null,
  key: string,
  verdictLabel: string | undefined,
  labels: StageDetailLabels,
): string {
  if (loading) return labels.running;
  if (!result) return labels.empty;
  if (key === "plan") return `${result.subqueries.length} ${labels.subqueries}`;
  if (key === "retrieve") return `${result.findings.length} ${labels.evidence}`;
  if (key === "judge") return `${result.findings.length} ${labels.judged}`;
  return verdictLabel ?? labels.done;
}
