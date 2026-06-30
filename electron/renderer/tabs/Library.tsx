import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent } from "react";
import { ExternalPaperResults } from "../ExternalPaperResults.js";
import Icon from "../Icon";
import ReferencesPanel from "../ReferencesPanel";
import { useT } from "../i18n";
import {
  friendlyErrorMessage,
  interpolate,
  isExternalSearchProvider,
  normalizeDoi,
  referenceHealthKey,
  referenceHealthStyles,
  referenceRiskBadgeClass,
  referenceRiskBadgeStyles,
  referenceRiskLabelKey,
  referenceRiskTone,
  signalsByDoi,
  type ReferenceRiskTone,
  type ReferenceSignal,
} from "../lib";

type ExternalProviderId = HarnessExternalProviderStatus["id"];

const externalStyles: Record<string, CSSProperties> = {
  libraryTopGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  externalPanelBody: {
    display: "grid",
    gap: 12,
    padding: 16,
  },
  externalControls: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 8,
    alignItems: "center",
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
  resultList: {
    display: "grid",
    gap: 10,
    maxHeight: 360,
    overflow: "auto",
  },
  paperMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  paperFields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: 10,
    marginTop: 10,
  },
};

interface LibraryState {
  sources: HarnessSourceSummary[];
  loading: boolean;
  importing: boolean;
  removingId: string | null;
  error: string | null;
  notice: string | null;
  dragActive: boolean;
}

const initialState: LibraryState = {
  sources: [],
  loading: true,
  importing: false,
  removingId: null,
  error: null,
  notice: null,
  dragActive: false,
};

function readFileAsBase64(file: File, t: (key: string) => string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error(t("library.error.failedReadPdf")));
    };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(t("library.error.invalidResult")));
        return;
      }

      const commaIndex = reader.result.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error(t("library.error.invalidDataUrl")));
        return;
      }

      resolve(reader.result.slice(commaIndex + 1));
    };

    reader.readAsDataURL(file);
  });
}

function isExternalProviderId(value: string): value is ExternalProviderId {
  return value === "scite" || value === "consensus";
}

function libraryExternalProviderLabelKey(providerId: ExternalProviderId): string {
  if (providerId === "scite") return "library.external.provider.scite";
  return "library.external.provider.consensus";
}

function LibraryReferenceHealthCell({
  source,
  signal,
  checked,
}: {
  source: HarnessSourceSummary;
  signal: ReferenceSignal | undefined;
  checked: boolean;
}) {
  const t = useT();

  if (!checked) {
    return (
      <td>
        <span className="muted-copy">{t("common.dash")}</span>
      </td>
    );
  }

  if (!source.doi) {
    return (
      <td>
        <span className="muted-badge">{t("library.refhealth.noDoi")}</span>
      </td>
    );
  }

  const checkedDoi = normalizeDoi(source.doi);
  const tone = signal ? referenceRiskTone(signal.risk) : "muted";
  const notices = signal?.editorialNotices ?? [];
  const noticeTone: ReferenceRiskTone = signal?.risk === "blocked" ? "danger" : "warn";

  return (
    <td>
      <div style={referenceHealthStyles.referenceHealthCell}>
        <div style={referenceHealthStyles.referenceHealthBadges}>
          {signal ? (
            <span className={referenceRiskBadgeClass(tone)} style={referenceRiskBadgeStyles[tone]}>
              {t(referenceRiskLabelKey(signal.risk))}
            </span>
          ) : null}
          {notices.length > 0 ? (
            <span className={referenceRiskBadgeClass(noticeTone)} style={referenceRiskBadgeStyles[noticeTone]}>
              <Icon name="alert-triangle" /> {t("library.refhealth.notice")}
            </span>
          ) : null}
        </div>
        <span className="muted-copy" style={referenceHealthStyles.referenceHealthDoi}>
          {interpolate(t("library.refhealth.checkedDoi"), { doi: checkedDoi })}
        </span>
      </div>
    </td>
  );
}

export function LibraryTab() {
  const t = useT();
  const [state, setState] = useState<LibraryState>(initialState);
  const [externalStatuses, setExternalStatuses] = useState<HarnessExternalProviderStatus[]>([]);
  const [externalStatusLoading, setExternalStatusLoading] = useState(true);
  const [externalStatusError, setExternalStatusError] = useState<string | null>(null);
  const [externalQuery, setExternalQuery] = useState("");
  const [selectedExternalProvider, setSelectedExternalProvider] = useState<ExternalProviderId | "">("");
  const [externalSearchLoading, setExternalSearchLoading] = useState(false);
  const [externalSearchError, setExternalSearchError] = useState<string | null>(null);
  const [externalSearchResult, setExternalSearchResult] = useState<HarnessExternalSearchResult | null>(null);
  const [referenceHealthSignals, setReferenceHealthSignals] = useState<Map<string, ReferenceSignal>>(new Map<string, ReferenceSignal>());
  const [referenceHealthChecked, setReferenceHealthChecked] = useState(false);
  const [referenceHealthLoading, setReferenceHealthLoading] = useState(false);
  const [referenceHealthError, setReferenceHealthError] = useState<string | null>(null);
  const [selectedReferencesSourceId, setSelectedReferencesSourceId] = useState<string | null>(null);
  const mounted = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refreshLibrary(): Promise<void> {
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const sources = await window.harness.listLibrary();
      if (!mounted.current) return;
      setState((current) => ({ ...current, sources, loading: false, error: null }));
    } catch (error) {
      if (!mounted.current) return;
      setState((current) => ({ ...current, loading: false, error: friendlyErrorMessage(error, t) }));
    }
  }

  async function refreshExternalProviders(): Promise<void> {
    setExternalStatusLoading(true);
    setExternalStatusError(null);

    try {
      const statuses = await window.harness.externalProviderStatus();
      if (!mounted.current) return;
      const connected = statuses.filter((provider) => provider.enabled && provider.connected);
      setExternalStatuses(statuses);
      setSelectedExternalProvider((current) => {
        if (current && connected.some((provider) => provider.id === current)) return current;
        return connected[0]?.id ?? "";
      });
    } catch (error) {
      if (!mounted.current) return;
      setExternalStatuses([]);
      setSelectedExternalProvider("");
      setExternalStatusError(friendlyErrorMessage(error, t));
    } finally {
      if (!mounted.current) return;
      setExternalStatusLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refreshLibrary();
    void refreshExternalProviders();

    return () => {
      mounted.current = false;
    };
  }, []);

  async function importFile(file: File): Promise<void> {
    setState((current) => ({ ...current, importing: true, error: null, notice: null }));

    try {
      const bytesBase64 = await readFileAsBase64(file, t);
      const { source, duplicate } = await window.harness.importPdf(bytesBase64);
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        notice: duplicate
          ? `${t("library.notice.alreadyInLibrary")} ${source.title || source.id} ${t("library.notice.skippedReimport")}`
          : `${t("library.notice.imported")} ${source.title || source.id}.`,
      }));
      await refreshLibrary();
    } catch (error) {
      if (!mounted.current) return;
      setState((current) => ({ ...current, error: friendlyErrorMessage(error, t) }));
    } finally {
      if (!mounted.current) return;
      setState((current) => ({ ...current, importing: false }));
    }
  }

  async function removeSource(sourceId: string): Promise<void> {
    setState((current) => ({ ...current, removingId: sourceId, error: null, notice: null }));

    try {
      await window.harness.removeSource(sourceId);
      if (!mounted.current) return;
      setState((current) => ({ ...current, notice: `${t("library.notice.removed")} ${sourceId}.` }));
      await refreshLibrary();
    } catch (error) {
      if (!mounted.current) return;
      setState((current) => ({ ...current, error: friendlyErrorMessage(error, t) }));
    } finally {
      if (!mounted.current) return;
      setState((current) => ({ ...current, removingId: null }));
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.item(0);
    event.currentTarget.value = "";
    if (file) void importFile(file);
  }

  async function runExternalSearch(): Promise<void> {
    const query = externalQuery.trim();
    if (externalSearchLoading || !selectedExternalProvider || query.length === 0) return;

    setExternalSearchLoading(true);
    setExternalSearchError(null);

    try {
      const result = await window.harness.externalSearch(selectedExternalProvider, query);
      if (!mounted.current) return;
      setExternalSearchResult(result);
    } catch (error) {
      if (!mounted.current) return;
      setExternalSearchResult(null);
      setExternalSearchError(friendlyErrorMessage(error, t));
    } finally {
      if (!mounted.current) return;
      setExternalSearchLoading(false);
    }
  }

  async function checkReferenceHealth(): Promise<void> {
    if (referenceHealthLoading) return;

    const dois = state.sources.flatMap((source): string[] => (source.doi ? [normalizeDoi(source.doi)] : []));
    setReferenceHealthLoading(true);
    setReferenceHealthError(null);

    try {
      const signals = await window.harness.libraryReferenceHealth(dois);
      if (!mounted.current) return;
      setReferenceHealthSignals(signalsByDoi(signals));
      setReferenceHealthChecked(true);
    } catch (error) {
      if (!mounted.current) return;
      setReferenceHealthSignals(new Map<string, ReferenceSignal>());
      setReferenceHealthChecked(false);
      setReferenceHealthError(friendlyErrorMessage(error, t));
    } finally {
      if (!mounted.current) return;
      setReferenceHealthLoading(false);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setState((current) => ({ ...current, dragActive: true }));
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setState((current) => ({ ...current, dragActive: false }));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setState((current) => ({ ...current, dragActive: false }));

    const file = event.dataTransfer.files.item(0);
    if (file) void importFile(file);
  }

  const sourceCount = state.sources.length;
  const busy = state.loading || state.importing || state.removingId !== null;
  const dropClassName = state.dragActive ? "library-drop library-drop-active" : "library-drop";
  const connectedExternalProviders = externalStatuses.filter(
    (provider) => provider.enabled && provider.connected && isExternalSearchProvider(provider.id),
  );
  const sciteReferenceHealthAvailable = connectedExternalProviders.some((provider) => provider.id === "scite");
  const canSearchExternal =
    !externalSearchLoading && selectedExternalProvider.length > 0 && externalQuery.trim().length > 0 && connectedExternalProviders.length > 0;
  const selectedReferencesSource = selectedReferencesSourceId
    ? state.sources.find((source) => source.id === selectedReferencesSourceId)
    : undefined;

  return (
    <>
    <section className="workspace-panel" aria-labelledby="library-title">
      <header className="workspace-header">
        <div>
          <h2 id="library-title" className="workspace-title">
            {t("library.title")}
          </h2>
          <p className="workspace-kicker">
            {sourceCount === 1 ? t("library.oneImportedSource") : `${sourceCount} ${t("library.importedSources")}`}
          </p>
        </div>
        {busy ? <span className="inline-status">{state.importing ? t("library.importingDots") : t("common.loadingDots")}</span> : null}
      </header>

      <div className="library-layout">
        <div style={externalStyles.libraryTopGrid}>
          <div
            className={dropClassName}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div>
              <p className="drop-title">{t("library.importPdf")}</p>
              <p className="drop-copy">{t("library.dropCopy")}</p>
            </div>
            <button
              className="action-button library-file-button"
              type="button"
              disabled={state.importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {state.importing ? t("library.importingDots") : t("library.choosePdfButton")}
            </button>
            <input
              ref={fileInputRef}
              className="file-input-hidden"
              type="file"
              accept="application/pdf"
              aria-label={t("library.choosePdfAria")}
              disabled={state.importing}
              onChange={handleFileChange}
            />
          </div>

          <section className="subsection" aria-labelledby="library-external-title">
            <h3 id="library-external-title" className="subsection-title">
              {t("library.external.title")}
            </h3>
            <div style={externalStyles.externalPanelBody}>
              <div className="judge-nudge" style={{ margin: 0 }}>
                <Icon name="info-circle" /> {t("library.external.note")}
              </div>

              <div style={externalStyles.externalControls}>
                <input
                  className="thesis-input"
                  style={{ fontFamily: "inherit", fontSize: 13, fontStyle: "normal" }}
                  value={externalQuery}
                  onChange={(event) => setExternalQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runExternalSearch();
                  }}
                  placeholder={t("library.external.queryPlaceholder")}
                  aria-label={t("library.external.queryAria")}
                  disabled={connectedExternalProviders.length === 0}
                />
                <select
                  style={externalStyles.providerSelect}
                  value={selectedExternalProvider}
                  aria-label={t("library.external.providerLabel")}
                  disabled={externalStatusLoading || connectedExternalProviders.length === 0}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSelectedExternalProvider(isExternalProviderId(value) ? value : "");
                  }}
                >
                  {connectedExternalProviders.length === 0 ? <option value="">{t("library.external.noProviderOption")}</option> : null}
                  {connectedExternalProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {t(libraryExternalProviderLabelKey(provider.id))}
                    </option>
                  ))}
                </select>
                <button className="action-button" type="button" onClick={() => void runExternalSearch()} disabled={!canSearchExternal}>
                  <Icon name={externalSearchLoading ? "loader-2" : "search"} />{" "}
                  {externalSearchLoading ? t("library.external.searching") : t("library.external.searchButton")}
                </button>
              </div>

              {externalStatusLoading ? <p className="muted-copy" style={{ padding: 0, margin: 0 }}>{t("library.external.loadingProviders")}</p> : null}
              {!externalStatusLoading && !externalStatusError && connectedExternalProviders.length === 0 ? (
                <div className="empty-state compact-empty" style={{ minHeight: 118 }}>
                  <p>{t("library.external.emptyProviders")}</p>
                </div>
              ) : null}
              {externalStatusError ? <div className="error-banner library-banner">{externalStatusError}</div> : null}
              {externalSearchError ? <div className="error-banner library-banner">{externalSearchError}</div> : null}

              {externalSearchResult ? <ExternalPaperResults result={externalSearchResult} t={t} /> : null}
            </div>
          </section>
        </div>

        {state.error ? <div className="error-banner library-banner">{state.error}</div> : null}
        {state.notice ? <div className="notice-banner library-banner">{state.notice}</div> : null}

        {sciteReferenceHealthAvailable ? (
          <div style={referenceHealthStyles.referenceHealthActions}>
            <div className="judge-nudge" style={referenceHealthStyles.referenceHealthNote}>
              <Icon name="info-circle" /> {t("library.refhealth.sendsNote")}
            </div>
            <div style={referenceHealthStyles.referenceHealthActionGroup}>
              <button className="action-button" type="button" onClick={() => void checkReferenceHealth()} disabled={referenceHealthLoading}>
                <Icon name={referenceHealthLoading ? "loader-2" : "checkup-list"} />{" "}
                {referenceHealthLoading ? t("library.refhealth.checking") : t("library.refhealth.check")}
              </button>
            </div>
          </div>
        ) : null}
        {referenceHealthError ? <div className="error-banner library-banner">{referenceHealthError}</div> : null}

        <div className="table-wrap library-table-wrap">
          <table className="data-table library-table">
            <thead>
              <tr>
                <th>{t("common.title")}</th>
                <th>{t("common.year")}</th>
                <th>{t("common.type")}</th>
                <th>{t("library.refs.title")}</th>
                <th>{t("library.refhealth.title")}</th>
                <th>{t("common.sourceKey")}</th>
                <th>{t("common.action")}</th>
              </tr>
            </thead>
            <tbody>
              {state.sources.map((source) => (
                <tr key={source.id}>
                  <td>{source.title || t("library.untitledSource")}</td>
                  <td>{source.year || t("common.unknown")}</td>
                  <td>{source.type || t("common.unknown")}</td>
                  <td>
                    {source.referenceCount && source.referenceCount > 0 ? (
                      <button className="source-viewer-close" type="button" onClick={() => setSelectedReferencesSourceId(source.id)}>
                        <Icon name="books" /> {interpolate(t("library.refs.button"), { count: source.referenceCount })}
                      </button>
                    ) : null}
                  </td>
                  <LibraryReferenceHealthCell
                    source={source}
                    signal={source.doi ? referenceHealthSignals.get(referenceHealthKey(source.doi)) : undefined}
                    checked={referenceHealthChecked}
                  />
                  <td className="mono-cell">{source.id}</td>
                  <td>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={state.removingId === source.id}
                      onClick={() => void removeSource(source.id)}
                    >
                      {state.removingId === source.id ? t("common.removingDots") : t("common.remove")}
                    </button>
                  </td>
                </tr>
              ))}
              {!state.loading && state.sources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    {t("library.noImportedSources")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
    {selectedReferencesSource ? (
      <ReferencesPanel
        sourceId={selectedReferencesSource.id}
        title={selectedReferencesSource.title || selectedReferencesSource.id}
        sciteConnected={sciteReferenceHealthAvailable}
        onClose={() => setSelectedReferencesSourceId(null)}
      />
    ) : null}
    </>
  );
}
