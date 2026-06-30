import { describe, expect, it } from "vitest";
import type { ExternalEvidenceCard, ExternalPaper, ExternalSearchResult } from "../src/external/types.js";
import {
  VERDICT_BLURB,
  VERDICT_LABEL,
  citationStatusLabel,
  confidencePercent,
  doiHref,
  evidenceForPaper,
  friendlyErrorMessage,
  formatLocator,
  interpolate,
  isExternalSearchProvider,
  judgeLabel,
  modelChoiceHelpKey,
  modelChoiceLabelKey,
  normalizeDoi,
  num,
  paperKey,
  providerChoiceHelpKey,
  providerChoiceLabelKey,
  referenceCountsText,
  referenceHealthKey,
  referenceNoticeLabel,
  referenceNoticeText,
  referenceRiskBadgeClass,
  referenceRiskLabelKey,
  referenceRiskTone,
  representative,
  resultTypeLabelKey,
  samePaper,
  signalsByDoi,
  stageDetailText,
  traceEventLabelKey,
  verdictClass,
  verdictLabels,
} from "../electron/renderer/lib.js";

const idT = (key: string): string => key;

function makeExternalPaper(overrides: Partial<ExternalPaper> = {}): ExternalPaper {
  return {
    provider: "scite",
    title: "Example paper",
    authors: ["Ada Lovelace"],
    ...overrides,
  };
}

function makeExternalEvidence(paper: ExternalPaper, quote = "External quote"): ExternalEvidenceCard {
  return {
    provider: paper.provider,
    paper,
    quote,
  };
}

function makeExternalSearchResult(evidence: ExternalEvidenceCard[]): ExternalSearchResult {
  return {
    provider: "scite",
    papers: [],
    evidence,
  };
}

describe("renderer pure logic", () => {
  it("labels judge providers", () => {
    expect(judgeLabel("transformers-nli")).toBe("settings.judge.nliLocal");
    expect(judgeLabel("openai-compatible")).toBe("settings.judge.cloudOllama");
    expect(judgeLabel("mock")).toBe("settings.judge.mock");
    expect(judgeLabel("custom-provider")).toBe("custom-provider");
  });

  it("maps provider choices to user-facing labels and guidance", () => {
    expect(providerChoiceLabelKey("judge", "mock")).toBe("settings.choice.judge.mock.label");
    expect(providerChoiceHelpKey("judge", "mock")).toBe("settings.choice.judge.mock.help");
    expect(providerChoiceLabelKey("judge", "transformers-nli")).toBe("settings.choice.judge.nli.label");
    expect(providerChoiceHelpKey("judge", "transformers-nli")).toBe("settings.choice.judge.nli.help");
    expect(providerChoiceLabelKey("embedder", "hash")).toBe("settings.choice.embedder.hash.label");
    expect(providerChoiceHelpKey("embedder", "hash")).toBe("settings.choice.embedder.hash.help");
    expect(providerChoiceLabelKey("pdf", "grobid")).toBe("settings.choice.pdf.grobid.label");
    expect(providerChoiceHelpKey("pdf", "grobid")).toBe("settings.choice.pdf.grobid.help");
    expect(providerChoiceLabelKey("judge", "custom-provider")).toBe("custom-provider");
    expect(providerChoiceHelpKey("judge", "custom-provider")).toBe("settings.choice.unknown.help");
  });

  it("maps local model choices to user-facing labels and guidance", () => {
    expect(modelChoiceLabelKey("embedder", "all-MiniLM-L6-v2")).toBe("settings.model.embedder.allMiniLM.label");
    expect(modelChoiceHelpKey("embedder", "all-MiniLM-L6-v2")).toBe("settings.model.embedder.allMiniLM.help");
    expect(modelChoiceLabelKey("embedder", "bge-small-en-v1.5")).toBe("settings.model.embedder.bgeSmall.label");
    expect(modelChoiceHelpKey("embedder", "nomic-embed-text-v1.5")).toBe("settings.model.embedder.nomic.help");
    expect(modelChoiceLabelKey("judge", "nli-deberta-v3-xsmall")).toBe("settings.model.judge.nliDeberta.label");
    expect(modelChoiceHelpKey("judge", "nli-deberta-v3-xsmall")).toBe("settings.model.judge.nliDeberta.help");
    expect(modelChoiceLabelKey("embedder", "custom-model")).toBe("custom-model");
    expect(modelChoiceHelpKey("embedder", "custom-model")).toBe("settings.model.unknown.help");
  });

  it("formats confidence values as clamped percentages", () => {
    expect(confidencePercent(0.6)).toBe(60);
    expect(confidencePercent(150)).toBe(100);
    expect(confidencePercent(Number.NaN)).toBe(0);
    expect(confidencePercent(-1)).toBe(0);
  });

  it("formats numeric metrics", () => {
    expect(num(0.6)).toBe("0.60");
  });

  it("maps internal errors to user-facing messages", () => {
    const t = (key: string) => `translated:${key}`;

    expect(friendlyErrorMessage(new Error("worker is not running"), t)).toBe("translated:error.checkerStopped");
    expect(friendlyErrorMessage(new Error("fetch failed"), t)).toBe("translated:error.connectionFailed");
    expect(friendlyErrorMessage(new Error("Unknown local model: x"), t)).toBe("translated:error.localModelUnknown");
    expect(friendlyErrorMessage(new Error("boom"), t)).toBe("translated:error.unexpectedPrefix boom");
  });

  it("formats source locators", () => {
    expect(formatLocator({ source_id: "smith-2024", section: "abstract", char_start: 12, char_end: 34 })).toBe(
      "smith-2024 · abstract · chars 12-34",
    );
  });

  it("finds representative evidence by source and relation", () => {
    const findings = [
      { source_id: "source-a", relation: "supports", rank: 1 },
      { source_id: "source-a", relation: "contradicts", rank: 2 },
    ];

    expect(representative(findings, "source-a", "contradicts")).toEqual({
      source_id: "source-a",
      relation: "contradicts",
      rank: 2,
    });
    expect(representative(findings, "source-b", "supports")).toBeUndefined();
  });

  it("exposes thesis verdict labels and blurbs", () => {
    expect(VERDICT_LABEL).toEqual({
      supported: "verdict.thesis.supported",
      contested: "verdict.thesis.contested",
      refuted: "verdict.thesis.refuted",
      insufficient: "verdict.thesis.insufficient",
    });
    expect(VERDICT_BLURB).toEqual({
      supported: "verdict.thesis.supportedBlurb",
      contested: "verdict.thesis.contestedBlurb",
      refuted: "verdict.thesis.refutedBlurb",
      insufficient: "verdict.thesis.insufficientBlurb",
    });
  });

  it("exposes claim verdict labels and classes", () => {
    expect(verdictLabels).toEqual({
      supports: "verdict.claim.supports",
      weakly_supports: "verdict.claim.weaklySupports",
      unsupported: "verdict.claim.unsupported",
      contradicts: "verdict.claim.contradicts",
      unclear: "verdict.claim.unclear",
    });
    expect(verdictClass("weakly_supports")).toBe("verdict verdict-weakly-supports");
  });

  it("maps raw eval labels and trace events to user-facing labels", () => {
    expect(resultTypeLabelKey("supports")).toBe("verdict.claim.supports");
    expect(resultTypeLabelKey("custom")).toBe("custom");
    expect(traceEventLabelKey("judge_cited")).toBe("eval.trace.checkCited");
    expect(traceEventLabelKey("custom_event")).toBe("custom_event");
  });

  it("labels citation statuses", () => {
    expect(citationStatusLabel("ambiguous")).toBe("verdict.citation.ambiguous");
    expect(citationStatusLabel("unresolved")).toBe("verdict.citation.unresolved");
    expect(citationStatusLabel("resolved")).toBe("verdict.citation.resolved");
  });

  it("maps reference-health risks to labels and tones", () => {
    const cases = [
      ["ok", "library.refhealth.risk.ok", "ok"],
      ["needs_care", "library.refhealth.risk.needs_care", "warn"],
      ["risky", "library.refhealth.risk.risky", "risk"],
      ["blocked", "library.refhealth.risk.blocked", "danger"],
      ["unknown", "library.refhealth.risk.unknown", "muted"],
    ] as const;

    for (const [risk, labelKey, tone] of cases) {
      expect(referenceRiskLabelKey(risk)).toBe(labelKey);
      expect(referenceRiskTone(risk)).toBe(tone);
    }
  });

  it("describes stage detail text", () => {
    const result = { subqueries: ["a", "b"], findings: [{}, {}, {}] };
    const labels = {
      running: "running…",
      empty: "—",
      subqueries: "subqueries",
      evidence: "evidence",
      judged: "judged",
      done: "done",
    };

    expect(stageDetailText(true, result, "plan", "Supported", labels)).toBe("running…");
    expect(stageDetailText(false, null, "plan", "Supported", labels)).toBe("—");
    expect(stageDetailText(false, result, "plan", "Supported", labels)).toBe("2 subqueries");
    expect(stageDetailText(false, result, "retrieve", "Supported", labels)).toBe("3 evidence");
    expect(stageDetailText(false, result, "judge", "Supported", labels)).toBe("3 judged");
    expect(stageDetailText(false, result, "report", "Supported", labels)).toBe("Supported");
    expect(stageDetailText(false, result, "report", undefined, labels)).toBe("done");
  });
});

describe("reference-health shared helpers (lifted in G2)", () => {
  it("interpolates single and double braces, leaves unknown keys", () => {
    expect(interpolate("{a} and {{b}}", { a: "X", b: 2 })).toBe("X and 2");
    expect(interpolate("keep {missing}", {})).toBe("keep {missing}");
  });

  it("normalizes and links DOIs", () => {
    expect(normalizeDoi("  https://doi.org/10.1/x  ")).toBe("10.1/x");
    expect(normalizeDoi("https://dx.doi.org/10.2/Y")).toBe("10.2/Y");
    expect(normalizeDoi("10.3/z")).toBe("10.3/z");
    expect(doiHref("10.1/x")).toBe("https://doi.org/10.1/x");
    expect(doiHref("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    expect(referenceHealthKey("https://doi.org/10.1/ABC")).toBe("10.1/abc");
  });

  it("maps risk tone to a badge class", () => {
    expect(referenceRiskBadgeClass("muted")).toBe("muted-badge");
    expect(referenceRiskBadgeClass("danger")).toBe("verdict");
  });

  it("labels editorial notices by status", () => {
    expect(referenceNoticeLabel("retraction_notice", idT)).toBe("library.refhealth.retraction");
    expect(referenceNoticeLabel("Expression of concern", idT)).toBe("library.refhealth.concern");
    expect(referenceNoticeLabel("", idT)).toBe("library.refhealth.notice");
    expect(referenceNoticeLabel("editorial_correction", idT)).toBe("editorial correction");
    expect(referenceNoticeText({ status: "retraction_notice", date: "2021-03-15" }, idT)).toBe(
      "library.refhealth.retraction · 2021-03-15",
    );
    expect(referenceNoticeText({ status: "retraction_notice" }, idT)).toBe("library.refhealth.retraction");
  });

  it("renders counts only when present", () => {
    expect(referenceCountsText({ provider: "scite", risk: "ok", supportCount: 5 }, idT)).not.toBeNull();
    expect(referenceCountsText({ provider: "scite", risk: "unknown" }, idT)).toBeNull();
  });

  it("treats only scite + consensus (REST) as external_search providers, not consensus-mcp", () => {
    expect(isExternalSearchProvider("scite")).toBe(true);
    expect(isExternalSearchProvider("consensus")).toBe(true);
    expect(isExternalSearchProvider("consensus-mcp")).toBe(false);
    expect(isExternalSearchProvider("anything-else")).toBe(false);
  });

  it("keys signals by normalized DOI and skips DOI-less signals", () => {
    const map = signalsByDoi([
      { provider: "scite", risk: "blocked", doi: "https://doi.org/10.1/A" },
      { provider: "scite", risk: "ok", doi: "10.1/a" },
      { provider: "scite", risk: "ok" },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("10.1/a")?.risk).toBe("ok");
  });
});

describe("external paper result helpers", () => {
  it("keys external papers by provider id, DOI, or fallback identity", () => {
    expect(paperKey(makeExternalPaper({ providerPaperId: "scite:123", doi: "10.1/example" }), 0)).toBe("scite:123");
    expect(paperKey(makeExternalPaper({ doi: "10.2/example" }), 1)).toBe("10.2/example");
    expect(paperKey(makeExternalPaper({ provider: "consensus", title: "Untitled" }), 2)).toBe("consensus-Untitled-2");
  });

  it("matches external papers by provider paper id within a provider", () => {
    const target = makeExternalPaper({ providerPaperId: "paper-1", title: "Target" });
    const sameProviderId = makeExternalPaper({ providerPaperId: "paper-1", title: "Different title" });
    const differentProvider = makeExternalPaper({ provider: "consensus", providerPaperId: "paper-1", title: "Target" });

    expect(samePaper(target, sameProviderId)).toBe(true);
    expect(samePaper(target, differentProvider)).toBe(false);
  });

  it("matches external evidence by normalized DOI before falling back to index", () => {
    const target = makeExternalPaper({ doi: "https://doi.org/10.1000/ABC", title: "Target" });
    const indexedEvidence = makeExternalEvidence(makeExternalPaper({ doi: "10.2000/index", title: "Indexed only" }), "index quote");
    const doiEvidence = makeExternalEvidence(makeExternalPaper({ doi: "10.1000/abc", title: "DOI match" }), "doi quote");
    const result = makeExternalSearchResult([indexedEvidence, doiEvidence]);

    expect(evidenceForPaper(result, target, 0)).toBe(doiEvidence);
  });

  it("falls back to external evidence by index when no paper match exists", () => {
    const target = makeExternalPaper({ title: "Target" });
    const indexedEvidence = makeExternalEvidence(makeExternalPaper({ title: "Indexed only" }), "index quote");
    const result = makeExternalSearchResult([indexedEvidence]);

    expect(evidenceForPaper(result, target, 0)).toBe(indexedEvidence);
  });

  it("returns undefined when no external evidence matches and no index fallback exists", () => {
    const target = makeExternalPaper({ title: "Target" });

    expect(samePaper(target, makeExternalPaper({ title: "Different" }))).toBe(false);
    expect(evidenceForPaper(makeExternalSearchResult([]), target, 0)).toBeUndefined();
  });
});
