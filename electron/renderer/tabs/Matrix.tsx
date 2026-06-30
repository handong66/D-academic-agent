import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { friendlyErrorMessage } from "../lib";

interface MatrixRow {
  source: string;
  claim: string;
  verdict: string;
  quote: string;
  locator: string;
}

interface MatrixState {
  loading: boolean;
  error: string | null;
  result: HarnessMatrixResult | null;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseMatrix(markdown: string): MatrixRow[] {
  const tableLines = markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\|\s*-/.test(line.trim()));

  return tableLines.slice(1).map((line) => {
    const [source = "", claim = "", verdict = "", quote = "", locator = ""] = cells(line);
    return { source, claim, verdict, quote, locator };
  });
}

export function MatrixTab() {
  const t = useT();
  const [state, setState] = useState<MatrixState>({ loading: false, error: null, result: null });
  const rows = useMemo(() => (state.result ? parseMatrix(state.result.markdown) : []), [state.result]);

  async function buildMatrix(): Promise<void> {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await window.harness.buildMatrix();
      setState({ loading: false, error: null, result });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: friendlyErrorMessage(error, t),
      }));
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="matrix-title">
      <header className="workspace-header">
        <div>
          <h2 id="matrix-title" className="workspace-title">
            {t("matrix.title")}
          </h2>
          <p className="workspace-kicker">{state.result ? state.result.dir : t("matrix.noMatrix")}</p>
        </div>
        <button className="action-button" type="button" onClick={() => void buildMatrix()} disabled={state.loading}>
          {state.loading ? t("matrix.building") : t("matrix.buildMatrix")}
        </button>
      </header>

      {state.error ? <div className="error-banner">{state.error}</div> : null}

      {state.result ? (
        <div className="table-wrap">
          <table className="data-table matrix-table">
            <thead>
              <tr>
                <th>{t("common.source")}</th>
                <th>{t("common.claim")}</th>
                <th>{t("common.verdict")}</th>
                <th>{t("common.quote")}</th>
                <th>{t("common.locator")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.source}-${row.locator}`}>
                  <td className="mono-cell">{row.source}</td>
                  <td>{row.claim}</td>
                  <td>{row.verdict}</td>
                  <td>{row.quote}</td>
                  <td className="mono-cell">{row.locator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <p>{t("matrix.empty")}</p>
        </div>
      )}
    </section>
  );
}
