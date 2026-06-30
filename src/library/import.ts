import type { Embedder } from "../retrieve/types.js";
import type { Source } from "../types.js";
import { extractDoiFromText } from "./doi.js";
import type { Library } from "./library.js";
import type { PdfParser } from "./parser.js";

export async function importPdf(
  bytes: Uint8Array,
  opts: { id: string; parser: PdfParser; embedder: Embedder; library: Library },
): Promise<{ source: Source; duplicate: boolean }> {
  const { source, chunks } = await opts.parser.parse(bytes, {
    id: opts.id,
    embedding_model: opts.embedder.model,
    embedding_dim: opts.embedder.dim,
  });
  if (source.citation_metadata.doi === undefined) {
    const doi = extractDoiFromText(chunks[0]?.text.slice(0, 2000) ?? "");
    if (doi !== undefined) source.citation_metadata.doi = doi;
  }
  const existing = opts.library.findBySourceHash(source.source_hash);
  if (existing) return { source: existing, duplicate: true };

  // Reject zero-chunk imports (scanned/image PDF, empty TEI): persisting a chunk-less Source would
  // make listSources() non-empty and permanently defeat the seed-corpus fallback in the runtime.
  if (chunks.length === 0) throw new Error("no extractable text in PDF");
  const vectors = await opts.embedder.embed(chunks.map((c) => c.text), "document");
  opts.library.addSource(
    source,
    chunks.map((chunk, i) => ({ chunk, vector: vectors[i]! })),
  );
  return { source, duplicate: false };
}
