# M5c — Persistent Library · Import-Your-Own-PDF · GROBID Sidecar — Implementation Plan (v2)

## 0. v2 changelog (Codex plan review → all 6 adopted)
1. **`staleFor(model, dim)` checks BOTH** model and dim (same model + different dim still corrupts cosine) — Task 1.
2. **Vector validation on load:** `loadAll`/`buildIndexFromStored` assert each stored vector is a numeric array of length `embedding_dim` and **fail loudly** (no silent `cosine(q, [])` → distance 1) — Task 1/2.
3. **Persist + load COMPLETE `Source`** (authors/year/type/source_hash/path_or_url/citation_metadata/fulltext_status), not summaries — the `CitationResolver` needs authors/year/bibtex_key to resolve citations to imported sources. `loadAll()` returns full `Source[]` — Task 1.
4. **On import/remove, rebuild the WHOLE ToolContext** (`sources` + `texts` + `resolver` + retriever via `makeToolContext(libSources, libTexts, buildIndexFromStored(...), judge, embedder)`), NOT just `ctx.retriever` — else `auditDraft` can't resolve an imported citation — Task 4.
5. **`AppConfig` gains `library?: string`** (path) before Task 4 (config strips unknown keys) — Task 4.
6. **Mixed-vector prevention is a RUNTIME guard** (`staleFor` + dim validation), not lint — current `invariants.ts` does NOT cover embeddings; the "HARNESS-§5 lint enforces" claim was wrong (a dedicated lint rule is a future add).

> **Roles:** **Implementer = Codex** (TDD, local `node_modules/.bin/{vitest,tsc}`, no `npm install`, no `git`). **Reviewer + test-runner + deps + git + boot-smoke = Claude.** **Window/visual smoke = user.**
> REQUIRED SUB-SKILL (Codex): test-first, bite-sized, no placeholders.

**Goal:** Make it *your* tool: a **persistent on-disk library** you add your own papers to (they stick + accumulate), **import-your-own-PDF** (parse → embed → store → searchable), and an optional **GROBID** high-fidelity sidecar (sections + references). Builds on M5a/M5b (providers, local/cloud embedders). Offline-first; CI offline.

**Phasing (each independently shippable):**
- **M5c-A** Persistent library (better-sqlite3 file DB) + `buildIndexFromStored` — *the durability core*. TDD.
- **M5c-B** `PdfParser` provider + unpdf default + import-to-library flow + **Library tab**. TDD core + UI smoke.
- **M5c-C** GROBID sidecar (optional, detected): TEI → section-aware chunks + references. Contract-level (heavier; JVM).

**Depends on (locked, `main`):** `Source`/`Chunk` (`src/types.ts`, `src/retrieve/types.ts`, incl `page_start?/page_end?`), `HybridRetriever`/`buildIndex` (`src/retrieve/index.ts`), `openDb` (`src/retrieve/db.ts`), `Embedder` (role-aware), `ingestPdf` (`src/ingest/pdf.ts`), `buildContext`/worker runtime (M5a), M3/M4/M5 Electron app.

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — §4 (Source/Chunk persistence) / §5 (provenance) / §8 (ledger) / §12 (native: drag-drop import, local project folder).

**Deps Claude installs:** M5c-C → an XML parser (`fast-xml-parser`) for TEI. M5c-A/B → none.

**Invariant (provenance §5):** a library's chunks are pinned to one `embedding_model`/`embedding_dim`. Switching the active embedder makes the library **stale → re-embed**. Enforced **at runtime** by `staleFor(model, dim)` + vector-dim validation on load (Task 1/2) — NOT by lint (current `invariants.ts` doesn't cover embeddings; a dedicated rule is a future add).

---

## Phase M5c-A — Persistent library (headless, TDD)

### Task 1: Library schema + CRUD over a file DB

**Files:** Create `src/library/library.ts`; Test `tests/library.library.test.ts`

- [ ] **Step 1: Failing test** (temp file DB; round-trips a source + chunks + vectors)
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { openLibrary } from "../src/library/library.js";
import type { Chunk } from "../src/retrieve/types.js";
const chunk = (id: string, sid: string): Chunk => ({ id, source_id: sid, source_hash: "a".repeat(64), ordinal: 0, section: "body", char_start: 0, char_end: 5, text: "hello", chunker_version: "1.0", embedding_model: "hash-256", embedding_dim: 4 });
const src = (id: string) => ({ id, title: id, authors: ["A"], year: "2020", type: "pdf" as const, path_or_url: "", source_hash: "a".repeat(64), citation_metadata: { bibtex_key: id }, fulltext_status: "indexed" as const });
describe("Library", () => {
  it("persists sources+chunks+vectors and reloads them across reopen", () => {
    const file = join(mkdtempSync(join(tmpdir(), "lib-")), "library.db");
    const lib = openLibrary(file);
    lib.addSource(src("s1"), [{ chunk: chunk("s1#0", "s1"), vector: [1, 0, 0, 0] }]);
    expect(lib.listSources().map((s) => s.id)).toEqual(["s1"]);
    lib.close();
    const re = openLibrary(file); // reopen → persisted
    const loaded = re.loadAll();
    expect(loaded.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(loaded.sources[0]!.authors).toEqual(["A"]); // FULL Source loaded — resolver needs authors/year/bibkey
    expect(loaded.chunks).toHaveLength(1);
    expect(loaded.vectors.get("s1#0")).toEqual([1, 0, 0, 0]);
    re.removeSource("s1");
    expect(re.listSources()).toEqual([]);
    expect(re.loadAll().chunks).toEqual([]); // cascade
  });
  it("reports stale when the active embedder differs from stored chunks", () => {
    const file = join(mkdtempSync(join(tmpdir(), "lib-")), "library.db");
    const lib = openLibrary(file);
    lib.addSource(src("s1"), [{ chunk: chunk("s1#0", "s1"), vector: [1, 0, 0, 0] }]); // hash-256, dim 4
    expect(lib.staleFor("hash-256", 4)).toBe(false);
    expect(lib.staleFor("hash-256", 384)).toBe(true); // same model, different dim → stale
    expect(lib.staleFor("Xenova/all-MiniLM-L6-v2", 4)).toBe(true);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `openLibrary(path): Library` (reuse `openDb`; **`PRAGMA foreign_keys=ON` explicitly** — openDb only sets WAL; `CREATE TABLE IF NOT EXISTS sources(id PK, title, authors /*JSON*/, year, type, source_hash, path_or_url, citation_metadata /*JSON*/, fulltext_status, added_at)` = **the FULL Source**, + `chunks(id PK, source_id FK ON DELETE CASCADE, ordinal, section, char_start, char_end, page_start, page_end, text, embedding /*JSON number[]*/, embedding_model, embedding_dim, chunker_version)`). API: `addSource(source, {chunk,vector}[])`; `listSources(): {id,title,year,type}[]` (UI summaries); `loadAll(): { sources: Source[]; chunks: Chunk[]; vectors: Map<string, number[]> }` — reconstructs **full `Source`** records (parse authors/citation_metadata JSON) so the resolver works, and **validates each vector** (numeric array, `length === embedding_dim`) → throw on mismatch; `removeSource(id)`; `staleFor(model: string, dim: number): boolean` (any chunk `embedding_model ≠ model` **OR** `embedding_dim ≠ dim`); `close()`.
- [ ] **Step 4:** green + `tsc`.
- [ ] **Step 5: Commit** `feat(harness): persistent SQLite library — sources/chunks/vectors CRUD (M5c Task 1)`

### Task 2: `buildIndexFromStored` — retriever from persisted vectors

**Files:** Modify `src/retrieve/index.ts`; Test `tests/retrieve.from-stored.test.ts`

- [ ] **Step 1: Failing test** — `buildIndexFromStored(chunks, vectors, embedder)` returns a `HybridRetriever` whose `retrieve` works using the STORED vectors (assert a known query returns the seeded chunk), and **does NOT re-embed the docs** (spy `embedder.embed` is called only for the query — once).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `buildIndexFromStored(chunks: Chunk[], vectors: Map<string,number[]>, embedder: Embedder): HybridRetriever`: build `chunks` Map + `idsBySource` + `FtsLexicalIndex` (add chunk texts) + use the passed `vectors` Map → `new HybridRetriever(...)`. (= `buildIndex` minus doc-embedding; embedder retained for query-time only.) **Validate** every chunk has a vector of length `embedder.dim` → throw on missing/mismatch (no silent `cosine(q, [])` → distance 1). Mirror `buildIndex`'s lexical/`idsBySource` wiring exactly.
- [ ] **Step 4:** green + `tsc` + full suite.
- [ ] **Step 5: Commit** `feat(harness): buildIndexFromStored — retriever from persisted vectors (M5c Task 2)`

---

## Phase M5c-B — PdfParser provider + import-to-library + Library tab

### Task 3: `PdfParser` interface + `UnpdfParser` + import flow (headless, TDD)

**Files:** Create `src/library/parser.ts`, `src/library/import.ts`; Test `tests/library.import.test.ts`

- [ ] **Step 1: Failing test** (generate a PDF with pdf-lib, import into a temp library, retrieve a stored chunk)
```ts
// makePdf via pdf-lib (devDep, already installed in M4); UnpdfParser wraps ingestPdf; HashEmbedder for offline.
// importPdf(bytes, parser, embedder, lib) → parse → embed(chunks,"document") → lib.addSource → returns source.
// assert lib.listSources has the pdf source; buildIndexFromStored(lib.loadAll(), embedder).retrieve finds it; locator.page is a number.
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `PdfParser { parse(bytes: Uint8Array): Promise<{ source: Source; chunks: Chunk[] }> }`; `UnpdfParser` wraps `ingestPdf` (default). `importPdf(bytes, parser, embedder, library)`: `parse` → `embedder.embed(chunks.map(c=>c.text), "document")` → `library.addSource(source, chunks.map((c,i)=>({chunk:c, vector:embs[i]})))` → return source.
- [ ] **Step 4:** green + `tsc` + full suite.
- [ ] **Step 5: Commit** `feat(harness): PdfParser provider + importPdf to library (M5c Task 3)`

### Task 4: Worker library messages (headless, TDD)

**Files:** Modify `src/app/protocol.ts` (+ worker runtime wiring); Test extend `tests/app.protocol.test.ts`

- [ ] **Prereq:** add `library?: string` to `AppConfigSchema` (config strips unknown keys → the library path needs a real field; Electron main sets it to userData/library.db). Add to `handleWorkerMessage`: `{type:"list_library"}`→`{type:"library", sources}`; `{type:"import_pdf", bytesBase64}`→parse + embed("document") + `library.addSource`→`{type:"imported", source}`; `{type:"remove_source", id}`→`{type:"removed", id}`. The runtime holds an open `Library`; after import/remove it **rebuilds the WHOLE ctx** (not just retriever): `const { sources, chunks, vectors } = library.loadAll(); ctx = makeToolContext(sources, textsFromChunks(chunks), buildIndexFromStored(chunks, vectors, embedder), judge, embedder)` — so `ctx.sources`/`ctx.resolver`/retriever all reflect the import (else `auditDraft` can't resolve the new citation). `textsFromChunks` joins each source's chunk texts → `ctx.texts`. Test (generated PDF, HashEmbedder offline): import → list shows it → a draft citing it resolves + audits to a grounded verdict.
- [ ] **Commit** `feat(app): worker library messages (list/import/remove) + retriever rebuild (M5c Task 4)`

### Task 5: Library tab (Electron, write-then-smoke)

**Files:** `electron/{main.ts,preload.ts,renderer/api.d.ts}`, `electron/renderer/tabs/Library.tsx`

- [ ] Expose `harness.listLibrary/importPdf/removeSource`. **Library** tab: list sources (id/title/year/type) + **file-pick / drag-drop** PDF → `importPdf` (read file → base64 → worker) → refresh; remove button; show count + a "switching embedder ⇒ re-index" note when `staleFor` is true. `tsc -p electron/tsconfig.json` clean; build; Claude boot-smoke; user smoke (import a real PDF → it appears → audit a claim citing it).
- [ ] **Commit** `feat(app): Library tab — import/list/remove your own PDFs (M5c Task 5)`

---

## Phase M5c-C — GROBID high-fidelity sidecar (optional, detected; contract-level)

### Task 6: `GrobidParser` (TEI → section-aware chunks + references)
- `GrobidParser implements PdfParser`: POST the PDF to a local GROBID REST (`/api/processFulltextDocument`) → TEI XML; parse (via `fast-xml-parser`) into a `Source` (title/authors/year from `<teiHeader>`) + **section-aware Chunks** (`<div>`/`<head>` → `section` field: introduction/methods/results/limitations…) + extract **references** (`<listBibl>`) to seed `CitationResolver`/citation_metadata. Page/coords from TEI `coords` when present.
- **Detection:** `grobidAvailable(baseURL)` pings `GET {baseURL}/api/isalive`; if absent, the Library tab shows "GROBID not running — using built-in unpdf" + a one-time setup link (Docker `lfoppiano/grobid` or the JVM jar). **Never required**; unpdf is the default.
- **TDD (offline, no JVM):** map a **captured TEI fixture** (an XML string in the test, sectioned + with `<listBibl>`) → assert sections tagged + references extracted + `source.type:"pdf"` + page-aware chunks. Live GROBID call is env-gated (`M5C_LIVE_GROBID`), skipped in CI.
- **Provider wiring:** registry adds `pdf` provider `grobid` (location `local-download`); `config.pdf.provider:"grobid"` selects `GrobidParser` (with a configured baseURL); `importPdf` uses the configured parser.

---

## M5c Done — Acceptance
- [ ] **Automated (Claude):** `npm test` green incl. `library.*` + extended `app.protocol`; `tsc` (root+electron) clean; `lint` 0; build OK. CI offline (live GROBID + any live embed env-gated).
- [ ] **Persistence:** add a source → reopen the library → it's still there + searchable (vectors persisted, no re-embed on reload).
- [ ] **Import (user smoke):** `npm start` → Library tab → drag in a real PDF → it appears → Audit a draft citing it → grounded verdict with a page locator.
- [ ] **GROBID:** optional + detected; absent → unpdf fallback, never blocks; TEI→sections+references mapping unit-tested on a fixture.
- [ ] **铁律:** `src/**` Electron-free; library DB + core in the Node worker (off the Electron hot path); embedder switch ⇒ re-index prompt.

## Out of scope (→ later)
Cross-library sync; Zotero/DOI import; full §4 Draft/Claim/EvidenceLink persistence (only Source/Chunk persisted here); incremental re-embed UI (M5c re-embeds whole library on model switch); sqlite-vec ANN (still brute-force cosine — fine at personal-library scale, ANN is a later scale upgrade).

## Review notes (plan author → Codex)
- A+B are the high-ROI durability+import core (full TDD); C (GROBID) is the optional heavy sidecar (JVM) — contract-level, TEI mapping unit-tested on a fixture, never default.
- Reuse: `openDb`, `HybridRetriever`, `ingestPdf`, role-aware `Embedder.embed(...,"document")`, the M5a worker runtime + buildContext, M4 `pdf-lib` (test fixtures).
- Invariants: vectors persisted as JSON (brute-force cosine unchanged); embedder switch ⇒ library stale ⇒ re-embed; `src/` Electron-free; CI offline; library path comes from config/userData, passed into the worker (not hardcoded).
- Risk to verify at impl: `buildIndexFromStored` must mirror `buildIndex`'s lexical/idsBySource wiring exactly (only the doc-embed step removed); base64 PDF transfer over the worker stdio protocol; GROBID TEI schema variance (pin the fixture to GROBID's documented TEI).
