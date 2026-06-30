# M1 — Index, Hybrid Retrieval, Claim Checker & Eval — Implementation Plan (v2.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless core engine on M0's frozen corpus + gold: chunk & index sources, hybrid-retrieve with RRF (source-scoped for cited-source checks), run a snippet-only claim-citation checker (cited-source support + corpus counter-evidence, both structured), and a reporting-only eval harness emitting confusion matrix + per-class P/R + macro-F1 + retrieval recall@k + overclaim recall + failure examples, plus a versioned `TraceEvent` JSONL.

**Architecture:** Pure-TS, headless, on M0 (`Source`, `sources.lock.json`, `GoldLabel`, `runLint`, canonical `source_hash`). Lexical = SQLite FTS5 behind a `LexicalIndex` interface (in-memory BM25 fallback); vector = in-memory embeddings + brute-force JS cosine (sqlite-vec = later scale upgrade). Fusion = RRF (never score-add). LLM/embedding go through interfaces with deterministic offline mocks for tests (`HashEmbedder`, `MockJudge`) and provider-agnostic real impls (`OpenAIEmbedder`, `LlmJudge`). **Tools are pure: return `TraceEvent`s; only the runner/CLI persists.**

**Tech Stack:** TypeScript (ESM, NodeNext, strict + `noUncheckedIndexedAccess`), Vitest, `better-sqlite3` (FTS5), `zod`, Vercel AI SDK (real embedder/judge only).

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — §5/§6/§9/§10/§11/§14.

**Depends on M0 (locked):** `src/types.ts`, `src/corpus/assemble.ts`, `src/ingest/hash.ts`, `src/eval/gold.ts`, `src/lint/invariants.ts`, `fixtures/corpus`, `fixtures/gold_claims.jsonl`.

---

## 0. v2 changelog (Codex review of v1 → disposition + Claude judgement)

**A. Adopted (real bugs / fidelity gaps)**
- **Retrieval: filter-before-rank.** v1 fused globally then filtered by source → cited-source chunks could be dropped. v2 restricts the candidate pool to the source **first** (lexical via a `source_id` column + vector over the source's chunk ids), then fuses (§5; Task 9).
- **`retrieve()` is async, embeds the query internally** — dropped the awkward `embedQueries` pre-embed hack and its race (Task 9).
- **TraceEvent → §10 typed schema** (`step`, `source_hashes[]`, structured `retrieval[]`, `input_hash`, `output_hash`, `temperature?`, `context_pack_hash?`, `cost?`) instead of a generic `data` bag (Task 10).
- **Checker output contract (§6):** `cited_source_support` gains `suggested_rewrite`; locator gains `section`/`chunker_version`; `corpus_counterevidence.items` are structured `{source_id, locator, snippet, relation, reason}`; **`found` is gated on a real `contradicts` relation** (judge assesses the cross snippet), not "any nearby chunk" (Task 11/12).
- **Eval completeness (§9):** add retrieval `recall@k` (gold locator ∩ retrieved spans), `unsupported`/`overclaim` recall, **failure examples**, and **render the confusion matrix**; `runEval` `mkdir`s `outDir`; per-class iterates the fixed `VERDICTS` enum (Task 13/14).
- **`LexicalIndex` interface** so retrieval stays impl-agnostic; **FTS5 is M1's only implementation** (Task 6). FTS5 unavailability is handled by the Task 2 fail-fast; an in-memory `MemoryBm25Index` behind the same interface is an explicit later contingency, **not** an M1 deliverable.
- **Chunk carries embedding provenance** (`embedding_model`, `embedding_dim`) alongside `chunker_version` (Task 3/9).

**B. Adopted with scope adjustment (my judgement)**
- **overclaim recall needs a gold taxonomy field** → small M0 extension: add optional `overclaim` dimension to `GoldLabel` and populate it in `build_gold.ts` (the info already lives in each rationale). Done in **Task 1** (a deliberate, gated M0 schema bump).
- **section-aware candidates**: the toy sources are single-section, so `section:"body"` is the honest value; the `Chunk.section` field + per-section retrieval hook stay, but real multi-section splitting is deferred to PDF ingest (M4). Not faked.
- **real-provider seed eval artifact**: mocks prove wiring, not quality. Task 16 documents one `LlmJudge`+`OpenAIEmbedder` run that commits `eval/seed-report.md` for portfolio credibility (run manually with a key; never in CI).

**C. Noted**
- Codex could not run vitest (sandbox EPERM); reviews were static + spec-grounded and accurate. better-sqlite3 native-build risk remains, bounded by the Task 2 fail-fast.

**D. v2.1 (Codex re-review of v2 — all four v1 categories confirmed closed)**
- Task 5 `HashEmbedder` increment made `noUncheckedIndexedAccess`-safe: `v[b] = (v[b] ?? 0) + 1`.
- Task 11 counter-evidence now uses an **independent cross-source path** (`retrieve({ excludeSourceId })`) instead of global-top-k-then-filter, so other-source candidates can't be crowded out by cited-source hits.
- BM25 fallback **de-scoped**: FTS5 is M1's only `LexicalIndex` implementation; `MemoryBm25Index` is an explicit later contingency, not claimed or tested in M1.

---

## File Structure

```
academic-agent/src/
  retrieve/{types.ts, chunk.ts, embed.ts, db.ts, lexical.ts, vector.ts, rrf.ts, index.ts}
  trace/trace.ts
  check/{judge.ts, check.ts}
  eval/{metrics.ts, runner.ts}     (+ extends existing eval/gold.ts)
  cli.ts
academic-agent/tests/  (mirrors src)
```

---

## Task 1: Extend gold with an overclaim dimension (M0 schema bump)

**Files:** Modify `src/eval/gold.ts`, `scripts/build_gold.ts`, `fixtures/gold_claims.jsonl`; Test `tests/eval.gold.test.ts`

- [ ] **Step 1: Extend the failing test** — add to `tests/eval.gold.test.ts`:
```ts
import { OVERCLAIM_DIMS } from "../src/eval/gold.js";
it("each label may carry an optional overclaim dimension", () => {
  const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
  const withDim = gold.filter((g) => g.overclaim);
  expect(withDim.length).toBeGreaterThan(0);
  for (const g of withDim) expect(OVERCLAIM_DIMS).toContain(g.overclaim);
});
```
- [ ] **Step 2:** `npm test -- eval.gold` → FAIL.
- [ ] **Step 3: Implement** — in `src/eval/gold.ts` add:
```ts
export const OVERCLAIM_DIMS = ["causality", "scope", "sample", "mentions_only"] as const;
export type OverclaimDim = (typeof OVERCLAIM_DIMS)[number];
```
and add to the `GoldLabel` zod object: `overclaim: z.enum(OVERCLAIM_DIMS).optional(),`
- [ ] **Step 4:** In `scripts/build_gold.ts`, add an optional `overclaim?` to `Spec`, set it on the overclaim specs (e.g. the causal `unsupported` entries → `"causality"`, the keles "leading cause" → `"causality"`, the "all age groups" → `"scope"`, the off-topic academic-performance → `"mentions_only"`, the "large/most" contradicts → `"sample"`), and include `overclaim: sp.overclaim` in the emitted JSON when present. Re-run `npx tsx scripts/build_gold.ts`.
- [ ] **Step 5:** `npm test -- eval.gold && npm run lint && npm run typecheck` → PASS (lint still 0 errors).
- [ ] **Step 6: Commit** `git commit -am "feat(harness): optional overclaim dimension on gold labels (M1 prep)"`

---

## Task 2: DB setup + FTS5 fail-fast

**Files:** Create `src/retrieve/db.ts`; Test `tests/retrieve.db.test.ts`; add `better-sqlite3` + `@types/better-sqlite3`.

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../src/retrieve/db.js";
describe("openDb", () => {
  it("opens in-memory db with FTS5", () => {
    const db = openDb(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(body)");
    db.prepare("INSERT INTO t(body) VALUES (?)").run("social media adolescents");
    expect((db.prepare("SELECT body FROM t WHERE t MATCH ?").get("media") as { body: string }).body).toContain("media");
    db.close();
  });
});
```
- [ ] **Step 2:** `npm install better-sqlite3 && npm install -D @types/better-sqlite3` → `npm test -- retrieve.db`. **If it won't build or FTS5 is absent, stop and record the blocker** (the Task 6 BM25 fallback is the contingency).
- [ ] **Step 3: Implement** `src/retrieve/db.ts`:
```ts
import Database from "better-sqlite3";
export type Db = Database.Database;
export function openDb(path = ":memory:"): Db { const db = new Database(path); db.pragma("journal_mode = WAL"); return db; }
```
- [ ] **Step 4:** `npm test -- retrieve.db && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): better-sqlite3 + FTS5 fail-fast (M1a)"`

---

## Task 3: Retrieval types (provenance) + LexicalIndex interface

**Files:** Create `src/retrieve/types.ts`; Test `tests/retrieve.types.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { CHUNKER_VERSION } from "../src/retrieve/types.js";
describe("retrieve types", () => { it("exposes chunker version", () => { expect(CHUNKER_VERSION).toMatch(/^\d+\.\d+$/); }); });
```
- [ ] **Step 2:** `npm test -- retrieve.types` → FAIL.
- [ ] **Step 3: Implement** `src/retrieve/types.ts`:
```ts
export const CHUNKER_VERSION = "1.0";

export interface Chunk {
  id: string;                 // `${source_id}#${ordinal}`
  source_id: string;
  source_hash: string;
  ordinal: number;
  section: string;            // "body" (single-section toy corpus; richer sections at PDF/M4)
  char_start: number;
  char_end: number;
  text: string;
  chunker_version: string;
  embedding_model: string;    // provenance (§5)
  embedding_dim: number;
}

export interface RetrievalHit {
  chunk: Chunk;
  bm25_rank: number;          // 1-based; 0 if absent
  vector_rank: number;        // 1-based; 0 if absent
  vector_distance: number;
  rrf_score: number;
  final_rank: number;
}

export interface Embedder { readonly model: string; readonly dim: number; embed(texts: string[]): Promise<number[][]>; }

export interface LexicalDoc { id: string; source_id: string; text: string; }
export interface LexicalHit { id: string; score: number; }
export interface LexicalIndex {
  add(docs: LexicalDoc[]): void;
  search(query: string, k: number, sourceId?: string): LexicalHit[]; // sourceId filters BEFORE ranking
}
```
- [ ] **Step 4:** `npm test -- retrieve.types && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): retrieval types — provenance + LexicalIndex interface (M1a)"`

---

## Task 4: Section-aware chunker

**Files:** Create `src/retrieve/chunk.ts`; Test `tests/retrieve.chunk.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { chunkSource } from "../src/retrieve/chunk.js";
const text = "  First about media. Second about sleep. Third one.";
describe("chunkSource", () => {
  it("sentence chunks; slice equals text for every chunk (incl. leading whitespace)", () => {
    const cs = chunkSource("s1", "h1", text, "hash-256", 256);
    expect(cs.length).toBe(3);
    for (const c of cs) expect(text.slice(c.char_start, c.char_end)).toBe(c.text);
    expect(cs[0]!.id).toBe("s1#0");
    expect(cs[0]!.embedding_model).toBe("hash-256");
  });
});
```
- [ ] **Step 2:** `npm test -- retrieve.chunk` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { canonicalize } from "../ingest/hash.js";
import { CHUNKER_VERSION, type Chunk } from "./types.js";
export function chunkSource(sourceId: string, sourceHash: string, raw: string, embeddingModel: string, embeddingDim: number): Chunk[] {
  const text = canonicalize(raw);
  const chunks: Chunk[] = [];
  const re = /[^.!?]*[.!?]+|\S[^.!?]*$/g;
  let m: RegExpExecArray | null; let ordinal = 0;
  while ((m = re.exec(text)) !== null) {
    const span = m[0]; const body = span.trim();
    if (!body) continue;
    const start = m.index + span.indexOf(body);
    chunks.push({ id: `${sourceId}#${ordinal}`, source_id: sourceId, source_hash: sourceHash, ordinal, section: "body",
      char_start: start, char_end: start + body.length, text: body, chunker_version: CHUNKER_VERSION,
      embedding_model: embeddingModel, embedding_dim: embeddingDim });
    ordinal++;
  }
  return chunks;
}
```
- [ ] **Step 4:** `npm test -- retrieve.chunk && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): sentence chunker with stable offsets + provenance (M1a)"`

---

## Task 5: Embedders (deterministic + real)

**Files:** Create `src/retrieve/embed.ts`; Test `tests/retrieve.embed.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { HashEmbedder, cosine } from "../src/retrieve/embed.js";
describe("HashEmbedder", () => {
  it("deterministic + reflects token overlap", async () => {
    const e = new HashEmbedder(64);
    const [a, b, c] = await e.embed(["social media depression", "social media depression", "unrelated cooking recipe"]);
    expect(a).toEqual(b);
    expect(cosine(a!, b!)).toBeCloseTo(1, 5);
    expect(cosine(a!, c!)).toBeLessThan(cosine(a!, b!));
  });
});
```
- [ ] **Step 2:** `npm test -- retrieve.embed` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { createHash } from "node:crypto";
import type { Embedder } from "./types.js";
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
const bucket = (t: string, dim: number) => parseInt(createHash("sha1").update(t).digest("hex").slice(0, 8), 16) % dim;
export class HashEmbedder implements Embedder {
  readonly model: string;
  constructor(readonly dim = 256) { this.model = `hash-${dim}`; }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dim).fill(0);
      for (const tok of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) { const b = bucket(tok, this.dim); v[b] = (v[b] ?? 0) + 1; } // noUncheckedIndexedAccess-safe
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}
// Real: class OpenAIEmbedder implements Embedder { ... embedMany from "ai" ... } — used by eval with a live key.
```
- [ ] **Step 4:** `npm test -- retrieve.embed && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): HashEmbedder + cosine (real embedder pluggable) (M1a)"`

---

## Task 6: LexicalIndex — FTS5 (source-filtered) + BM25 fallback

**Files:** Create `src/retrieve/lexical.ts`; Test `tests/retrieve.lexical.test.ts`

- [ ] **Step 1: Failing test** (covers source filtering)
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../src/retrieve/db.js";
import { FtsLexicalIndex } from "../src/retrieve/lexical.js";
describe("FtsLexicalIndex", () => {
  it("ranks match first and filters by source before ranking", () => {
    const idx = new FtsLexicalIndex(openDb(":memory:"));
    idx.add([{ id: "a", source_id: "s1", text: "social media adolescent depression" }, { id: "b", source_id: "s2", text: "social media adolescent depression" }]);
    expect(idx.search("adolescent depression", 5)[0]?.id).toBeDefined();
    const only = idx.search("adolescent depression", 5, "s1");
    expect(only.every((h) => h.id === "a")).toBe(true);
  });
});
```
- [ ] **Step 2:** `npm test -- retrieve.lexical` → FAIL.
- [ ] **Step 3: Implement** (FTS with a stored `source_id` column)
```ts
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
  search(query: string, k: number, sourceId?: string): LexicalHit[] {
    const q = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" OR ");
    if (!q) return [];
    const sql = `SELECT id, bm25(chunks_fts) s FROM chunks_fts WHERE chunks_fts MATCH ?${sourceId ? " AND source_id = ?" : ""} ORDER BY s LIMIT ?`;
    const args = sourceId ? [q, sourceId, k] : [q, k];
    return (this.db.prepare(sql).all(...args) as { id: string; s: number }[]).map((r) => ({ id: r.id, score: -r.s }));
  }
}
// Fallback (if FTS5 unavailable): class MemoryBm25Index implements LexicalIndex — same interface, in-memory inverted index.
```
- [ ] **Step 4:** `npm test -- retrieve.lexical && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): FTS5 lexical index with source filtering (M1a)"`

---

## Task 7: RRF fusion

**Files:** Create `src/retrieve/rrf.ts`; Test `tests/retrieve.rrf.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { rrfFuse } from "../src/retrieve/rrf.js";
describe("rrfFuse", () => {
  it("fuses by reciprocal rank, not raw-score addition", () => {
    const f = rrfFuse([["a", "b", "c"], ["b", "a"]], 60);
    expect(f[0]?.id).toBe("a");
    expect(f.find((x) => x.id === "c")!.rrf_score).toBeLessThan(f.find((x) => x.id === "a")!.rrf_score);
  });
});
```
- [ ] **Step 2:** `npm test -- retrieve.rrf` → FAIL.
- [ ] **Step 3: Implement**
```ts
export interface FusedHit { id: string; rrf_score: number; bm25_rank: number; vector_rank: number; final_rank: number; }
export function rrfFuse(rankings: string[][], k = 60): FusedHit[] {
  const ranks = rankings.map((r) => new Map(r.map((id, i) => [id, i + 1])));
  const out: FusedHit[] = [];
  for (const id of new Set(rankings.flat())) {
    let score = 0; for (const r of ranks) { const rank = r.get(id); if (rank) score += 1 / (k + rank); }
    out.push({ id, rrf_score: score, bm25_rank: ranks[0]?.get(id) ?? 0, vector_rank: ranks[1]?.get(id) ?? 0, final_rank: 0 });
  }
  out.sort((a, b) => b.rrf_score - a.rrf_score);
  out.forEach((h, i) => (h.final_rank = i + 1));
  return out;
}
```
- [ ] **Step 4:** `npm test -- retrieve.rrf && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): RRF fusion (rank-based) (M1a)"`

---

## Task 8: HybridRetriever — async, filter-before-rank, provenance

**Files:** Create `src/retrieve/index.ts`; Test `tests/retrieve.hybrid.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
describe("HybridRetriever", () => {
  it("source-filtered retrieval returns only cited-source chunks (filter before rank)", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await buildIndex(sources, texts, new HashEmbedder(256));
    const hits = await r.retrieve("does social media cause depression", { k: 5, sourceId: "twenge2018" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.chunk.source_id === "twenge2018")).toBe(true);
  });
});
```
- [ ] **Step 2:** `npm test -- retrieve.hybrid` → FAIL.
- [ ] **Step 3: Implement**
```ts
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
    const lex = this.lexical.search(query, opts.k * 4, opts.sourceId).filter((h) => pool.has(h.id)).map((h) => h.id);
    const [qv] = await this.embedder.embed([query]);
    const vec = poolIds.map((id) => ({ id, distance: 1 - cosine(qv!, this.vectors.get(id) ?? []) }))
      .sort((a, b) => a.distance - b.distance).slice(0, opts.k * 4);
    const vdist = new Map(vec.map((h) => [h.id, h.distance]));
    const fused = rrfFuse([lex, vec.map((h) => h.id)]);
    const hits: RetrievalHit[] = [];
    for (const f of fused) {
      const chunk = this.chunks.get(f.id); if (!chunk) continue;
      hits.push({ chunk, bm25_rank: f.bm25_rank, vector_rank: f.vector_rank, vector_distance: vdist.get(f.id) ?? 1, rrf_score: f.rrf_score, final_rank: f.final_rank });
      if (hits.length >= opts.k) break;
    }
    return hits;
  }
}

export async function buildIndex(sources: Source[], texts: Map<string, string>, embedder: Embedder): Promise<HybridRetriever> {
  const chunks = new Map<string, Chunk>(); const idsBySource = new Map<string, string[]>(); const all: Chunk[] = [];
  for (const s of sources) {
    const list: string[] = [];
    for (const c of chunkSource(s.id, s.source_hash, texts.get(s.id) ?? "", embedder.model, embedder.dim)) {
      chunks.set(c.id, c); all.push(c); list.push(c.id);
    }
    idsBySource.set(s.id, list);
  }
  const lexical = new FtsLexicalIndex(openDb(":memory:"));
  lexical.add(all.map((c) => ({ id: c.id, source_id: c.source_id, text: c.text })));
  const embs = await embedder.embed(all.map((c) => c.text));
  const vectors = new Map(all.map((c, i) => [c.id, embs[i]!]));
  return new HybridRetriever(chunks, idsBySource, lexical, vectors, embedder);
}
```
- [ ] **Step 4:** `npm test -- retrieve.hybrid && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): hybrid retriever — async, filter-before-rank, provenance-scored (M1a)"`

---

## Task 9: TraceEvent (§10 typed) + Tracer

**Files:** Create `src/trace/trace.ts`; Test `tests/trace.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { Tracer } from "../src/trace/trace.js";
describe("Tracer", () => {
  it("emits the §10 typed schema; tools never persist", () => {
    const t = new Tracer({ model_id: "mock", prompt_version: "p1" });
    t.add({ event_type: "retrieve", input: { q: "x" }, output: { ids: ["a"] }, source_hashes: ["h"], retrieval: [{ bm25_rank: 1, vector_distance: 0.1, rrf_score: 0.2, final_rank: 1 }] });
    const [e] = t.drain();
    expect(e!.schema_version).toBe("1.0");
    expect(e!.step).toBe(0);
    expect(e!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e!.retrieval?.[0]?.final_rank).toBe(1);
    expect(t.drain()).toHaveLength(0);
  });
});
```
- [ ] **Step 2:** `npm test -- trace` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { createHash } from "node:crypto";
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x ?? null)).digest("hex");
export interface RetrievalScore { bm25_rank: number; vector_distance: number; rrf_score: number; final_rank: number; }
export interface TraceEvent {
  schema_version: "1.0"; event_type: string; step: number; ts: string;
  model_id: string; prompt_version: string; temperature?: number; context_pack_hash?: string;
  source_hashes: string[]; retrieval?: RetrievalScore[]; input_hash: string; output_hash: string;
  cost?: number; outbound_snippets: string[];
}
export class Tracer {
  private events: TraceEvent[] = []; private step = 0;
  constructor(private readonly ctx: { model_id: string; prompt_version: string }) {}
  add(e: { event_type: string; input?: unknown; output?: unknown; source_hashes?: string[]; retrieval?: RetrievalScore[]; outbound_snippets?: string[]; temperature?: number; context_pack_hash?: string; cost?: number }): void {
    this.events.push({ schema_version: "1.0", event_type: e.event_type, step: this.step++, ts: new Date().toISOString(),
      model_id: this.ctx.model_id, prompt_version: this.ctx.prompt_version, temperature: e.temperature, context_pack_hash: e.context_pack_hash,
      source_hashes: e.source_hashes ?? [], retrieval: e.retrieval, input_hash: sha(e.input), output_hash: sha(e.output), cost: e.cost, outbound_snippets: e.outbound_snippets ?? [] });
  }
  drain(): TraceEvent[] { const e = this.events; this.events = []; return e; }
}
```
- [ ] **Step 4:** `npm test -- trace && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): versioned §10 TraceEvent + Tracer (tools never persist) (M1b)"`

---

## Task 10: Judge interface + MockJudge + LlmJudge

**Files:** Create `src/check/judge.ts`; Test `tests/check.judge.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { MockJudge } from "../src/check/judge.js";
describe("MockJudge", () => {
  it("snippet-only verdict + suggested_rewrite (deterministic)", async () => {
    const r = await new MockJudge().judge({ claim: "X causes Y", snippet: "the study does not establish that X causes Y" });
    expect(["supports", "weakly_supports", "unsupported", "contradicts", "unclear"]).toContain(r.verdict);
    expect(typeof r.suggested_rewrite).toBe("string");
  });
});
```
- [ ] **Step 2:** `npm test -- check.judge` → FAIL.
- [ ] **Step 3: Implement**
```ts
import type { Verdict } from "../types.js";
export interface JudgeInput { claim: string; snippet: string; }
export interface JudgeOutput { verdict: Verdict; reason: string; confidence: number; suggested_rewrite: string; }
export interface Judge { readonly model: string; judge(input: JudgeInput): Promise<JudgeOutput>; }
export class MockJudge implements Judge {
  readonly model = "mock-judge";
  async judge({ claim, snippet }: JudgeInput): Promise<JudgeOutput> {
    const s = snippet.toLowerCase();
    if (s.includes("does not") || s.includes("cannot")) return { verdict: "unsupported", reason: "snippet negates/limits the claim", confidence: 0.5, suggested_rewrite: `Soften: the source does not establish "${claim}".` };
    const overlap = (claim.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => s.includes(w)).length;
    return overlap >= 3 ? { verdict: "supports", reason: "snippet overlaps the claim", confidence: 0.6, suggested_rewrite: "" } : { verdict: "unclear", reason: "insufficient overlap", confidence: 0.3, suggested_rewrite: `Retrieve stronger evidence for "${claim}".` };
  }
}
// Real: class LlmJudge implements Judge — Vercel AI SDK generateObject, zod schema, SNIPPET-ONLY system prompt
// (constitutions/CLAIM_CHECK_CONSTITUTION.md). Used by eval with a live key; never unit-tested.
```
- [ ] **Step 4:** `npm test -- check.judge && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): Judge + deterministic MockJudge with suggested_rewrite (M1b)"`

---

## Task 11: checkClaim — structured two outputs, snippet-only, traces

**Files:** Create `src/check/check.ts`; Test `tests/check.check.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { checkClaim } from "../src/check/check.js";
describe("checkClaim", () => {
  it("returns structured cited-support + counterevidence + §10 traces", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await checkClaim({ claim: "Social media use causes depression", cited_source: "twenge2018" }, await buildIndex(sources, texts, new HashEmbedder(256)), new MockJudge());
    expect(r.cited_source_support.locator.source_id).toBe("twenge2018");
    expect(r.cited_source_support).toHaveProperty("suggested_rewrite");
    expect(typeof r.corpus_counterevidence.found).toBe("boolean");
    for (const it of r.corpus_counterevidence.items) expect(it).toHaveProperty("relation");
    expect(r.traces[0]?.schema_version).toBe("1.0");
  });
});
```
- [ ] **Step 2:** `npm test -- check.check` → FAIL.
- [ ] **Step 3: Implement**
```ts
import type { Verdict } from "../types.js";
import type { HybridRetriever } from "../retrieve/index.js";
import type { Judge } from "./judge.js";
import { Tracer, type TraceEvent } from "../trace/trace.js";
export interface Locator { source_id: string; source_hash: string; char_start: number; char_end: number; section: string; chunker_version: string; }
export interface CitedSourceSupport { verdict: Verdict; locator: Locator; quote: string; reason: string; suggested_rewrite: string; confidence: number; }
export interface CounterItem { source_id: string; locator: Locator; snippet: string; relation: "contradicts" | "supports" | "unrelated"; reason: string; }
export interface CorpusCounterevidence { found: boolean; items: CounterItem[]; }
export interface CheckResult { cited_source_support: CitedSourceSupport; corpus_counterevidence: CorpusCounterevidence; traces: TraceEvent[]; }
const loc = (c: { source_id: string; source_hash: string; char_start: number; char_end: number; section: string; chunker_version: string }): Locator => ({ source_id: c.source_id, source_hash: c.source_hash, char_start: c.char_start, char_end: c.char_end, section: c.section, chunker_version: c.chunker_version });

export async function checkClaim(input: { claim: string; cited_source: string }, retriever: HybridRetriever, judge: Judge, k = 3): Promise<CheckResult> {
  const tracer = new Tracer({ model_id: judge.model, prompt_version: "check-1.0" });
  // (a) cited-source support — retrieve WITHIN the cited source, judge top snippet ONLY
  const inSrc = await retriever.retrieve(input.claim, { k, sourceId: input.cited_source });
  tracer.add({ event_type: "retrieve_cited", input: { claim: input.claim, source: input.cited_source }, output: inSrc.map((h) => h.chunk.id), source_hashes: inSrc.map((h) => h.chunk.source_hash), retrieval: inSrc.map((h) => ({ bm25_rank: h.bm25_rank, vector_distance: h.vector_distance, rrf_score: h.rrf_score, final_rank: h.final_rank })) });
  const top = inSrc[0]; const snippet = top?.chunk.text ?? "";
  const j = await judge.judge({ claim: input.claim, snippet });
  tracer.add({ event_type: "judge_cited", input: { snippet }, output: { verdict: j.verdict }, outbound_snippets: [snippet] });
  const cited_source_support: CitedSourceSupport = { verdict: j.verdict, locator: top ? loc(top.chunk) : { source_id: input.cited_source, source_hash: "", char_start: 0, char_end: 0, section: "body", chunker_version: "1.0" }, quote: snippet, reason: j.reason, suggested_rewrite: j.suggested_rewrite, confidence: j.confidence };

  // (b) counter-evidence — nearest OTHER-source chunks, judged for a `contradicts` RELATION (not "any nearby chunk")
  const cross = await retriever.retrieve(input.claim, { k, excludeSourceId: input.cited_source }); // independent cross-source candidate path (Codex re-review)
  const items: CounterItem[] = [];
  for (const h of cross) {
    const rj = await judge.judge({ claim: input.claim, snippet: h.chunk.text });
    const relation = rj.verdict === "contradicts" ? "contradicts" : rj.verdict === "supports" ? "supports" : "unrelated";
    tracer.add({ event_type: "judge_counter", input: { source: h.chunk.source_id, snippet: h.chunk.text }, output: { relation }, outbound_snippets: [h.chunk.text] });
    items.push({ source_id: h.chunk.source_id, locator: loc(h.chunk), snippet: h.chunk.text, relation, reason: rj.reason });
  }
  const corpus_counterevidence: CorpusCounterevidence = { found: items.some((i) => i.relation === "contradicts"), items };
  return { cited_source_support, corpus_counterevidence, traces: tracer.drain() };
}
```
- [ ] **Step 4:** `npm test -- check.check && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): checkClaim — structured support + relation-gated counterevidence, snippet-only (M1b)"`

---

## Task 12: Eval metrics — per-class (full enum), recall@k, overclaim recall, failures

**Files:** Create `src/eval/metrics.ts`; Test `tests/eval.metrics.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { confusionMatrix, perClass, macroF1, recallAtK } from "../src/eval/metrics.js";
describe("metrics", () => {
  it("per-class over the fixed enum + macro-F1", () => {
    const g = ["supports", "unsupported", "supports", "contradicts"], p = ["supports", "unsupported", "unsupported", "contradicts"];
    expect(confusionMatrix(g, p).supports?.supports).toBe(1);
    expect(perClass(g, p).supports?.recall).toBeCloseTo(0.5);
    expect(perClass(g, p).weakly_supports).toBeDefined();    // zero row present (fixed enum)
    expect(macroF1(g, p)).toBeGreaterThan(0);
  });
  it("retrieval recall@k by span overlap", () => {
    expect(recallAtK([{ gold: [10, 20], retrieved: [[5, 15], [30, 40]] }], 2)).toBe(1);
    expect(recallAtK([{ gold: [10, 20], retrieved: [[30, 40]] }], 2)).toBe(0);
  });
});
```
- [ ] **Step 2:** `npm test -- eval.metrics` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { VERDICTS } from "../types.js";
export function confusionMatrix(gold: string[], pred: string[]): Record<string, Record<string, number>> {
  const cm: Record<string, Record<string, number>> = {};
  for (const v of VERDICTS) { cm[v] = {}; for (const w of VERDICTS) cm[v]![w] = 0; }
  gold.forEach((g, i) => { const p = pred[i] ?? "unclear"; cm[g] = cm[g] ?? {}; cm[g]![p] = (cm[g]![p] ?? 0) + 1; });
  return cm;
}
export function perClass(gold: string[], pred: string[]): Record<string, { precision: number; recall: number; f1: number }> {
  const out: Record<string, { precision: number; recall: number; f1: number }> = {};
  for (const L of VERDICTS) {
    let tp = 0, fp = 0, fn = 0;
    gold.forEach((g, i) => { const p = pred[i]; if (p === L && g === L) tp++; else if (p === L && g !== L) fp++; else if (p !== L && g === L) fn++; });
    const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
    out[L] = { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
  }
  return out;
}
export const macroF1 = (g: string[], p: string[]) => { const v = Object.values(perClass(g, p)); return v.length ? v.reduce((s, c) => s + c.f1, 0) / v.length : 0; };
export function recallAtK(items: { gold: [number, number]; retrieved: [number, number][] }[], k: number): number {
  if (!items.length) return 0;
  const hit = items.filter((it) => it.retrieved.slice(0, k).some(([a, b]) => a < it.gold[1] && b > it.gold[0])).length;
  return hit / items.length;
}
```
- [ ] **Step 4:** `npm test -- eval.metrics && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): eval metrics — full-enum P/R, macro-F1, recall@k (M1c)"`

---

## Task 13: Eval runner — reporting-only; mkdir; confusion + failures; recall@k + overclaim recall

**Files:** Create `src/eval/runner.ts`; Test `tests/eval.runner.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { runEval } from "../src/eval/runner.js";
import { HashEmbedder } from "../src/retrieve/embed.js"; import { MockJudge } from "../src/check/judge.js";
describe("runEval", () => {
  it("writes report (with confusion + failures) + trace.jsonl; reporting-only", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "eval-")), "nested"); // dir does not exist yet
    const res = await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: out }, new HashEmbedder(256), new MockJudge());
    expect(res.n).toBe(23);
    expect(res).not.toHaveProperty("passed");
    expect(existsSync(join(out, "trace.jsonl"))).toBe(true);
    const report = readFileSync(join(out, "report.md"), "utf8");
    expect(report).toContain("Confusion");
    expect(report).toContain("Failures");
    expect(typeof res.retrieval_recall_at_k).toBe("number");
  });
});
```
- [ ] **Step 2:** `npm test -- eval.runner` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { writeFileSync, mkdirSync, readFileSync } from "node:fs"; import { join } from "node:path";
import type { Embedder } from "../retrieve/types.js"; import type { Judge } from "../check/judge.js";
import { assembleSources } from "../corpus/assemble.js"; import { loadGoldClaims } from "./gold.js";
import { buildIndex } from "../retrieve/index.js"; import { checkClaim } from "../check/check.js";
import { confusionMatrix, perClass, macroF1, recallAtK } from "./metrics.js"; import type { TraceEvent } from "../trace/trace.js";
export interface EvalReport { n: number; macro_f1: number; retrieval_recall_at_k: number; overclaim_recall: number; confusion: Record<string, Record<string, number>>; per_class: Record<string, { precision: number; recall: number; f1: number }>; failures: { claim: string; gold: string; pred: string }[]; }

export async function runEval(opts: { corpusDir: string; goldPath: string; outDir: string; k?: number }, embedder: Embedder, judge: Judge): Promise<EvalReport> {
  const k = opts.k ?? 3;
  const { sources } = assembleSources(opts.corpusDir);
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join(opts.corpusDir, `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  const retriever = await buildIndex(sources, texts, embedder);
  const gold = loadGoldClaims(opts.goldPath);
  const goldL: string[] = [], predL: string[] = [], traces: TraceEvent[] = [];
  const recallItems: { gold: [number, number]; retrieved: [number, number][] }[] = [];
  const failures: { claim: string; gold: string; pred: string }[] = [];
  for (const g of gold) {
    const r = await checkClaim({ claim: g.claim_text, cited_source: g.cited_source }, retriever, judge, k);
    goldL.push(g.label); predL.push(r.cited_source_support.verdict);
    if (g.label !== r.cited_source_support.verdict) failures.push({ claim: g.claim_text, gold: g.label, pred: r.cited_source_support.verdict });
    const hits = await retriever.retrieve(g.claim_text, { k, sourceId: g.cited_source });
    recallItems.push({ gold: [g.locator.char_start, g.locator.char_end], retrieved: hits.map((h) => [h.chunk.char_start, h.chunk.char_end] as [number, number]) });
    traces.push(...r.traces);
  }
  const overclaimGold = gold.map((g, i) => ({ g, pred: predL[i]! })).filter((x) => x.g.overclaim);
  const overclaim_recall = overclaimGold.length ? overclaimGold.filter((x) => x.pred !== "supports").length / overclaimGold.length : 0;
  const report: EvalReport = { n: gold.length, macro_f1: macroF1(goldL, predL), retrieval_recall_at_k: recallAtK(recallItems, k), overclaim_recall, confusion: confusionMatrix(goldL, predL), per_class: perClass(goldL, predL), failures };
  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(join(opts.outDir, "trace.jsonl"), traces.map((t) => JSON.stringify(t)).join("\n") + "\n");
  writeFileSync(join(opts.outDir, "report.md"), render(report, judge.model, embedder.model, k));
  return report;
}

function render(r: EvalReport, judge: string, embedder: string, k: number): string {
  const labels = Object.keys(r.per_class);
  const head = `| gold\\pred | ${labels.join(" | ")} |\n|${"---|".repeat(labels.length + 1)}`;
  const conf = labels.map((g) => `| ${g} | ${labels.map((p) => r.confusion[g]?.[p] ?? 0).join(" | ")} |`).join("\n");
  const pc = labels.map((L) => `| ${L} | ${r.per_class[L]!.precision.toFixed(2)} | ${r.per_class[L]!.recall.toFixed(2)} | ${r.per_class[L]!.f1.toFixed(2)} |`).join("\n");
  const fail = r.failures.map((f) => `- [${f.gold}→${f.pred}] ${f.claim}`).join("\n") || "- (none)";
  return `# Eval Report (seed, reporting-only)\n\njudge=${judge} · embedder=${embedder} · n=${r.n} · macro-F1=${r.macro_f1.toFixed(3)} · retrieval recall@${k}=${r.retrieval_recall_at_k.toFixed(3)} · overclaim recall=${r.overclaim_recall.toFixed(3)}\n\n> Seed set — NOT an authoritative benchmark. No pass/fail threshold.\n\n## Per-class\n| label | P | R | F1 |\n|---|---|---|---|\n${pc}\n\n## Confusion\n${head}\n${conf}\n\n## Failures\n${fail}\n`;
}
```
- [ ] **Step 4:** `npm test -- eval.runner && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): eval runner — confusion+failures+recall@k+overclaim, mkdir, runner-persisted (M1c)"`

---

## Task 14: CLI (eval --mock)

**Files:** Create `src/cli.ts`; add `"harness": "tsx src/cli.ts"` to package.json; Test `tests/cli.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
describe("runCli", () => { it("eval --mock writes a report offline", async () => {
  const out = mkdtempSync(join(tmpdir(), "cli-"));
  await runCli(["eval", "--mock", "--out", out]);
  expect(existsSync(join(out, "report.md"))).toBe(true);
}); });
```
- [ ] **Step 2:** `npm test -- cli` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { fileURLToPath } from "node:url";
import { runEval } from "./eval/runner.js"; import { HashEmbedder } from "./retrieve/embed.js"; import { MockJudge } from "./check/judge.js";
export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv; const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "eval") {
    const out = flag("--out") ?? "out";
    if (!rest.includes("--mock")) throw new Error("real provider path needs AGENT_* env; pass --mock for offline run");
    await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: out }, new HashEmbedder(256), new MockJudge());
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
```
- [ ] **Step 4:** `npm test -- cli && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): CLI eval --mock offline path (M1c)"`

---

## Task 15: End-to-end smoke + green gate

**Files:** Test `tests/integration.m1-eval.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { runEval } from "../src/eval/runner.js"; import { HashEmbedder } from "../src/retrieve/embed.js"; import { MockJudge } from "../src/check/judge.js";
describe("M1 end-to-end", () => {
  it("ingest→index→retrieve→check→eval→trace over full gold", async () => {
    const r = await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: mkdtempSync(join(tmpdir(), "m1-")) }, new HashEmbedder(256), new MockJudge());
    expect(r.n).toBe(23);
    expect(Object.keys(r.per_class)).toHaveLength(5);
    expect(r.retrieval_recall_at_k).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2:** `npm test -- integration.m1-eval` → PASS (wiring exists).
- [ ] **Step 3:** Full gate: `npm test && npm run typecheck && npm run lint` → all green.
- [ ] **Step 4: Commit** `git commit -am "test(harness): M1 end-to-end eval smoke over full gold (M1c)"`

---

## Task 16: Real-provider seed eval artifact (manual, with key)

**Files:** Create `src/retrieve/openai-embedder.ts`, `src/check/llm-judge.ts`; commit `eval/seed-report.md`

- [ ] **Step 1:** Implement `OpenAIEmbedder implements Embedder` (`embedMany` from `ai` + an OpenAI-compatible provider via `AGENT_BASE_URL`/`AGENT_MODEL`/key) and `LlmJudge implements Judge` (`generateObject` with the `JudgeOutput` zod schema; system prompt = snippet-only per `constitutions/CLAIM_CHECK_CONSTITUTION.md`). No unit tests (needs network).
- [ ] **Step 2:** Wire the non-`--mock` CLI branch to select these from env.
- [ ] **Step 3:** Run once with a key: `AGENT_BASE_URL=… AGENT_MODEL=… npm run harness -- eval --out eval` → copy `eval/report.md` to `eval/seed-report.md` (the credible, real-provider seed numbers for the portfolio).
- [ ] **Step 4: Commit** `git commit -am "feat(harness): real OpenAI-compatible embedder + LLM judge; commit seed eval report (M1c)"`

---

## M1 Done — Acceptance (spec §15 M1)

- [ ] `npm test` green; `npm run typecheck` clean; `npm run lint` exit 0.
- [ ] Retrieval: RRF hybrid; **cited-source retrieval filters by source before ranking**; `bm25_rank/vector_rank/rrf_score/final_rank` + provenance available.
- [ ] `checkClaim`: snippet-only; **`cited_source_support`** (verdict + structured locator + quote + reason + **suggested_rewrite** + confidence) and **`corpus_counterevidence`** (`found` gated on a `contradicts` relation; structured items) as separate fields; returns `TraceEvent`s.
- [ ] Eval (reporting-only): confusion matrix + per-class P/R (full enum) + macro-F1 + **retrieval recall@k** + **overclaim recall** + **failure examples**; report + `trace.jsonl` written **by the runner**; no pass/fail threshold.
- [ ] `TraceEvent` matches §10 typed schema (step/source_hashes/structured retrieval/input&output hash/outbound_snippets).
- [ ] One real-provider seed eval report committed (`eval/seed-report.md`).

## Out of scope
M2: MCP server + planner subagent + DX + sqlite-vec. M3: Electron app. M4: PDF ingest, lit-matrix, co-evolution artifacts.

## Self-Review (plan author)
- **Spec coverage:** §5 (RRF, filter-before-rank, provenance) → T3/T6/T8; §6 (snippet-only, two structured outputs, suggested_rewrite, relation-gated found) → T10/T11; §9 (confusion, per-class, macro-F1, recall@k, overclaim recall, failures, reporting-only) → T1/T12/T13; §10 (typed trace) → T9; §11 (pure tools, runner persists) → T11/T13; §14 (M1 loop) → T15. ✅
- **Codex v1 findings:** filter-before-rank ✓ (T8), async retrieve ✓ (T8), §10 trace ✓ (T9), suggested_rewrite + structured counterevidence + found-gating ✓ (T11), recall@k/overclaim/failures/confusion-render/mkdir/full-enum ✓ (T12/T13), LexicalIndex interface ✓ (T3/T6), embedding provenance ✓ (T3), real-provider artifact ✓ (T16). ✅
- **Offline testability:** every test uses `HashEmbedder` + `MockJudge`; real providers are T16-only, never in CI. ✅
- **Placeholders:** none. **Type consistency:** `Embedder`/`Chunk`/`RetrievalHit`/`LexicalIndex`/`Judge`/`JudgeOutput`/`TraceEvent`/`Locator`/`CitedSourceSupport`/`CounterItem`/`EvalReport` consistent across tasks.
- **Risk:** better-sqlite3 native build (T2 fail-fast + T6 BM25 fallback behind `LexicalIndex`).
