import { extractText } from "unpdf";
import type { Source } from "../types.js";
import { canonicalize, sourceHash } from "./hash.js";
import { chunkSource } from "../retrieve/chunk.js";
import type { Chunk } from "../retrieve/types.js";

export interface PdfIngestMeta {
  id: string;
  embedding_model: string;
  embedding_dim: number;
}

interface PageRange {
  page: number;
  start: number;
  end: number;
}

function pageRanges(pages: string[]): { text: string; ranges: PageRange[] } {
  const canonicalPages = pages.map((p) => canonicalize(p));
  const ranges: PageRange[] = [];
  let offset = 0;
  for (const [i, pageText] of canonicalPages.entries()) {
    const start = offset;
    const end = start + pageText.length;
    ranges.push({ page: i + 1, start, end });
    offset = end + (i === canonicalPages.length - 1 ? 0 : 1);
  }
  return { text: canonicalPages.join("\n"), ranges };
}

function pagesForChunk(chunk: Chunk, ranges: PageRange[]): { page_start?: number; page_end?: number } {
  const overlapping = ranges.filter((r) => chunk.char_start < r.end && chunk.char_end > r.start);
  if (overlapping.length === 0) return {};
  return { page_start: overlapping[0]?.page, page_end: overlapping[overlapping.length - 1]?.page };
}

export async function ingestPdf(bytes: Uint8Array, meta: PdfIngestMeta): Promise<{ source: Source; chunks: Chunk[] }> {
  const { text } = await extractText(bytes, { mergePages: false });
  const extracted = pageRanges(text);
  const hash = sourceHash(extracted.text);
  const chunks = chunkSource(meta.id, hash, extracted.text, meta.embedding_model, meta.embedding_dim).map((chunk) => ({
    ...chunk,
    ...pagesForChunk(chunk, extracted.ranges),
    section: "body",
  }));
  return {
    source: {
      id: meta.id,
      title: meta.id,
      authors: [],
      year: "",
      type: "pdf",
      path_or_url: "",
      source_hash: hash,
      citation_metadata: { bibtex_key: meta.id },
      fulltext_status: "indexed",
    },
    chunks,
  };
}
