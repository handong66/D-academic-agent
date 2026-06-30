import type { CSSProperties } from "react";
import Icon from "./Icon.js";
import {
  doiHref,
  evidenceForPaper,
  normalizeDoi,
  paperKey,
  referenceCountsText,
  referenceHealthStyles,
  referenceNoticeText,
  referenceRiskBadgeClass,
  referenceRiskBadgeStyles,
  referenceRiskLabelKey,
  referenceRiskTone,
  type ReferenceSignal,
} from "./lib.js";

type Translator = (key: string, params?: Record<string, string | number>) => string;

const externalPaperResultStyles: Record<string, CSSProperties> = {
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

function externalProviderLabelKey(providerId: HarnessExternalPaper["provider"]): string {
  if (providerId === "scite") return "library.external.provider.scite";
  return "library.external.provider.consensus";
}

function ReferenceHealth({ signal, t }: { signal: ReferenceSignal; t: Translator }) {
  const tone = referenceRiskTone(signal.risk);
  const countsText = referenceCountsText(signal, t);
  const notices = signal.editorialNotices ?? [];
  const noticeStyle = signal.risk === "blocked" ? referenceHealthStyles.referenceNoticeBlocked : referenceHealthStyles.referenceNotice;

  return (
    <div className="field field-wide" style={referenceHealthStyles.referenceHealth}>
      <div style={referenceHealthStyles.referenceHealthHead}>
        <span className="field-label">{t("library.refhealth.title")}</span>
        <span className={referenceRiskBadgeClass(tone)} style={referenceRiskBadgeStyles[tone]}>
          {t(referenceRiskLabelKey(signal.risk))}
        </span>
      </div>
      {countsText ? (
        <p className="field-value" style={referenceHealthStyles.referenceCounts}>
          {countsText}
        </p>
      ) : null}
      {notices.map((notice, noticeIndex) => (
        <div
          key={`${notice.status ?? "notice"}-${notice.date ?? "undated"}-${noticeIndex}`}
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

export function ExternalPaperResults({
  result,
  t,
}: {
  result: HarnessExternalSearchResult;
  t: Translator;
}) {
  if (result.papers.length === 0) {
    // Keep the no-results state with the result renderer so Library and Writing Desk share identical result presentation; callers still own loading/error/provider-empty states.
    return (
      <div className="empty-state compact-empty" style={{ minHeight: 118 }}>
        <p>{t("library.external.noResults")}</p>
      </div>
    );
  }

  return (
    <div style={externalPaperResultStyles.resultList} aria-label={t("library.external.results")}>
      {result.papers.map((paper, index) => {
        const evidence = evidenceForPaper(result, paper, index);
        const takeaway = evidence?.quote ?? paper.abstract;
        return (
          <article key={paperKey(paper, index)} className="evidence-card" style={{ marginBottom: 0 }}>
            <div className="mention-head">
              <p className="evidence-source">{paper.title}</p>
              <span className="muted-badge">{t(externalProviderLabelKey(paper.provider))}</span>
            </div>
            <div style={externalPaperResultStyles.paperMeta}>
              <span className="citation-text">
                {paper.authors.length > 0 ? paper.authors.join(", ") : t("library.external.unknownAuthors")}
              </span>
            </div>
            <div style={externalPaperResultStyles.paperFields}>
              <div className="field">
                <span className="field-label">{t("common.year")}</span>
                <p className="field-value">{paper.year ?? t("common.unknown")}</p>
              </div>
              <div className="field">
                <span className="field-label">{t("library.external.journal")}</span>
                <p className="field-value">{paper.journal ?? t("common.unknown")}</p>
              </div>
              <div className="field">
                <span className="field-label">{t("library.external.doi")}</span>
                <p className="field-value">
                  {paper.doi ? (
                    <a className="locator-link" href={doiHref(paper.doi)} target="_blank" rel="noreferrer">
                      {normalizeDoi(paper.doi)}
                    </a>
                  ) : (
                    t("common.unknown")
                  )}
                </p>
              </div>
              <div className="field">
                <span className="field-label">{t("library.external.citations")}</span>
                <p className="field-value">{paper.citationCount ?? t("common.unknown")}</p>
              </div>
            </div>
            {paper.referenceSignal ? <ReferenceHealth signal={paper.referenceSignal} t={t} /> : null}
            {takeaway ? (
              <div className="field field-wide" style={{ marginTop: 10 }}>
                <span className="field-label">{t("library.external.takeaway")}</span>
                <p className="field-value quote">{takeaway}</p>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
