import { ingestPdf } from "../ingest/pdf.js";
import type { Chunk } from "../retrieve/types.js";
import type { Source } from "../types.js";

export interface PdfParser {
  parse(
    bytes: Uint8Array,
    meta: { id: string; embedding_model: string; embedding_dim: number },
  ): Promise<{ source: Source; chunks: Chunk[] }>;
}

export class UnpdfParser implements PdfParser {
  async parse(
    bytes: Uint8Array,
    meta: { id: string; embedding_model: string; embedding_dim: number },
  ): Promise<{ source: Source; chunks: Chunk[] }> {
    return ingestPdf(bytes, meta);
  }
}
