import Cite from "citation-js";

export interface BibEntry {
  key: string;
  authors: string[];
  year: string;
  title: string;
}

interface CslName {
  family?: string;
  literal?: string;
}
interface CslItem {
  id?: string;
  title?: string;
  author?: CslName[];
  issued?: { "date-parts"?: number[][] };
}

export function parseBibtex(raw: string): BibEntry[] {
  const data = new Cite(raw).data as CslItem[];
  return data.map((it) => {
    const authors = (it.author ?? []).map((a) => (a.family ?? a.literal ?? "").trim()).filter(Boolean);
    const year = String(it.issued?.["date-parts"]?.[0]?.[0] ?? "");
    return { key: it.id ?? "", authors, year, title: it.title ?? "" };
  });
}
