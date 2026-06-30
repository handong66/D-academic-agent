import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EvalTraceTab } from "./tabs/EvalTrace";
import { LibraryTab } from "./tabs/Library";
import { MatrixTab } from "./tabs/Matrix";
import { ReviewTab } from "./tabs/Review";
import { SettingsTab } from "./tabs/Settings";
import { SourcesTab } from "./tabs/Sources";
import { WritingDeskTab } from "./tabs/WritingDesk";
import Icon from "./Icon";
import SourceViewer from "./SourceViewer";
import {
  citationStatusLabel,
  confidencePercent,
  friendlyErrorMessage,
  formatLocator,
  judgeLabel,
  verdictClass,
  verdictLabels,
} from "./lib";
import { useT } from "./i18n";
import { toggleTheme, type ThemeName } from "./theme";

const DEBOUNCE_MS = 600;

type TabId = "audit" | "review" | "writing" | "sources" | "library" | "matrix" | "eval" | "settings";

type ActiveSourceLocator = {
  sourceId: string;
  charStart: number;
  charEnd: number;
};

const tabs: Array<{ id: TabId; labelKey: string; icon: string }> = [
  { id: "audit", labelKey: "nav.audit", icon: "ti-checkup-list" },
  { id: "review", labelKey: "nav.review", icon: "ti-scale" },
  { id: "writing", labelKey: "nav.writing", icon: "ti-pencil" },
  { id: "sources", labelKey: "nav.sources", icon: "ti-list-details" },
  { id: "library", labelKey: "nav.library", icon: "ti-books" },
  { id: "matrix", labelKey: "nav.matrix", icon: "ti-table" },
  { id: "eval", labelKey: "nav.eval", icon: "ti-chart-dots" },
  { id: "settings", labelKey: "nav.settings", icon: "ti-settings" },
];

function ProviderStatus() {
  const t = useT();
  const [judge, setJudge] = useState<string>("mock");
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  useEffect(() => {
    let cancelled = false;
    void window.harness
      .getConfig()
      .then((config) => {
        if (!cancelled) setJudge(config.judge?.provider ?? "mock");
      })
      .catch(() => undefined);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      cancelled = true;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const judgeName = t(judgeLabel(judge));

  return (
    <div className="provider-status" title={`${t("settings.judgeProviderTitle")} ${judgeName}`}>
      <Icon name="cpu" />
      <span className="provider-judge">{judgeName}</span>
      <span className={online ? "net-dot net-online" : "net-dot net-offline"} aria-hidden="true" />
      <span className="provider-net">{online ? t("common.online") : t("common.offline")}</span>
    </div>
  );
}

function MentionResult({
  mention,
  onOpenLocator,
}: {
  mention: HarnessMentionAudit;
  onOpenLocator: (locator: ActiveSourceLocator) => void;
}) {
  const t = useT();

  if (mention.status !== "resolved" || !mention.support) {
    return (
      <article className="mention-card">
        <div className="mention-head">
          <span className="muted-badge">{t(citationStatusLabel(mention.status))}</span>
          <span className="citation-text">{mention.raw_citation}</span>
        </div>
      </article>
    );
  }

  const confidence = confidencePercent(mention.support.confidence);
  const locator = mention.support.locator;

  return (
    <article className="mention-card">
      <div className="mention-head">
        <span className={verdictClass(mention.support.verdict)}>
          {t(verdictLabels[mention.support.verdict] ?? "verdict.claim.unclear")}
        </span>
        {mention.counterevidence_found === true ? (
          <span className="counter-badge">
            <Icon name="alert-triangle" /> {t("audit.corpusCounterEvidence")}
          </span>
        ) : null}
        <span className="citation-text">{mention.raw_citation}</span>
      </div>

      <div className="evidence-grid">
        <div className="field field-wide">
          <span className="field-label">{t("common.quote")}</span>
          <p className="field-value quote">{mention.support.quote || t("audit.noSourceQuote")}</p>
        </div>
        <div className="field">
          <span className="field-label">{t("common.locator")}</span>
          <p className="field-value">
            <button
              type="button"
              className="locator-link"
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
          </p>
        </div>
        <div className="field confidence">
          <span className="field-label">{t("audit.confidence")}</span>
          <div className="confidence-track" aria-label={`${t("audit.confidence")} ${confidence}%`}>
            <div className="confidence-fill" style={{ width: `${confidence}%` }} />
          </div>
          <p className="field-value">{confidence}%</p>
        </div>
        <div className="field field-wide">
          <span className="field-label">{t("audit.suggestedRewrite")}</span>
          <p className="field-value">{mention.support.suggested_rewrite || t("audit.noRewrite")}</p>
        </div>
        {mention.support.reason ? (
          <div className="field field-wide">
            <span className="field-label">{t("audit.reason")}</span>
            <p className="field-value">{mention.support.reason}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SentenceResult({
  sentence,
  style,
  onOpenLocator,
}: {
  sentence: HarnessSentenceAudit;
  style?: CSSProperties;
  onOpenLocator: (locator: ActiveSourceLocator) => void;
}) {
  const t = useT();

  return (
    <article className="sentence-card" style={style}>
      <div className="sentence-topline">
        <p className="sentence-text">{sentence.text}</p>
        <span className="sentence-index">
          {t("audit.sentencePrefix")}
          {sentence.index + 1}
        </span>
      </div>

      <div className="mention-list">
        {sentence.mentions.length > 0 ? (
          sentence.mentions.map((mention) => (
            <MentionResult
              key={`${mention.raw_citation}-${mention.char_start}-${mention.char_end}`}
              mention={mention}
              onOpenLocator={onOpenLocator}
            />
          ))
        ) : (
          <span className="muted-badge">{t("audit.noCitationDetected")}</span>
        )}
      </div>
    </article>
  );
}

function AuditTab() {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [audit, setAudit] = useState<HarnessDraftAudit | null>(null);
  const [judgeProvider, setJudgeProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLocator, setActiveLocator] = useState<ActiveSourceLocator | null>(null);
  const requestSeq = useRef(0);

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
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;

    if (draft.trim().length === 0) {
      setAudit(null);
      setError(null);
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      void window.harness
        .auditDraft(draft)
        .then((result) => {
          if (requestSeq.current !== requestId) return;
          setAudit(result);
        })
        .catch((err: unknown) => {
          if (requestSeq.current !== requestId) return;
          setAudit(null);
          setError(friendlyErrorMessage(err, t));
        })
        .finally(() => {
          if (requestSeq.current === requestId) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draft]);

  const sentenceCount = audit?.sentences.length ?? 0;
  const statusText = error
    ? error
    : loading
      ? t("audit.status.auditingDraft")
      : draft.trim().length === 0
        ? t("audit.status.pasteDraft")
        : !audit
          ? t("audit.status.waiting")
          : t("audit.status.updated");

  return (
    <>
      <section className="hero" aria-label={t("audit.title")}>
      <div className="draft-panel">
        <h1 className="panel-title">{t("audit.title")}</h1>
        <p className="panel-copy">
          {t("audit.copy")}
        </p>
        {judgeProvider === "mock" ? (
          <div className="judge-nudge">
            <Icon name="info-circle" /> {t("audit.judgeNudge")}
          </div>
        ) : null}
        <textarea
          className="draft-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("audit.placeholder")}
          spellCheck={true}
        />
        <div className="status-row" aria-live="polite">
          <span className={error ? "status-error" : undefined}>{statusText}</span>
          {loading ? <span className="spinner" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="result-panel">
        <header className="result-header">
          <h2 className="result-title">{t("audit.sentenceDiagnosis")}</h2>
          <span className="result-count">
            {sentenceCount === 1 ? t("audit.oneSentence") : `${sentenceCount} ${t("audit.sentences")}`}
          </span>
        </header>
        <div className="verdict-legend" aria-label={t("audit.verdictLegend")}>
          <span><span className="legend-dot legend-dot-support" aria-hidden="true" /> {t("verdict.claim.supports")}</span>
          <span><span className="legend-dot legend-dot-warn" aria-hidden="true" /> {t("verdict.claim.weaklySupports")}</span>
          <span><span className="legend-dot legend-dot-contra" aria-hidden="true" /> {t("verdict.claim.unsupported")}</span>
          <span><span className="legend-dot legend-dot-contra" aria-hidden="true" /> {t("verdict.claim.contradicts")}</span>
          <span><span className="legend-dot legend-dot-unclear" aria-hidden="true" /> {t("verdict.claim.unclear")}</span>
        </div>

        {audit && audit.sentences.length > 0 ? (
          <div className="sentence-list">
            {audit.sentences.map((sentence, i) => (
              <SentenceResult
                key={`${sentence.index}-${sentence.char_start}-${sentence.char_end}`}
                sentence={sentence}
                style={{ animationDelay: `${i * 40}ms` }}
                onOpenLocator={setActiveLocator}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>{t("audit.emptyDiagnosis")}</p>
            {draft.trim().length === 0 ? (
              <ol className="get-started" aria-label={t("audit.getStarted")}>
                <li>{t("audit.stepPickJudge")}</li>
                <li>{t("audit.stepImportPaper")}</li>
                <li>{t("audit.stepPasteDraft")}</li>
              </ol>
            ) : null}
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

function renderTab(tab: TabId) {
  if (tab === "review") return <ReviewTab />;
  if (tab === "writing") return <WritingDeskTab />;
  if (tab === "sources") return <SourcesTab />;
  if (tab === "library") return <LibraryTab />;
  if (tab === "matrix") return <MatrixTab />;
  if (tab === "eval") return <EvalTraceTab />;
  if (tab === "settings") return <SettingsTab />;
  return <AuditTab />;
}

export function App() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabId>("audit");
  const [theme, setTheme] = useState<ThemeName>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  return (
    <main className="app-shell">
      <nav className="app-sidebar" aria-label={t("nav.harnessNavigation")}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="microscope" /></span>
          <span className="brand-name">
            {t("nav.brand")}
          </span>
        </div>
        <ul className="nav-list">
          {tabs.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={activeTab === tab.id ? "nav-item nav-item-active" : "nav-item"}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon name={tab.icon} />
                <span>{t(tab.labelKey)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          <ProviderStatus />
          <button
            type="button"
            className="theme-toggle"
            aria-label={`${t("nav.switchTo")} ${theme === "dark" ? t("common.light") : t("common.dark")} ${t("nav.theme")}`}
            onClick={() => setTheme(toggleTheme())}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
            <span>{theme === "dark" ? t("common.light") : t("common.dark")}</span>
          </button>
        </div>
      </nav>
      <section className="app-main">{renderTab(activeTab)}</section>
    </main>
  );
}
