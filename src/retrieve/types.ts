export const CHUNKER_VERSION = "1.0";

export interface Chunk {
  id: string; // `${source_id}#${ordinal}`
  source_id: string;
  source_hash: string;
  ordinal: number;
  section: string; // "body" (single-section toy corpus; richer sections at PDF/M4)
  char_start: number;
  char_end: number;
  page_start?: number;
  page_end?: number;
  text: string;
  chunker_version: string;
  embedding_model: string; // provenance (§5)
  embedding_dim: number;
}

export interface RetrievalHit {
  chunk: Chunk;
  bm25_rank: number; // 1-based; 0 if absent
  vector_rank: number; // 1-based; 0 if absent
  vector_distance: number;
  rrf_score: number;
  final_rank: number;
}

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[], role?: "query" | "document"): Promise<number[][]>;
}

export interface LexicalDoc {
  id: string;
  source_id: string;
  text: string;
}
export interface LexicalHit {
  id: string;
  score: number;
}
export interface LexicalIndex {
  add(docs: LexicalDoc[]): void;
  search(query: string, k: number, sourceId?: string, excludeSourceId?: string): LexicalHit[]; // filters BEFORE ranking/limit
}
