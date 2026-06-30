import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import Icon from "./Icon";
import { useT } from "./i18n";
import {
  doiHref,
  friendlyErrorMessage,
  interpolate,
  normalizeDoi,
  referenceCountsText,
  referenceHealthKey,
  referenceHealthStyles,
  referenceNoticeText,
  referenceRiskBadgeClass,
  referenceRiskBadgeStyles,
  referenceRiskLabelKey,
  referenceRiskTone,
  signalsByDoi,
  type ReferenceRiskTone,
  type ReferenceSignal,
} from "./lib";

export interface ReferencesPanelProps {
  sourceId: string;
  title: string;
  sciteConnected: boolean;
  onClose: () => void;
}

interface ReferenceDoiEntry {
  doi: string;
  key: string;
}

const MAX_REFERENCE_HEALTH_DOIS = 100;

const referencesPanelStyles: Record<string, CSSProperties> = {
  controls: {
    display: "grid",
    gap: 10,
    borderBottom: "1px solid var(--line)",
    padding: 14,
  },
  actionRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  disclosure: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    margin: 0,
  },
  list: {
    display: "grid",
    gap: 10,
    padding: 16,
  },
  reference: {
    display: "grid",
    gap: 8,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-md)",
    background: "var(--surface)",
    padding: 12,
  },
  title: {
    margin: 0,
    color: "var(--ink)",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  health: {
    display: "grid",
    gap: 6,
    marginTop: 2,
  },
};

function referenceLabel(reference: HarnessReference, index: number, t: (key: string) => string): string {
  return reference.title?.trim() || reference.doi?.trim() || `${t("library.refs.title")} ${index + 1}`;
}

function referenceMetaParts(reference: HarnessReference): string[] {
  return [reference.author?.trim(), reference.year?.trim()].filter((part): part is string => Boolean(part));
}

export function ReferencesPanel({ sourceId, title, sciteConnected, onClose }: ReferencesPanelProps) {
  const t = useT();
  const cardRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [references, setReferences] = useState<HarnessReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthSignals, setHealthSignals] = useState<Map<string, ReferenceSignal>>(new Map<string, ReferenceSignal>());
  const [healthChecked, setHealthChecked] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkedReferenceCount, setCheckedReferenceCount] = useState(0);
  const [first100Checked, setFirst100Checked] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    cardRef.current?.focus();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReferences([]);
    setHealthSignals(new Map<string, ReferenceSignal>());
    setHealthChecked(false);
    setHealthError(null);
    setCheckedReferenceCount(0);
    setFirst100Checked(false);

    void window.harness
      .getSourceReferences(sourceId)
      .then((result) => {
        if (!cancelled) setReferences(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyErrorMessage(err, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceId, t]);

  const referenceDoiEntries = useMemo(
    () =>
      references.flatMap((reference): ReferenceDoiEntry[] => {
        if (!reference.doi) return [];
        const doi = normalizeDoi(reference.doi);
        if (doi.length === 0) return [];
        return [{ doi, key: referenceHealthKey(doi) }];
      }),
    [references],
  );

  const sentDoiEntries = useMemo(() => referenceDoiEntries.slice(0, MAX_REFERENCE_HEALTH_DOIS), [referenceDoiEntries]);

  const sentDoiKeys = useMemo(() => new Set(sentDoiEntries.map((entry) => entry.key)), [sentDoiEntries]);

  async function checkReferenceHealth(): Promise<void> {
    if (healthLoading) return;

    setHealthLoading(true);
    setHealthError(null);

    try {
      const signals = sentDoiEntries.length > 0 ? await window.harness.libraryReferenceHealth(sentDoiEntries.map((entry) => entry.doi)) : [];
      if (!mountedRef.current) return;
      setHealthSignals(signalsByDoi(signals));
      setHealthChecked(true);
      setCheckedReferenceCount(sentDoiEntries.length);
      setFirst100Checked(referenceDoiEntries.length > sentDoiEntries.length);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setHealthSignals(new Map<string, ReferenceSignal>());
      setHealthChecked(false);
      setCheckedReferenceCount(0);
      setFirst100Checked(false);
      setHealthError(friendlyErrorMessage(err, t));
    } finally {
      if (!mountedRef.current) return;
      setHealthLoading(false);
    }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLElement>): void {
    if (event.target === event.currentTarget) onClose();
  }

  function renderHealth(reference: HarnessReference, index: number) {
    if (!healthChecked || !reference.doi) return null;

    const checkedDoi = normalizeDoi(reference.doi);
    const doiKey = referenceHealthKey(checkedDoi);
    if (!sentDoiKeys.has(doiKey)) return null;

    const signal = healthSignals.get(doiKey);
    const tone = signal ? referenceRiskTone(signal.risk) : "muted";
    const notices = signal?.editorialNotices ?? [];
    const noticeTone: ReferenceRiskTone = signal?.risk === "blocked" || signal?.retracted ? "danger" : "warn";
    const countsText = signal ? referenceCountsText(signal, t) : null;
    const noticeStyle = noticeTone === "danger" ? referenceHealthStyles.referenceNoticeBlocked : referenceHealthStyles.referenceNotice;

    return (
      <div style={referencesPanelStyles.health}>
        <div style={referenceHealthStyles.referenceHealthBadges}>
          <span className={referenceRiskBadgeClass(tone)} style={referenceRiskBadgeStyles[tone]}>
            {t(signal ? referenceRiskLabelKey(signal.risk) : referenceRiskLabelKey("unknown"))}
          </span>
          {signal?.retracted || notices.length > 0 ? (
            <span className={referenceRiskBadgeClass(noticeTone)} style={referenceRiskBadgeStyles[noticeTone]}>
              <Icon name="alert-triangle" /> {signal?.retracted ? t("library.refhealth.retraction") : t("library.refhealth.notice")}
            </span>
          ) : null}
        </div>
        {countsText ? (
          <p className="field-value" style={referenceHealthStyles.referenceCounts}>
            {countsText}
          </p>
        ) : null}
        <span className="muted-copy" style={referenceHealthStyles.referenceHealthDoi}>
          {interpolate(t("library.refhealth.checkedDoi"), { doi: checkedDoi })}
        </span>
        {notices.map((notice, noticeIndex) => (
          <div
            key={`${index}-${notice.status ?? "notice"}-${notice.date ?? "undated"}-${noticeIndex}`}
            className="judge-nudge"
            role="note"
            style={noticeStyle}
          >
            <Icon name="alert-triangle" /> {referenceNoticeText(notice, t)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="source-viewer" aria-label={t("library.refs.title")} onMouseDown={handleBackdropMouseDown}>
      <div className="source-viewer-card" ref={cardRef} tabIndex={-1}>
        <header className="source-viewer-head">
          <p className="source-viewer-title">
            {t("library.refs.title")} · {title}
          </p>
          <button type="button" className="source-viewer-close" onClick={onClose}>
            {t("viewer.close")}
          </button>
        </header>
        <div className="source-viewer-body">
          {loading ? <p className="source-viewer-state">{t("library.refs.loading")}</p> : null}
          {error ? <p className="source-viewer-state source-viewer-error">{error}</p> : null}
          {!loading && !error && references.length === 0 ? <p className="source-viewer-state">{t("library.refs.empty")}</p> : null}
          {!loading && !error && references.length > 0 ? (
            <>
              {sciteConnected ? (
                <div style={referencesPanelStyles.controls}>
                  <div style={referencesPanelStyles.actionRow}>
                    <div className="judge-nudge" style={referenceHealthStyles.referenceHealthNote}>
                      <Icon name="info-circle" /> {t("library.refhealth.sendsNote")}
                    </div>
                    <button className="action-button" type="button" onClick={() => void checkReferenceHealth()} disabled={healthLoading}>
                      <Icon name={healthLoading ? "loader-2" : "checkup-list"} />{" "}
                      {healthLoading ? t("library.refhealth.checking") : t("library.refhealth.check")}
                    </button>
                  </div>
                  {healthChecked ? (
                    <p className="muted-copy" style={referencesPanelStyles.disclosure}>
                      {interpolate(t("library.refs.checked"), { n: checkedReferenceCount, total: references.length })}
                      {first100Checked ? <span className="muted-badge">{t("library.refs.first100")}</span> : null}
                    </p>
                  ) : null}
                  {healthError ? <p className="source-viewer-state source-viewer-error">{healthError}</p> : null}
                </div>
              ) : null}
              <div style={referencesPanelStyles.list}>
                {references.map((reference, index) => {
                  const metaParts = referenceMetaParts(reference);
                  return (
                    <article key={`${reference.doi ?? reference.title ?? "reference"}-${index}`} style={referencesPanelStyles.reference}>
                      <p style={referencesPanelStyles.title}>{referenceLabel(reference, index, t)}</p>
                      <div style={referencesPanelStyles.meta}>
                        {metaParts.map((part) => (
                          <span key={part} className="citation-text">
                            {part}
                          </span>
                        ))}
                        {reference.doi ? (
                          <a className="locator-link" href={doiHref(reference.doi)} target="_blank" rel="noreferrer">
                            {normalizeDoi(reference.doi)}
                          </a>
                        ) : (
                          <span className="muted-badge">{t("library.refhealth.noDoi")}</span>
                        )}
                      </div>
                      {renderHealth(reference, index)}
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default ReferencesPanel;
