import { useMemo, useState, type CSSProperties } from "react";
import { useT } from "../i18n";
import { friendlyErrorMessage, resultTypeLabelKey, traceEventLabelKey } from "../lib";

interface EvalState {
  loading: boolean;
  error: string | null;
  result: HarnessEvalResult | null;
}

interface AblationState {
  loading: boolean;
  error: string | null;
  result: HarnessAblationResult | null;
}

const headerActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 8,
};

const pathStyle: CSSProperties = {
  overflowWrap: "anywhere",
};

function formatMetric(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

export function EvalTraceTab() {
  const t = useT();
  const [state, setState] = useState<EvalState>({ loading: false, error: null, result: null });
  const [ablation, setAblation] = useState<AblationState>({ loading: false, error: null, result: null });
  const labels = useMemo(() => (state.result ? Object.keys(state.result.per_class) : []), [state.result]);
  const traceEvents = useMemo(
    () => (state.result ? Object.entries(state.result.trace_summary.byEventType).sort(([a], [b]) => a.localeCompare(b)) : []),
    [state.result],
  );
  const hasOutput = state.result || ablation.result;

  async function runEval(): Promise<void> {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await window.harness.runEval();
      setState({ loading: false, error: null, result });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: friendlyErrorMessage(error, t),
      }));
    }
  }

  async function runAblation(): Promise<void> {
    setAblation((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await window.harness.runAblation();
      setAblation({ loading: false, error: null, result });
    } catch (error) {
      setAblation((current) => ({
        ...current,
        loading: false,
        error: friendlyErrorMessage(error, t),
      }));
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="eval-title">
      <header className="workspace-header">
        <div>
          <h2 id="eval-title" className="workspace-title">
            {t("eval.title")}
          </h2>
          <p className="workspace-kicker">{t("eval.kicker")}</p>
        </div>
        <div style={headerActionsStyle}>
          <button className="action-button" type="button" onClick={() => void runEval()} disabled={state.loading}>
            {state.loading ? t("common.runningDots") : t("eval.runEval")}
          </button>
          <button className="action-button" type="button" onClick={() => void runAblation()} disabled={ablation.loading}>
            {ablation.loading ? t("common.runningDots") : t("eval.ablation")}
          </button>
        </div>
      </header>

      {state.error ? <div className="error-banner">{state.error}</div> : null}
      {ablation.error ? <div className="error-banner">{ablation.error}</div> : null}

      {hasOutput ? (
        <div className="eval-layout">
          {state.result ? (
            <section className="metric-strip" aria-label={t("eval.headlineMetrics")}>
              <div className="metric-block">
                <span className="metric-label">{t("eval.macroF1")}</span>
                <strong>{formatMetric(state.result.macro_f1)}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.answerGroundedness")}</span>
                <strong>{formatMetric(state.result.answer_groundedness)}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.groundedLocators")}</span>
                <strong>{formatMetric(state.result.policy_compliance.grounded_locator_rate)}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.snippetOnly")}</span>
                <strong>{formatMetric(state.result.policy_compliance.snippet_only_rate)}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.outboundChars")}</span>
                <strong>{state.result.policy_compliance.outbound_chars}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.failures")}</span>
                <strong>{state.result.failures.length}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.traceEvents")}</span>
                <strong>{state.result.trace_summary.total}</strong>
              </div>
              <div className="metric-block">
                <span className="metric-label">{t("eval.outboundSnippets")}</span>
                <strong>{state.result.trace_summary.outbound_snippet_count}</strong>
              </div>
            </section>
          ) : null}

          {state.result ? (
            <>
              <div className="split-grid">
                <section className="subsection">
                  <h3 className="subsection-title">{t("eval.perClass")}</h3>
                  <div className="table-wrap inset-table">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t("common.label")}</th>
                          <th>{t("eval.precision")}</th>
                          <th>{t("eval.recall")}</th>
                          <th>{t("eval.f1")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {labels.map((label) => {
                          const metric = state.result?.per_class[label];
                          return metric ? (
                            <tr key={label}>
                              <td>{t(resultTypeLabelKey(label))}</td>
                              <td>{formatMetric(metric.precision)}</td>
                              <td>{formatMetric(metric.recall)}</td>
                              <td>{formatMetric(metric.f1)}</td>
                            </tr>
                          ) : null;
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="subsection">
                  <h3 className="subsection-title">{t("eval.traceSummary")}</h3>
                  <dl className="trace-summary">
                    <div>
                      <dt>{t("eval.models")}</dt>
                      <dd>{state.result.trace_summary.models.join(", ") || t("common.none")}</dd>
                    </div>
                    {traceEvents.map(([eventType, count]) => (
                      <div key={eventType}>
                        <dt>{t(traceEventLabelKey(eventType))}</dt>
                        <dd>{count}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>

              <section className="subsection">
                <h3 className="subsection-title">{t("eval.confusion")}</h3>
                <div className="table-wrap inset-table">
                  <table className="data-table confusion-table">
                    <thead>
                      <tr>
                        <th>{t("eval.goldPred")}</th>
                        {labels.map((label) => (
                          <th key={label}>{t(resultTypeLabelKey(label))}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {labels.map((gold) => (
                        <tr key={gold}>
                          <th>{t(resultTypeLabelKey(gold))}</th>
                          {labels.map((pred) => (
                            <td key={`${gold}-${pred}`}>{state.result?.confusion[gold]?.[pred] ?? 0}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="subsection">
                <h3 className="subsection-title">{t("eval.failures")}</h3>
                {state.result.failures.length > 0 ? (
                  <ol className="failure-list">
                    {state.result.failures.map((failure, index) => (
                      <li key={`${failure.cited_source}-${index}`}>
                        <span className="failure-label">
                          {t(resultTypeLabelKey(failure.gold))} {t("eval.to")} {t(resultTypeLabelKey(failure.pred))}
                        </span>
                        <span className="failure-source">{failure.cited_source}</span>
                        <p>{failure.claim}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted-copy">{t("eval.noFailures")}</p>
                )}
              </section>
            </>
          ) : null}

          {ablation.result ? (
            <section className="subsection">
              <h3 className="subsection-title">{t("eval.providerAblation")}</h3>
              <div className="table-wrap inset-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("common.label")}</th>
                      <th>{t("eval.macroF1")}</th>
                      <th>{t("eval.answerGroundedness")}</th>
                      <th>{t("eval.overclaimRecall")}</th>
                      <th>{t("eval.retrievalRecallAtK")}</th>
                      <th>{t("eval.outboundChars")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ablation.result.rows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{formatMetric(row.macro_f1)}</td>
                        <td>{formatMetric(row.answer_groundedness)}</td>
                        <td>{formatMetric(row.overclaim_recall)}</td>
                        <td>{formatMetric(row.retrieval_recall_at_k)}</td>
                        <td>{row.outbound_chars}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted-copy" style={pathStyle}>
                {t("eval.ablationMd")} {ablation.result.mdPath}
              </p>
              {ablation.result.skipped.length > 0 ? (
                <p className="muted-copy">{t("eval.skippedHint")}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <p>{t("eval.empty")}</p>
        </div>
      )}
    </section>
  );
}
