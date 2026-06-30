import { openDb, type Db } from "../retrieve/db.js";
import type { Chunk } from "../retrieve/types.js";
import type { Embedder } from "../retrieve/types.js";
import type { Source } from "../types.js";

export type LibrarySourceSummary = Pick<Source, "id" | "title" | "year" | "type"> & { doi?: string; referenceCount?: number };

export interface Library {
  addSource(source: Source, chunks: { chunk: Chunk; vector: number[] }[]): void;
  findBySourceHash(hash: string): Source | undefined;
  listSources(): LibrarySourceSummary[];
  loadAll(): { sources: Source[]; chunks: Chunk[]; vectors: Map<string, number[]> };
  removeSource(id: string): void;
  staleFor(model: string, dim: number): boolean;
  reindex(embedder: Embedder): Promise<void>;
  close(): void;
}

interface SourceRow {
  id: string;
  title: string;
  authors: string;
  year: string;
  type: Source["type"];
  source_hash: string;
  path_or_url: string;
  citation_metadata: string;
  fulltext_status: Source["fulltext_status"];
}

interface SourceSummaryRow {
  id: string;
  title: string;
  year: string;
  type: Source["type"];
  citation_metadata: string;
}

interface ChunkRow {
  id: string;
  source_id: string;
  source_hash: string;
  ordinal: number;
  section: string;
  char_start: number;
  char_end: number;
  page_start: number | null;
  page_end: number | null;
  text: string;
  embedding: string;
  embedding_model: string;
  embedding_dim: number;
  chunker_version: string;
}

interface ChunkTextRow {
  id: string;
  text: string;
}

function createSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      authors TEXT NOT NULL,
      year TEXT NOT NULL,
      type TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      path_or_url TEXT NOT NULL,
      citation_metadata TEXT NOT NULL,
      fulltext_status TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_hash ON sources(source_hash);

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      section TEXT NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      page_start INTEGER,
      page_end INTEGER,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dim INTEGER NOT NULL,
      chunker_version TEXT NOT NULL
    );
  `);
}

function parseJson<T>(label: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new Error(`Invalid JSON stored for ${label}`, { cause });
  }
}

function validateVector(chunkId: string, raw: unknown, dim: number): number[] {
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`Invalid embedding vector for chunk ${chunkId}: expected numeric array`);
  }
  if (raw.length !== dim) {
    throw new Error(`Invalid embedding vector for chunk ${chunkId}: expected dimension ${dim}, got ${raw.length}`);
  }
  return raw;
}

function sourceFromRow(row: SourceRow): Source {
  return {
    id: row.id,
    title: row.title,
    authors: parseJson<string[]>(`source ${row.id} authors`, row.authors),
    year: row.year,
    type: row.type,
    path_or_url: row.path_or_url,
    source_hash: row.source_hash,
    citation_metadata: parseJson<Source["citation_metadata"]>(`source ${row.id} citation_metadata`, row.citation_metadata),
    fulltext_status: row.fulltext_status,
  };
}

function sourceSummaryFromRow(row: SourceSummaryRow): LibrarySourceSummary {
  const citationMetadata = parseJson<Source["citation_metadata"]>(`source ${row.id} citation_metadata`, row.citation_metadata);
  const rawReferences = citationMetadata.raw?.references;
  const referenceCount = Array.isArray(rawReferences) ? rawReferences.length : undefined;
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    type: row.type,
    ...(citationMetadata.doi === undefined ? {} : { doi: citationMetadata.doi }),
    ...(referenceCount === undefined ? {} : { referenceCount }),
  };
}

function chunkFromRow(row: ChunkRow): Chunk {
  return {
    id: row.id,
    source_id: row.source_id,
    source_hash: row.source_hash,
    ordinal: row.ordinal,
    section: row.section,
    char_start: row.char_start,
    char_end: row.char_end,
    page_start: row.page_start ?? undefined,
    page_end: row.page_end ?? undefined,
    text: row.text,
    chunker_version: row.chunker_version,
    embedding_model: row.embedding_model,
    embedding_dim: row.embedding_dim,
  };
}

export function openLibrary(path: string): Library {
  const db = openDb(path);
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const insertSource = db.prepare(`
    INSERT INTO sources (
      id, title, authors, year, type, source_hash, path_or_url, citation_metadata, fulltext_status, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO chunks (
      id, source_id, ordinal, section, char_start, char_end, page_start, page_end, text,
      embedding, embedding_model, embedding_dim, chunker_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateChunkEmbedding = db.prepare(`
    UPDATE chunks
    SET embedding = ?, embedding_model = ?, embedding_dim = ?
    WHERE id = ?
  `);
  const findSourceByHash = db.prepare("SELECT * FROM sources WHERE source_hash = ? LIMIT 1");

  const addSourceTx = db.transaction((source: Source, chunks: { chunk: Chunk; vector: number[] }[]) => {
    insertSource.run(
      source.id,
      source.title,
      JSON.stringify(source.authors),
      source.year,
      source.type,
      source.source_hash,
      source.path_or_url,
      JSON.stringify(source.citation_metadata),
      source.fulltext_status,
      new Date().toISOString(),
    );

    for (const { chunk, vector } of chunks) {
      validateVector(chunk.id, vector, chunk.embedding_dim);
      insertChunk.run(
        chunk.id,
        source.id,
        chunk.ordinal,
        chunk.section,
        chunk.char_start,
        chunk.char_end,
        chunk.page_start ?? null,
        chunk.page_end ?? null,
        chunk.text,
        JSON.stringify(vector),
        chunk.embedding_model,
        chunk.embedding_dim,
        chunk.chunker_version,
      );
    }
  });

  return {
    addSource(source, chunks) {
      addSourceTx(source, chunks);
    },

    findBySourceHash(hash) {
      const row = findSourceByHash.get(hash) as SourceRow | undefined;
      return row ? sourceFromRow(row) : undefined;
    },

    listSources() {
      const rows = db.prepare("SELECT id, title, year, type, citation_metadata FROM sources ORDER BY added_at, id").all() as SourceSummaryRow[];
      return rows.map(sourceSummaryFromRow);
    },

    loadAll() {
      const sourceRows = db.prepare("SELECT * FROM sources ORDER BY added_at, id").all() as SourceRow[];
      const chunkRows = db.prepare(`
        SELECT
          chunks.id,
          chunks.source_id,
          sources.source_hash AS source_hash,
          chunks.ordinal,
          chunks.section,
          chunks.char_start,
          chunks.char_end,
          chunks.page_start,
          chunks.page_end,
          chunks.text,
          chunks.embedding,
          chunks.embedding_model,
          chunks.embedding_dim,
          chunks.chunker_version
        FROM chunks
        JOIN sources ON sources.id = chunks.source_id
        ORDER BY chunks.source_id, chunks.ordinal, chunks.id
      `).all() as ChunkRow[];
      const vectors = new Map<string, number[]>();
      const chunks = chunkRows.map((row) => {
        vectors.set(row.id, validateVector(row.id, parseJson<unknown>(`chunk ${row.id} embedding`, row.embedding), row.embedding_dim));
        return chunkFromRow(row);
      });
      return { sources: sourceRows.map(sourceFromRow), chunks, vectors };
    },

    removeSource(id) {
      db.prepare("DELETE FROM sources WHERE id = ?").run(id);
    },

    staleFor(model, dim) {
      const row = db.prepare(`
        SELECT 1 AS stale
        FROM chunks
        WHERE embedding_model != ? OR embedding_dim != ?
        LIMIT 1
      `).get(model, dim) as { stale: 1 } | undefined;
      return row !== undefined;
    },

    async reindex(embedder) {
      const rows = db.prepare("SELECT id, text FROM chunks ORDER BY source_id, ordinal, id").all() as ChunkTextRow[];
      if (rows.length === 0) return;

      const embeddings = await embedder.embed(rows.map((row) => row.text), "document");
      const updateTx = db.transaction(() => {
        for (const [i, row] of rows.entries()) {
          const vector = embeddings[i];
          if (!vector) throw new Error(`Missing embedding vector for chunk ${row.id}`);
          validateVector(row.id, vector, embedder.dim);
          updateChunkEmbedding.run(JSON.stringify(vector), embedder.model, embedder.dim, row.id);
        }
      });
      updateTx();
    },

    close() {
      db.close();
    },
  };
}
