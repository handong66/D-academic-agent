import { useEffect, useState, type CSSProperties } from "react";
import Icon from "../Icon";
import { VERDICT_BLURB, VERDICT_LABEL, friendlyErrorMessage, num, representative, stageDetailText } from "../lib";
import SourceViewer from "../SourceViewer";
import { useT } from "../i18n";

type ActiveSourceLocator = {
  sourceId: string;
  charStart: number;
  charEnd: number;
};

const STAGES = [
  { key: "plan", labelKey: "review.stage.plan", icon: "ti-sitemap" },
  { key: "retrieve", labelKey: "review.stage.retrieve", icon: "ti-search" },
  { key: "judge", labelKey: "review.stage.judge", icon: "ti-gavel" },
  { key: "report", labelKey: "review.stage.report", icon: "ti-report-analytics" },
] as const;

const STAGE_KEYS = new Set<string>(STAGES.map((stage) => stage.key));

type StageKey = (typeof STAGES)[number]["key"];
type StageStatus = Record<string, { done: boolean; detail: string }>;
type RepresentativeFindingInput = Parameters<typeof representative>[0];

function EvidenceCard({
  sourceId,
  finding,
  kind,
  style,
  onOpenLocator,
}: {
  sourceId: string;
  finding?: HarnessPlanFinding;
  kind: "support" | "contra";
  style?: CSSProperties;
  onOpenLocator: (locator: ActiveSourceLocator) => void;
}) {
  const t = useT();

  return (
    <article className={`evidence-card evidence-card-${kind}`} style={style}>
      <p className="evidence-source">{sourceId}</p>
      {finding ? <p className="evidence-snippet">“{finding.snippet}”</p> : null}
      {finding ? (
        <button
          type="button"
          className="locator-link evidence-loc"
          onClick={() =>
            onOpenLocator({
              sourceId: finding.locator.source_id,
              charStart: finding.locator.char_start,
              charEnd: finding.locator.char_end,
            })
          }
        >
          {finding.locator.source_id} · {finding.locator.char_start}–{finding.locator.char_end}
        </button>
      ) : null}
    </article>
  );
}

export function ReviewTab() {
  const t = useT();
  const [thesis, setThesis] = useState("");
  const [result, setResult] = useState<HarnessPlanCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [judgeProvider, setJudgeProvider] = useState<string | null>(null);
  const [activeLocator, setActiveLocator] = useState<ActiveSourceLocator | null>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus>({});

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

  async function run(): Promise<void> {
    const value = thesis.trim();
    if (value.length === 0) return;
    setLoading(true);
    setError(null);
    setStageStatus({});
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.harness.onPlanStage((stage) => {
        if (!STAGE_KEYS.has(stage.stage)) return;
        setStageStatus((prev) => ({ ...prev, [stage.stage]: { done: true, detail: stage.detail } }));
      });
      setResult(await window.harness.planAndCheck(value));
    } catch (err) {
      setResult(null);
      setError(friendlyErrorMessage(err, t));
    } finally {
      unsubscribe?.();
      setLoading(false);
    }
  }

  const verdict = result?.thesis_verdict;
  const hasStageEvents = Object.keys(stageStatus).length > 0;
  const activeStageIndex = STAGES.findIndex((stage) => !stageStatus[stage.key]?.done);
  const stageClass = (stage: (typeof STAGES)[number], index: number): string => {
    if (stageStatus[stage.key]?.done) return "stage-done";
    if (loading && hasStageEvents) return index === activeStageIndex ? "stage-active" : "stage-idle";
    if (loading) return "stage-active";
    if (result) return "stage-done";
    return "stage-idle";
  };
  const stageDetail = (key: StageKey, index: number): string => {
    const status = stageStatus[key];
    if (status?.done) return status.detail;
    if (loading && hasStageEvents) return index === activeStageIndex ? t("common.runningEllipsis") : t("common.dash");
    return stageDetailText(loading, result, key, verdict ? t(VERDICT_LABEL[verdict.verdict]) : undefined, {
      running: t("common.runningEllipsis"),
      empty: t("common.dash"),
      subqueries: t("review.stage.subqueries"),
      evidence: t("review.stage.evidence"),
      judged: t("review.stage.judged"),
      done: t("review.stage.done"),
    });
  };

  return (
    <>
      <section className="workspace-panel" aria-labelledby="review-title">
      <header className="workspace-header">
        <div>
          <h2 id="review-title" className="workspace-title">{t("review.title")}</h2>
          <p className="workspace-kicker">{t("review.kicker")}</p>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="review-body">
        {judgeProvider === "mock" ? (
          <div className="judge-nudge">
            <Icon name="info-circle" /> {t("review.judgeNudge")}
          </div>
        ) : null}

        <div className="thesis-row">
          <input
            className="thesis-input"
            value={thesis}
            onChange={(event) => setThesis(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run();
            }}
            placeholder={t("review.placeholder")}
            aria-label={t("review.thesisAria")}
          />
          <button className="action-button" type="button" onClick={() => void run()} disabled={loading || thesis.trim().length === 0}>
            <Icon name={loading ? "loader-2" : "player-play"} /> {loading ? t("review.reviewing") : t("common.review")}
          </button>
        </div>

        <p className="pipeline-label">{t("review.agentPipeline")}</p>
        <ol className="pipeline">
          {STAGES.map((stage, index) => (
            <li key={stage.key} className={`stage ${stageClass(stage, index)}`}>
              <Icon name={stage.icon} />
              <span className="stage-name">{t(stage.labelKey)}</span>
              <span className="stage-detail">{stageDetail(stage.key, index)}</span>
            </li>
          ))}
        </ol>

        {result && verdict ? (
          <>
            <div className={`verdict-banner tv-${verdict.verdict}`}>
              <div className="verdict-headline">
                <Icon name="scale" />
                <div>
                  <p className="verdict-word">{t(VERDICT_LABEL[verdict.verdict])}</p>
                  <p className="verdict-blurb">
                    {t(VERDICT_BLURB[verdict.verdict])} — {verdict.supporting} {t("review.support")} · {verdict.contradicting} {t("review.contradict")}
                    {verdict.mixed ? ` · ${verdict.mixed} ${t("review.mixed")}` : ""}
                  </p>
                </div>
              </div>
              <div className="verdict-metrics">
                <div>
                  <p className="metric-num">{num(verdict.consensus)}</p>
                  <p className="metric-cap">{t("review.consensus")}</p>
                </div>
                <div>
                  <p className="metric-num">{num(verdict.decisiveness)}</p>
                  <p className="metric-cap">{t("review.decisiveness")}</p>
                </div>
              </div>
            </div>

            <div className="evidence-map">
              <div className="evidence-col">
                <p className="evidence-head evidence-head-support">
                  <Icon name="circle-check" /> {t("review.supporting")} · {result.summary.supporting_sources.length}
                </p>
                {result.summary.supporting_sources.length > 0 ? (
                  result.summary.supporting_sources.map((sourceId, i) => (
                    <EvidenceCard
                      key={sourceId}
                      sourceId={sourceId}
                      finding={
                        representative(result.findings as unknown as RepresentativeFindingInput, sourceId, "supports") as
                          | HarnessPlanFinding
                          | undefined
                      }
                      kind="support"
                      style={{ animationDelay: `${i * 40}ms` }}
                      onOpenLocator={setActiveLocator}
                    />
                  ))
                ) : (
                  <p className="evidence-empty">{t("common.none")}</p>
                )}
              </div>
              <div className="evidence-col">
                <p className="evidence-head evidence-head-contra">
                  <Icon name="circle-x" /> {t("review.contradicting")} · {result.summary.contradicting_sources.length}
                </p>
                {result.summary.contradicting_sources.length > 0 ? (
                  result.summary.contradicting_sources.map((sourceId, i) => (
                    <EvidenceCard
                      key={sourceId}
                      sourceId={sourceId}
                      finding={
                        representative(result.findings as unknown as RepresentativeFindingInput, sourceId, "contradicts") as
                          | HarnessPlanFinding
                          | undefined
                      }
                      kind="contra"
                      style={{ animationDelay: `${(result.summary.supporting_sources.length + i) * 40}ms` }}
                      onOpenLocator={setActiveLocator}
                    />
                  ))
                ) : (
                  <p className="evidence-empty">{t("common.none")}</p>
                )}
              </div>
            </div>

            <p className="review-foot">
              {t("review.footPrefix")} {result.findings.length} {t("review.footMiddle")} {result.subqueries.length} {t("review.footSuffix")}
            </p>
          </>
        ) : (
          <div className="empty-state compact-empty">
            <p>{loading ? t("review.emptyLoading") : t("review.emptyPrompt")}</p>
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
