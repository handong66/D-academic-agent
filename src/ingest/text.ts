import type { Source } from "../types.js";
import { sourceHash } from "./hash.js";

export interface TextIngestInput {
  id: string;
  bibtex_key: string;
  title: string;
  authors: string[];
  year: string;
  path_or_url: string;
  content: string;
  type?: Source["type"];
}

export function ingestTextSource(i: TextIngestInput): Source {
  return {
    id: i.id,
    title: i.title,
    authors: i.authors,
    year: i.year,
    type: i.type ?? "scholarly_article",
    path_or_url: i.path_or_url,
    source_hash: sourceHash(i.content),
    citation_metadata: { bibtex_key: i.bibtex_key },
    fulltext_status: "extracted",
  };
}
