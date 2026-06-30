import { useEffect, useMemo, useState } from "react";
import { useT } from "./i18n";

export interface SourceViewerProps {
  sourceId: string;
  charStart: number;
  charEnd: number;
  onClose: () => void;
}

export function SourceViewer({ sourceId, charStart, charEnd, onClose }: SourceViewerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText("");

    void window.harness
      .getSourceText(sourceId)
      .then((result) => {
        if (!cancelled) setText(result.text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const slices = useMemo(() => {
    const start = Math.max(0, Math.min(charStart, text.length));
    const end = Math.max(start, Math.min(charEnd, text.length));
    return {
      before: text.slice(0, start),
      highlight: text.slice(start, end),
      after: text.slice(end),
    };
  }, [charEnd, charStart, text]);

  return (
    <section className="source-viewer" aria-label={t("viewer.aria")}>
      <div className="source-viewer-card">
        <header className="source-viewer-head">
          <p className="source-viewer-title">
            {sourceId} · {charStart}–{charEnd}
          </p>
          <button type="button" className="source-viewer-close" onClick={onClose}>
            {t("viewer.close")}
          </button>
        </header>
        <div className="source-viewer-body">
          {loading ? <p className="source-viewer-state">{t("viewer.loading")}</p> : null}
          {error ? <p className="source-viewer-state source-viewer-error">{error}</p> : null}
          {!loading && !error && text.length === 0 ? <p className="source-viewer-state">{t("viewer.empty")}</p> : null}
          {!loading && !error && text.length > 0 ? (
            <pre className="source-viewer-text">
              {slices.before}
              <mark>{slices.highlight}</mark>
              {slices.after}
            </pre>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default SourceViewer;
