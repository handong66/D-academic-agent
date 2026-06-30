import type { Source } from "../types.js";

export interface Resolution {
  source_id?: string;
  status: "resolved" | "unresolved" | "ambiguous";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (raw: string, surname: string) => surname.length > 0 && new RegExp(`\\b${esc(surname)}\\b`, "i").test(raw);

export class CitationResolver {
  constructor(
    private readonly sources: Source[],
    private readonly bibKeyToSourceId: Record<string, string> = {},
  ) {}

  resolve(raw: string): Resolution {
    // 1) bibtex key(s): {a} or \cite{a,b}
    const braced = raw.match(/\{([^}]+)\}/)?.[1];
    if (braced) {
      const keys = braced.split(",").map((k) => k.trim());
      const hit = keys.find((k) => this.bibKeyToSourceId[k]);
      if (hit) return { source_id: this.bibKeyToSourceId[hit], status: "resolved" };
    }
    // 2) author-year: match against KNOWN source surnames (never an arbitrary capitalized word).
    //    resolve() handles a SINGLE in-text citation; multi-citation groups like
    //    "(Smith 2021; Wong 2021)" return `ambiguous` — splitting groups is M1's job (Codex review).
    const years = raw.match(/\b(?:19|20)\d{2}\b/g) ?? [];
    if (years.length > 1) return { source_id: undefined, status: "ambiguous" };
    const year = years[0];
    if (year) {
      const sameYear = this.sources.filter((s) => s.year === year);
      const firstAuthorHits = sameYear.filter((s) => has(raw, s.authors[0] ?? ""));
      const pool = firstAuthorHits.length > 0 ? firstAuthorHits : sameYear.filter((s) => s.authors.some((a) => has(raw, a)));
      if (pool.length === 1) return { source_id: pool[0]?.id, status: "resolved" };
      if (pool.length > 1) {
        const byCo = pool.filter((s) => s.authors.slice(1).some((a) => has(raw, a)));
        if (byCo.length === 1) return { source_id: byCo[0]?.id, status: "resolved" };
        return { source_id: undefined, status: "ambiguous" };
      }
    }
    return { source_id: undefined, status: "unresolved" };
  }
}
