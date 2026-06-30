import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { friendlyErrorMessage } from "../lib";

type LoadState =
  | { status: "loading"; sources: HarnessSourceSummary[]; error: null }
  | { status: "ready"; sources: HarnessSourceSummary[]; error: null }
  | { status: "error"; sources: HarnessSourceSummary[]; error: string };

export function SourcesTab() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ status: "loading", sources: [], error: null });

  useEffect(() => {
    let cancelled = false;

    void window.harness
      .listSources()
      .then((sources) => {
        if (cancelled) return;
        setState({ status: "ready", sources, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", sources: [], error: friendlyErrorMessage(error, t) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="workspace-panel" aria-labelledby="sources-title">
      <header className="workspace-header">
        <div>
          <h2 id="sources-title" className="workspace-title">
            {t("sources.title")}
          </h2>
          <p className="workspace-kicker">
            {state.sources.length || 0} {t("sources.seedCorpusRecords")}
          </p>
        </div>
        {state.status === "loading" ? <span className="inline-status">{t("common.loadingDots")}</span> : null}
      </header>

      {state.status === "error" ? <div className="error-banner">{state.error}</div> : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("common.title")}</th>
              <th>{t("common.year")}</th>
              <th>{t("common.type")}</th>
              <th>{t("common.sourceKey")}</th>
            </tr>
          </thead>
          <tbody>
            {state.sources.map((source) => (
              <tr key={source.id}>
                <td>{source.title || t("common.unknown")}</td>
                <td>{source.year || t("common.unknown")}</td>
                <td>{source.type || t("common.unknown")}</td>
                <td className="mono-cell">{source.id}</td>
              </tr>
            ))}
            {state.status === "ready" && state.sources.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-cell">
                  {t("sources.noSources")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
