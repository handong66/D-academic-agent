import { canonicalize } from "../ingest/hash.js";
import { CHUNKER_VERSION, type Chunk } from "./types.js";

export function chunkSource(sourceId: string, sourceHash: string, raw: string, embeddingModel: string, embeddingDim: number): Chunk[] {
  const text = canonicalize(raw);
  const chunks: Chunk[] = [];
  const re = /[^.!?]*[.!?]+|\S[^.!?]*$/g;
  let m: RegExpExecArray | null;
  let ordinal = 0;
  while ((m = re.exec(text)) !== null) {
    const span = m[0];
    const body = span.trim();
    if (!body) continue;
    const start = m.index + span.indexOf(body);
    chunks.push({
      id: `${sourceId}#${ordinal}`,
      source_id: sourceId,
      source_hash: sourceHash,
      ordinal,
      section: "body",
      char_start: start,
      char_end: start + body.length,
      text: body,
      chunker_version: CHUNKER_VERSION,
      embedding_model: embeddingModel,
      embedding_dim: embeddingDim,
    });
    ordinal++;
  }
  return chunks;
}
