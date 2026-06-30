import type { Source } from "../types.js";
import type { Embedder, RetrievalHit, Chunk, LexicalIndex } from "./types.js";
import { chunkSource } from "./chunk.js";
import { openDb } from "./db.js";
import { FtsLexicalIndex } from "./lexical.js";
import { cosine } from "./embed.js";
import { rrfFuse } from "./rrf.js";

export class HybridRetriever {
  constructor(
    private readonly chunks: Map<string, Chunk>,
    private readonly idsBySource: Map<string, string[]>,
    private readonly lexical: LexicalIndex,
    private readonly vectors: Map<string, number[]>,
    private readonly embedder: Embedder,
  ) {}

  async retrieve(query: string, opts: { k: number; sourceId?: string; excludeSourceId?: string }): Promise<RetrievalHit[]> {
    const poolIds = opts.sourceId
      ? (this.idsBySource.get(opts.sourceId) ?? [])
      : opts.excludeSourceId
        ? [...this.chunks.values()].filter((c) => c.source_id !== opts.excludeSourceId).map((c) => c.id)
        : [...this.chunks.keys()];
    const pool = new Set(poolIds);
    const lex = this.lexical.search(query, opts.k * 4, opts.sourceId, opts.excludeSourceId).filter((h) => pool.has(h.id)).map((h) => h.id);
    const [qv] = await this.embedder.embed([query], "query");
    const vec = poolIds
      .map((id) => ({ id, distance: 1 - cosine(qv!, this.vectors.get(id) ?? []) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, opts.k * 4);
    const vdist = new Map(vec.map((h) => [h.id, h.distance]));
    const fused = rrfFuse([lex, vec.map((h) => h.id)]);
    const hits: RetrievalHit[] = [];
    for (const f of fused) {
      const chunk = this.chunks.get(f.id);
      if (!chunk) continue;
      hits.push({ chunk, bm25_rank: f.bm25_rank, vector_rank: f.vector_rank, vector_distance: vdist.get(f.id) ?? 1, rrf_score: f.rrf_score, final_rank: f.final_rank });
      if (hits.length >= opts.k) break;
    }
    return hits;
  }
}

export async function buildIndex(sources: Source[], texts: Map<string, string>, embedder: Embedder, chunksBySource?: Map<string, Chunk[]>): Promise<HybridRetriever> {
  const chunks = new Map<string, Chunk>();
  const idsBySource = new Map<string, string[]>();
  const all: Chunk[] = [];
  for (const s of sources) {
    const list: string[] = [];
    const sourceChunks = chunksBySource?.has(s.id)
      ? chunksBySource.get(s.id)!
      : chunkSource(s.id, s.source_hash, texts.get(s.id) ?? "", embedder.model, embedder.dim);
    for (const c of sourceChunks) {
      chunks.set(c.id, c);
      all.push(c);
      list.push(c.id);
    }
    idsBySource.set(s.id, list);
  }
  const lexical = new FtsLexicalIndex(openDb(":memory:"));
  lexical.add(all.map((c) => ({ id: c.id, source_id: c.source_id, text: c.text })));
  const embs = await embedder.embed(all.map((c) => c.text));
  const vectors = new Map(all.map((c, i) => [c.id, embs[i]!]));
  return new HybridRetriever(chunks, idsBySource, lexical, vectors, embedder);
}

function validateStoredVector(chunk: Chunk, vector: number[] | undefined, dim: number): void {
  if (!vector) {
    throw new Error(`Missing vector for stored chunk ${chunk.id}`);
  }
  if (!Array.isArray(vector) || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`Invalid vector for stored chunk ${chunk.id}: expected numeric array`);
  }
  if (vector.length !== dim) {
    throw new Error(`Invalid vector dimension for stored chunk ${chunk.id}: expected ${dim}, got ${vector.length}`);
  }
}

export function buildIndexFromStored(chunksList: Chunk[], vectors: Map<string, number[]>, embedder: Embedder): HybridRetriever {
  const chunks = new Map<string, Chunk>();
  const idsBySource = new Map<string, string[]>();
  for (const c of chunksList) {
    validateStoredVector(c, vectors.get(c.id), embedder.dim);
    chunks.set(c.id, c);
    const list = idsBySource.get(c.source_id) ?? [];
    list.push(c.id);
    idsBySource.set(c.source_id, list);
  }
  const lexical = new FtsLexicalIndex(openDb(":memory:"));
  lexical.add(chunksList.map((c) => ({ id: c.id, source_id: c.source_id, text: c.text })));
  return new HybridRetriever(chunks, idsBySource, lexical, vectors, embedder);
}
