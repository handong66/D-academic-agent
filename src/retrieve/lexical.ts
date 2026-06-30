import type { Db } from "./db.js";
import type { LexicalIndex, LexicalDoc, LexicalHit } from "./types.js";

export class FtsLexicalIndex implements LexicalIndex {
  constructor(private readonly db: Db) {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, source_id UNINDEXED, body)");
  }
  add(docs: LexicalDoc[]): void {
    const ins = this.db.prepare("INSERT INTO chunks_fts(id, source_id, body) VALUES (?, ?, ?)");
    this.db.transaction((ds: LexicalDoc[]) => { for (const d of ds) ins.run(d.id, d.source_id, d.text); })(docs);
  }
  search(query: string, k: number, sourceId?: string, excludeSourceId?: string): LexicalHit[] {
    const q = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" OR ");
    if (!q) return [];
    const where: string[] = ["chunks_fts MATCH ?"];
    const args: (string | number)[] = [q];
    if (sourceId) { where.push("source_id = ?"); args.push(sourceId); }
    if (excludeSourceId) { where.push("source_id != ?"); args.push(excludeSourceId); }
    args.push(k);
    const sql = `SELECT id, bm25(chunks_fts) s FROM chunks_fts WHERE ${where.join(" AND ")} ORDER BY s LIMIT ?`;
    return (this.db.prepare(sql).all(...args) as { id: string; s: number }[]).map((r) => ({ id: r.id, score: -r.s }));
  }
}

// Fallback (later contingency, not M1): MemoryBm25Index implements LexicalIndex — same interface, in-memory inverted index.
