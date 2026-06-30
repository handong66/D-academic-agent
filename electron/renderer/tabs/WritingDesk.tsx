import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ExternalPaperResults } from "../ExternalPaperResults.js";
import Icon from "../Icon";
import { friendlyErrorMessage, formatLocator, interpolate, isExternalSearchProvider, verdictClass, verdictLabels } from "../lib";
import SourceViewer from "../SourceViewer";
import { useT } from "../i18n";

type ActiveSourceLocator = {
  sourceId: string;
  charStart: number;
  charEnd: number;
};

type ExternalProviderId = HarnessExternalProviderStatus["id"];

const SUMMARY_STATUS_KEYS: readonly HarnessWritingClaimStatus[] = [
  "supported",
  "weakly_supported",
  "needs_citation",
  "overclaimed",
  "contradicted",
  "unclear",
];

const STATUS_LABELS: Record<HarnessWritingClaimStatus, string> = {
  supported: "writing.status.supported",
  weakly_supported: "writing.status.weaklySupported",
  needs_citation: "writing.status.needsCitation",
  overclaimed: "writing.status.overclaimed",
  contradicted: "writing.status.contradicted",
  unclear: "writing.status.unclear",
};

const CLAIM_TYPE_LABELS: Record<HarnessWritingClaimType, string> = {
  background: "writing.claimType.background",
  association: "writing.claimType.association",
  causal: "writing.claimType.causal",
  comparison: "writing.claimType.comparison",
  method: "writing.claimType.method",
  limitation: "writing.claimType.limitation",
  definition: "writing.claimType.definition",
};

const WRITING_EXTERNAL_RESULT_KEYS: Record<string, string> = {
  "library.external.noResults": "writing.external.noResults",
  "library.external.results": "writing.external.results",
};

const writingExternalStyles: Record<string, CSSProperties> = {
  externalPanel: {
    display: "grid",
    gap: 12,
    borderTop: "1px solid var(--line)",
    paddingTop: 12,
  },
  externalControls: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 8,
    alignItems: "center",
  },
  externalQuery: {
    minHeight: 82,
    lineHeight: 1.5,
    resize: "vertical",
    fontFamily: "inherit",
    fontSize: 13,
    fontStyle: "normal",
  },
  providerSelect: {
    minHeight: 40,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-md)",
    background: "var(--surface)",
    color: "var(--ink)",
    font: "inherit",
    fontSize: 13,
    outline: "none",
    padding: "8px 10px",
  },
  compactButton: {
    minHeight: 34,
    padding: "7px 10px",
  },
  inlineNote: {
    margin: 0,
  },
  resultPanel: {
    display: "grid",
    gap: 10,
  },
  mutedCopy: {
    margin: 0,
    padding: 0,
  },
};

function isExternalProviderId(value: string): value is ExternalProviderId {
  return value === "scite" || value === "consensus";
}

function writingExternalProviderLabelKey(providerId: ExternalProviderId): string {
  if (providerId === "scite") return "library.external.provider.scite";
  return "library.external.provider.consensus";
}

function writingExternalResultKey(key: string): string {
  return WRITING_EXTERNAL_RESULT_KEYS[key] ?? key;
}

function statusBadgeClass(status: HarnessWritingClaimStatus): string {
  if (status === "supported") return "verdict verdict-supports";
  if (status === "weakly_supported" || status === "overclaimed") return "verdict verdict-weakly-supports";
  if (status === "needs_citation") return "verdict verdict-needs-citation";
  if (status === "contradicted") return "verdict verdict-contradicts";
  return "muted-badge";
}

function evidenceCardClass(verdict: HarnessVerdict): string {
  if (verdict === "supports" || verdict === "weakly_supports") return "evidence-card evidence-card-support";
  if (verdict === "unsupported" || verdict === "contradicts") return "evidence-card evidence-card-contra";
  return "evidence-card";
}

function summaryTone(report: HarnessWritingReport): string {
  const summary = report.paragraphSummary;
  if (summary.contradicted > 0) return "tv-refuted";
  if (summary.needs_citation > 0 || summary.overclaimed > 0 || summary.weakly_supported > 0) return "tv-contested";
  if (summary.supported > 0) return "tv-supported";
  return "tv-insufficient";
}

function LocalEvidenceCard({
  evidence,
  style,
  onOpenLocator,
}: {
  evidence: HarnessWritingEvidenceCard;
  style?: CSSProperties;
  onOpenLocator: (locator: ActiveSourceLocator) => void;
}) {
  const t = useT();
  const locator = evidence.locator;

  return (
    <article className={evidenceCardClass(evidence.verdict)} style={style}>
      <div className="mention-head">
        <p className="evidence-source">{evidence.sourceId}</p>
        <span className={verdictClass(evidence.verdict)}>
          {t(verdictLabels[evidence.verdict] ?? "verdict.claim.unclear")}
        </span>
      </div>
      <p className="evidence-snippet">“{evidence.quote || t("writing.noEvidenceQuote")}”</p>
      <button
        type="button"
        className="locator-link evidence-loc"
        onClick={() =>
          onOpenLocator({
            sourceId: locator.source_id,
            charStart: locator.char_start,
            charEnd: locator.char_end,
          })
        }
      >
        {formatLocator(locator)}
      </button>
    </article>
  );
}

function ClaimResult({
  claim,
  style,
  onOpenLocator,
  connectedExternalProviders,
}: {
  claim: HarnessAnalyzedClaim;
  style?: CSSProperties;
  onOpenLocator: (locator: ActiveSourceLocator) => void;
  connectedExternalProviders: readonly HarnessExternalProviderStatus[];
}) {
  const t = useT();
  const mounted = useRef(true);
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalQuery, setExternalQuery] = useState(claim.text);
  const [selectedExternalProvider, setSelectedExternalProvider] = useState<ExternalProviderId | "">(
    connectedExternalProviders[0]?.id ?? "",
  );
  const [externalSearchLoading, setExternalSearchLoading] = useState(false);
  const [externalSearchError, setExternalSearchError] = useState<string | null>(null);
  const [externalSearchResult, setExternalSearchResult] = useState<HarnessExternalSearchResult | null>(null);
  const externalPanelId = `writing-external-${claim.id}`;
  const selectedProviderLabel = selectedExternalProvider
    ? t(writingExternalProviderLabelKey(selectedExternalProvider))
    : t("library.external.noProviderOption");
  const canSearchExternal =
    !externalSearchLoading && selectedExternalProvider.length > 0 && externalQuery.trim().length > 0 && connectedExternalProviders.length > 0;

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setSelectedExternalProvider((current) => {
      if (current && connectedExternalProviders.some((provider) => provider.id === current)) return current;
      return connectedExternalProviders[0]?.id ?? "";
    });
  }, [connectedExternalProviders]);

  async function runExternalSearch(): Promise<void> {
    const query = externalQuery.trim();
    if (externalSearchLoading || !selectedExternalProvider || query.length === 0) return;

    setExternalSearchLoading(true);
    setExternalSearchError(null);
    setExternalSearchResult(null);

    try {
      const result = await window.harness.externalSearch(selectedExternalProvider, query);
      if (!mounted.current) return;
      setExternalSearchResult(result);
    } catch (error) {
      if (!mounted.current) return;
      setExternalSearchError(interpolate(t("writing.external.error"), { message: friendlyErrorMessage(error, t) }));
    } finally {
      if (!mounted.current) return;
      setExternalSearchLoading(false);
    }
  }

  function translateExternalResult(key: string): string {
    return t(writingExternalResultKey(key));
  }

  return (
    <article className="sentence-card" style={style}>
      <div className="sentence-topline">
        <p className="sentence-text">{claim.text}</p>
        <span className="sentence-index">
          {t("writing.claimPrefix")}
          {claim.sentenceIndex + 1}
        </span>
      </div>

      <div className="mention-head">
        <span className={statusBadgeClass(claim.status)}>{t(STATUS_LABELS[claim.status])}</span>
        <span className="muted-badge">{t(CLAIM_TYPE_LABELS[claim.claimType])}</span>
        {!claim.isFactual ? <span className="muted-badge">{t("writing.notFactual")}</span> : null}
        <span className="citation-text">
          {claim.citedKeys.length > 0 ? `${t("writing.citations")}: ${claim.citedKeys.join(", ")}` : t("writing.noCitations")}
        </span>
        {claim.isFactual && connectedExternalProviders.length > 0 ? (
          <button
            className="action-button"
            type="button"
            style={writingExternalStyles.compactButton}
            aria-expanded={externalOpen}
            aria-controls={externalPanelId}
            onClick={() => setExternalOpen((current) => !current)}
          >
            <Icon name="search" /> {t("writing.external.find")}
          </button>
        ) : null}
      </div>

      <div className="mention-list">
        <div>
          <p className="evidence-head evidence-head-support">
            <Icon name="search" /> {t("writing.localEvidence")} · {claim.localEvidence.length}
          </p>
          {claim.localEvidence.length > 0 ? (
            claim.localEvidence.map((evidence, index) => (
              <LocalEvidenceCard
                key={`${evidence.sourceId}-${evidence.locator.char_start}-${evidence.locator.char_end}-${index}`}
                evidence={evidence}
                style={{ animationDelay: `${index * 40}ms` }}
                onOpenLocator={onOpenLocator}
              />
            ))
          ) : (
            <p className="evidence-empty">{t("writing.noLocalEvidence")}</p>
          )}
        </div>

        {claim.isFactual && externalOpen && connectedExternalProviders.length > 0 ? (
          <div id={externalPanelId} className="field field-wide" style={writingExternalStyles.externalPanel}>
            <div className="judge-nudge" style={writingExternalStyles.inlineNote}>
              <Icon name="info-circle" />{" "}
              {interpolate(t("writing.external.sendsNote"), {
                provider: selectedProviderLabel,
              })}
            </div>
            <textarea
              className="draft-input"
              value={externalQuery}
              onChange={(event) => setExternalQuery(event.currentTarget.value)}
              aria-label={t("writing.external.queryAria")}
              rows={3}
              spellCheck={true}
              style={writingExternalStyles.externalQuery}
            />
            <div style={writingExternalStyles.externalControls}>
              <select
                style={writingExternalStyles.providerSelect}
                value={selectedExternalProvider}
                aria-label={t("writing.external.providerLabel")}
                disabled={externalSearchLoading || connectedExternalProviders.length === 0}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSelectedExternalProvider(isExternalProviderId(value) ? value : "");
                }}
              >
                {connectedExternalProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {t(writingExternalProviderLabelKey(provider.id))}
                  </option>
                ))}
              </select>
              <button className="action-button" type="button" onClick={() => void runExternalSearch()} disabled={!canSearchExternal}>
                <Icon name={externalSearchLoading ? "loader-2" : "search"} />{" "}
                {externalSearchLoading ? t("writing.external.searching") : t("writing.external.searchButton")}
              </button>
            </div>
            {externalSearchLoading ? <p className="muted-copy" style={writingExternalStyles.mutedCopy}>{t("writing.external.searching")}</p> : null}
            {externalSearchError ? <div className="error-banner">{externalSearchError}</div> : null}
            {externalSearchResult ? (
              <div style={writingExternalStyles.resultPanel}>
                <div className="judge-nudge" style={writingExternalStyles.inlineNote}>
                  <Icon name="info-circle" /> {t("writing.external.candidatesNote")}
                </div>
                <ExternalPaperResults result={externalSearchResult} t={translateExternalResult} />
              </div>
            ) : null}
          </div>
        ) : null}

        {claim.riskNotes.length > 0 ? (
          <div className="field field-wide">
            <span className="field-label">{t("writing.riskNotes")}</span>
            {claim.riskNotes.map((note) => (
              <p key={note} className="field-value">
                {note}
              </p>
            ))}
          </div>
        ) : null}

        {claim.suggestedRewrite ? (
          <div className="field field-wide">
            <span className="field-label">{t("writing.suggestedRewrite")}</span>
            <p className="field-value quote">{claim.suggestedRewrite}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function WritingDeskTab() {
  const t = useT();
  const [paragraph, setParagraph] = useState("");
  const [result, setResult] = useState<HarnessWritingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [judgeProvider, setJudgeProvider] = useState<string | null>(null);
  const [externalStatuses, setExternalStatuses] = useState<HarnessExternalProviderStatus[]>([]);
  const [activeLocator, setActiveLocator] = useState<ActiveSourceLocator | null>(null);

  useEffect(() => {
    let cancelled = false;

    void window.harness
      .getConfig()
      .then((config) => {
        if (!cancelled) setJudgeProvider(config.judge?.provider ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void window.harness
      .externalProviderStatus()
      .then((statuses) => {
        if (!cancelled) setExternalStatuses(statuses);
      })
      .catch(() => {
        if (!cancelled) setExternalStatuses([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function run(): Promise<void> {
    const value = paragraph.trim();
    if (value.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await window.harness.analyzeParagraph(value));
    } catch (err) {
      setResult(null);
      setError(friendlyErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }

  const totalClaims = result?.claims.length ?? 0;
  const connectedExternalProviders = externalStatuses.filter(
    (provider) => provider.enabled && provider.connected && isExternalSearchProvider(provider.id),
  );

  return (
    <>
      <section className="workspace-panel" aria-labelledby="writing-title">
        <header className="workspace-header">
          <div>
            <h2 id="writing-title" className="workspace-title">
              {t("writing.title")}
            </h2>
            <p className="workspace-kicker">{t("writing.kicker")}</p>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="review-body">
          <div className="judge-nudge">
            <Icon name="info-circle" /> {judgeProvider === "mock" ? t("writing.judgeNudge") : t("writing.offlineNote")}
          </div>

          <div className="thesis-row">
            <textarea
              className="draft-input"
              value={paragraph}
              onChange={(event) => setParagraph(event.currentTarget.value)}
              placeholder={t("writing.placeholder")}
              aria-label={t("writing.paragraphAria")}
              rows={4}
              spellCheck={true}
              style={{ minHeight: 112, lineHeight: 1.5, resize: "vertical" }}
            />
            <button
              className="action-button"
              type="button"
              onClick={() => void run()}
              disabled={loading || paragraph.trim().length === 0}
              style={{ alignSelf: "flex-start" }}
            >
              <Icon name={loading ? "loader-2" : "player-play"} /> {loading ? t("writing.analyzing") : t("writing.analyze")}
            </button>
          </div>

          {result ? (
            <>
              <div className={`verdict-banner ${summaryTone(result)}`}>
                <div className="verdict-headline">
                  <Icon name="report-analytics" />
                  <div>
                    <p className="verdict-word">{t("writing.claimMap")}</p>
                    <p className="verdict-blurb">
                      {totalClaims === 1 ? t("writing.oneClaim") : `${totalClaims} ${t("writing.claims")}`}
                    </p>
                  </div>
                </div>
                <div className="verdict-metrics">
                  {SUMMARY_STATUS_KEYS.map((status) => (
                    <div key={status}>
                      <p className="metric-num">{result.paragraphSummary[status]}</p>
                      <p className="metric-cap">{t(STATUS_LABELS[status])}</p>
                    </div>
                  ))}
                </div>
              </div>

              {result.claims.length > 0 ? (
                <div className="sentence-list">
                  {result.claims.map((claim, index) => (
                    <ClaimResult
                      key={claim.id}
                      claim={claim}
                      style={{ animationDelay: `${index * 40}ms` }}
                      onOpenLocator={setActiveLocator}
                      connectedExternalProviders={connectedExternalProviders}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state compact-empty">
                  <p>{t("writing.emptyNoClaims")}</p>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state compact-empty">
              <p>{loading ? t("writing.emptyLoading") : t("writing.emptyPrompt")}</p>
            </div>
          )}
        </div>
      </section>
      {activeLocator ? (
        <SourceViewer
          sourceId={activeLocator.sourceId}
          charStart={activeLocator.charStart}
          charEnd={activeLocator.charEnd}
          onClose={() => setActiveLocator(null)}
        />
      ) : null}
    </>
  );
}
