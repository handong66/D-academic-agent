# M4 — Co-evolution Artifacts · PDF Ingest · Lit-Matrix Tabs — Implementation Plan (v2)

> **Roles:** **Implementer = Codex** (TDD, local `node_modules/.bin/vitest`/`tsc`, no `npm install`, no `git`). **Reviewer + test-runner + git + deps + boot-smoke = Claude.** **Window smoke = user** (`npm start`).
> REQUIRED SUB-SKILL (Codex): test-first, bite-sized, no placeholders. Steps use `- [ ]`.

**Scope (user, 2026-06-23):** ✅ Co-evolution artifacts ✅ PDF ingest (unpdf) ✅ Lit-matrix UI + secondary tabs. ❌ Packaging (.app) → later.

## 0. v2 changelog (Codex plan review → all 4 adopted)
1. **Task 2 ablation** asserts a real delta: `recall@3 ≥ recall@1` (monotonic in k), not just "numbers exist".
2. **PDF chunk ownership (Task 4/5):** `ingestPdf` produces page-aware `Chunk`s; `Chunk` gains `page_start?/page_end?`, `Locator` gains `page?`; **`buildIndex` accepts an optional prebuilt `chunksBySource`** (additive, back-compat) so PDF page-chunks survive indexing instead of being re-chunked from raw text.
3. **PDF source type (Task 5):** `Source.type` gains `"pdf"`; a new `assembleWithPdfs` ingests `.pdf` (no `.txt` sidecar required) in a **separate fixture dir** — the frozen toy corpus + `sources.lock` stay untouched.
4. **Worker IPC (Task 6):** a **generic** message union (`audit` stays back-compat) + main/worker route by `type` (not hardcoded to `"audit"`); `build_matrix` response is `{ dir }` (matrix at `dir/matrix.md`).

**Goal (spec §14 M4 + §17):** Close the **Model+Harness co-evolution** loop (`failure_cases.jsonl` + prompt/version **ablation** over the frozen gold), ingest **real PDFs** into the Source/Chunk model (unpdf, page/section locators), and give the Electron app its **secondary tabs** (Sources / Evidence & Matrix / Eval & Trace) incl. a literature-matrix view. Offline-deterministic in CI via mocks; real providers pluggable.

**Architecture:** Pure-TS core extensions stay headless + Electron-free (铁律 §3). Co-evolution + PDF are core (TDD). The tabs are Electron-shell (write-then-smoke); the seed **Eval & Trace** tab is the ONLY place gold metrics appear (the hero never shows them, §12). Core stays in the Node child process.

**Depends on (locked, on `main`):** M0 ingest/resolver; M1 `runEval`(failures carry `cited_source`)/`metrics`/`gold`/`check`; M2 `tools`(`makeToolContext`,`build_matrix`,`TOOL_REGISTRY`)/`mcp`/`dx`(`drill`,`replay`); M3 `draft/audit`, `app/{protocol,worker}`, `electron/*`.

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — §4/§5(provenance)/§9/§12/§14/§17.

**Deps Claude installs before each phase:** M4b → `unpdf` (dep) + `pdf-lib` (devDep, test fixtures). M4a/M4c → none new.

---

## Phase M4a — Co-evolution artifacts (headless, TDD)

### Task 1: `failure_cases.jsonl` writer

**Files:** Create `src/coevo/failure_cases.ts`; Test `tests/coevo.failure_cases.test.ts`

> The harness↔model feedback artifact: every checker↔gold disagreement, with the evidence + gold rationale, for prompt/model iteration.

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { loadGoldClaims } from "../src/eval/gold.js";
import { writeFailureCases } from "../src/coevo/failure_cases.js";
describe("writeFailureCases", () => {
  it("writes one JSONL record per failure, joined to gold snippet/rationale by (claim,cited_source)", () => {
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    const g = gold[0]!;
    const failures = [{ claim: g.claim_text, gold: g.label, pred: "supports", cited_source: g.cited_source }];
    const out = mkdtempSync(join(tmpdir(), "fc-"));
    const path = writeFailureCases(failures, gold, { outDir: out, judge_model: "mock", prompt_version: "check-1.0", run_id: "r1" });
    const recs = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(recs.length).toBe(1);
    expect(recs[0]).toMatchObject({ claim: g.claim_text, cited_source: g.cited_source, gold_label: g.label, pred_label: "supports", snippet: g.snippet, rationale: g.rationale, judge_model: "mock", run_id: "r1" });
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `writeFailureCases(failures, gold, meta): string`. Build a `(claim,cited_source)→gold` map (JSON.stringify tuple key, reuse the drill pattern). For each failure emit `{ claim, cited_source, gold_label, pred_label, snippet, rationale, judge_model, prompt_version, run_id }`. `mkdirSync(outDir,{recursive})`; write `failure_cases.jsonl`; return the path.
- [ ] **Step 4:** green + `tsc`.
- [ ] **Step 5: Commit** `feat(harness): failure_cases.jsonl co-evolution artifact writer (M4 Task 1)`

### Task 2: Prompt/version ablation runner

**Files:** Create `src/coevo/ablation.ts`; Test `tests/coevo.ablation.test.ts`

> Same frozen gold, swept across config variants (k / embedder / judge / prompt_version) → per-variant metrics + comparison. The measurable co-evolution loop.

- [ ] **Step 1: Failing test** (two deterministic variants → both produce metrics)
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { runAblation } from "../src/coevo/ablation.js";
describe("runAblation", () => {
  it("runs the seed eval per variant and returns comparable metrics", async () => {
    const base = { corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: mkdtempSync(join(tmpdir(), "abl-")) };
    const r = await runAblation([
      { label: "k=1", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 1 },
      { label: "k=3", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 3 },
    ], base);
    expect(r.variants.map((v) => v.label)).toEqual(["k=1", "k=3"]);
    expect(typeof r.variants[0]!.macro_f1).toBe("number");
    expect(typeof r.variants[0]!.retrieval_recall_at_k).toBe("number");
    expect(r.variants.length).toBe(2);
    expect(r.variants[1]!.retrieval_recall_at_k).toBeGreaterThanOrEqual(r.variants[0]!.retrieval_recall_at_k); // recall@3 ≥ recall@1: a real ablation delta (monotonic in k), not just "numbers exist"
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `runAblation(variants: {label; embedder; judge; k?}[], base: {corpusDir; goldPath; outDir}) → { variants: {label; macro_f1; overclaim_recall; retrieval_recall_at_k}[] }`. Per variant call `runEval({...base, outDir: join(base.outDir, label), k}, embedder, judge)`; collect the headline metrics. Write an `ablation.md` comparison table under `base.outDir`. (Reporting-only; no pass/fail.)
- [ ] **Step 4:** green + `tsc`.
- [ ] **Step 5: Commit** `feat(harness): prompt/version ablation runner over frozen gold (M4 Task 2)`

### Task 3: CLI `coevo` subcommand

**Files:** Modify `src/cli.ts`; Test extend `tests/cli.m2.test.ts` (or new `tests/cli.coevo.test.ts`)

- [ ] **Step 1: Failing test** — `runCli(["coevo","--mock","--out",out])` runs eval, writes `failure_cases.jsonl` + an `ablation.md` (k=1 vs k=3), asserts both files exist.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** a `coevo` branch: build mock ctx (`buildMockContext`), run `runEval` once → `writeFailureCases`; run `runAblation` (k=1,k=3); print a summary. Reuse `buildMockContext` + `loadGoldClaims`.
- [ ] **Step 4:** green + full `npm test` + `tsc` + `lint`.
- [ ] **Step 5: Commit** `feat(harness): CLI coevo (failure_cases + ablation) (M4 Task 3)`

---

## Phase M4b — PDF ingest (headless, TDD; Claude installs unpdf + pdf-lib first)

### Task 4: `ingestPdf` via unpdf → Source + page-aware Chunks

**Files:** Create `src/ingest/pdf.ts`; Test `tests/ingest.pdf.test.ts`

> Test fixtures are generated in-memory with `pdf-lib` (no committed binary). `unpdf` extracts text + page count.

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ingestPdf } from "../src/ingest/pdf.js";
async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) { const p = doc.addPage([300, 400]); p.drawText(text, { x: 20, y: 360, size: 12, font }); }
  return doc.save();
}
describe("ingestPdf", () => {
  it("extracts text into a Source + page-tagged Chunks with stable hashing", async () => {
    const bytes = await makePdf(["Adolescent social media use and depression.", "Methods and sample limitations."]);
    const r = await ingestPdf(bytes, { id: "toy_pdf", embedding_model: "hash-256", embedding_dim: 256 });
    expect(r.source.id).toBe("toy_pdf");
    expect(r.source.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks.some((c) => /depression/i.test(c.text))).toBe(true);
    expect(r.chunks.every((c) => typeof c.page_start === "number")).toBe(true);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**
  - **Additive type changes first:** add `page_start?: number; page_end?: number` to `Chunk` (`src/retrieve/types.ts`); add `page?: number` to `Locator` (`src/check/check.ts`) and carry it through `loc()` when the chunk has it; add `"pdf"` to `Source.type` (`src/types.ts`). All optional → existing text chunks/sources unaffected.
  - `ingestPdf(bytes: Uint8Array, meta: { id; embedding_model; embedding_dim }): Promise<{ source: Source; chunks: Chunk[] }>`. `unpdf`'s `extractText(bytes, { mergePages: false })` returns `{ totalPages, text: string[] }`. Join pages with `"\n"` into one string + build a page→char-range map; `canonicalize` + `sourceHash` (reuse `src/ingest/hash.ts`) over the joined text. Chunk via `chunkSource`, then tag each chunk's `page_start/page_end` from the map by its `char_start/char_end`; `section:"body"`; full provenance (`embedding_model/embedding_dim/chunker_version`). Return `{ source:{id,type:"pdf",...}, chunks }`.
- [ ] **Step 4:** green + `tsc`; run full suite (no regression to existing ingest).
- [ ] **Step 5: Commit** `feat(harness): PDF ingest via unpdf — page-aware chunks (M4 Task 4)`

### Task 5: Wire PDF into corpus assembly (optional source kind)

**Files:** Modify `src/corpus/assemble.ts` (additive); Test `tests/corpus.pdf.test.ts`

- [ ] **Step 1: Failing test** — end-to-end: a generated PDF → `assembleWithPdfs` → `buildIndex(..., chunksBySource)` → `retrieve` → `checkClaim` → assert `cited_source_support.locator.page` is a number (page survives ingest→index→locator), and the source has `type:"pdf"`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**
  - `buildIndex(sources, texts, embedder, chunksBySource?: Map<string, Chunk[]>)` — additive optional param; for a source present in the map, index its **prebuilt page-aware chunks** instead of re-chunking `texts`. Existing callers (no 4th arg) unaffected.
  - `assembleWithPdfs(dir)`: like `assembleSources` but `.pdf` files are `ingestPdf`-ed (no `.txt` sidecar required) and returned with their prebuilt chunks (in a `chunksBySource` map); the `.txt`/BibTeX path is unchanged. Use a SEPARATE fixture dir `fixtures/pdf_corpus/` — the frozen toy corpus + `sources.lock` stay untouched.
- [ ] **Step 4:** green + `tsc` + full suite.
- [ ] **Step 5: Commit** `feat(harness): assemble PDF sources alongside text (M4 Task 5)`

---

## Phase M4c — Electron secondary tabs (write-then-smoke; user runs `npm start`)

> Not unit-tested (Electron + display). Acceptance = `tsc -p electron/tsconfig.json` clean + `node electron/build.mjs` bundles + Claude boot-smoke + user `npm start`. New IPC handlers' pure logic is added to the worker protocol and IS unit-tested.

### Task 6: Worker protocol — list_sources / run_eval / build_matrix messages

**Files:** Modify `src/app/protocol.ts`; Test extend `tests/app.protocol.test.ts`

- [ ] **Step 1: Failing test** — `handleWorkerMessage(msg, ctx)` (generalizes `handleAuditMessage`, which stays exported + back-compat): `{type:"audit",draftText}` → `audit_result` (**UNCHANGED — assert it still works**); `{type:"list_sources"}` → `{type:"sources",sources:[{id,title,year,type}]}`; `{type:"run_eval"}` → `{type:"eval_result",result:{macro_f1,per_class,failures}}`; `{type:"build_matrix",outDir}` → `{type:"matrix",dir}` (project-local guarded; matrix at `dir/matrix.md`); unknown type → `error`. Each response echoes the request `id`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** extend the message union + `handleWorkerMessage` (reuse `runEval`/`buildLiteratureMatrix`/`ctx.sources`; `build_matrix` returns `{dir}`, not a file path). `handleAuditMessage` stays as a thin back-compat wrapper. Pure; tested.
- [ ] **Step 4:** green + `tsc` + full suite; **update `worker.ts` to call `handleWorkerMessage`, and `electron/main.ts` to add generic IPC channels (`list_sources`/`run_eval`/`build_matrix`) routed by `type` alongside `audit`** (don't hardcode only `"audit"`).
- [ ] **Step 5: Commit** `feat(app): worker protocol — list_sources/run_eval/build_matrix (M4 Task 6)`

### Task 7: Preload + tab shell

**Files:** Modify `electron/preload.ts`, `electron/renderer/api.d.ts`, add `electron/renderer/App.tsx` tab nav

- [ ] Expose `harness.listSources/runEval/buildMatrix`. App gets a tab bar: **Audit** (hero, existing) · **Sources** · **Evidence & Matrix** · **Eval & Trace**. `tsc` clean.
- [ ] **Commit** `feat(app): preload + tab navigation shell (M4 Task 7)`

### Task 8: Sources + Evidence & Matrix + Eval & Trace tabs

**Files:** Create `electron/renderer/tabs/{Sources,Matrix,EvalTrace}.tsx`

- [ ] **Sources**: list corpus sources (id/title/year/type). **Evidence & Matrix**: button → `buildMatrix` → render the literature matrix (source/claim/verdict/quote/locator). **Eval & Trace**: button → `runEval` → show **gold** metrics (macro-F1, per-class P/R, confusion, failures) — the ONLY screen with gold metrics (§12); plus a trace-summary view (reuse §10 replay summary shape). Loading/error states.
- [ ] **Acceptance:** `tsc -p electron/tsconfig.json` clean; `node electron/build.mjs` bundles; Claude boot-smoke; user `npm start`.
- [ ] **Commit** `feat(app): Sources / Evidence & Matrix / Eval & Trace tabs (M4 Task 8)`

### Task 9: Smoke doc + README

**Files:** `electron/SMOKE.md`, `README.md`

- [ ] Add tab smoke steps (Sources lists 6 toy sources; Eval & Trace shows the seed confusion matrix; Matrix renders rows). Note packaging is still out of scope.
- [ ] **Commit** `docs(app): M4 tabs smoke + README (M4 Task 9)`

---

## M4 Done — Acceptance
- [ ] **Automated (Claude runs):** `npm test` green (incl. `coevo.*`, `ingest.pdf`, extended `app.protocol`); `tsc` (root + electron) clean; `lint` 0; `node electron/build.mjs` bundles.
- [ ] **Co-evolution:** `npm run harness -- coevo --mock` writes `failure_cases.jsonl` + `ablation.md` (k-sweep) over the frozen gold.
- [ ] **PDF:** `ingestPdf` parses a generated PDF → Source + page-tagged Chunks (snippet-only check still works on PDF-sourced chunks).
- [ ] **Tabs (user smoke):** `npm start` → Sources / Evidence & Matrix / Eval & Trace render; **gold metrics only on Eval & Trace**, never the hero.
- [ ] **铁律:** `src/**` Electron-free; core only in the child process.

## Out of scope (→ later)
Packaging (electron-rebuild/asar/signed `.app`); real-provider worker ctx; full §4 persistence + §6 atomicity; drag-drop import; outbound-snippet native view.

## Review notes (plan author → Codex)
- TDD fully on Tasks 1–6 (run `node_modules/.bin/vitest`/`tsc`). Tasks 7–9 are tsc + boot/user smoke.
- Reuse: `runEval`/`loadGoldClaims`/`drill` tuple-key/`buildLiteratureMatrix`/`buildMockContext`/`chunkSource`/`sourceHash`. Don't reinvent.
- Invariants: ablation/failure_cases reporting-only (no thresholds); PDF chunks carry provenance + page; hero shows no gold metrics; keep `audit` message back-compat; `src/**` Electron-free.
- Risk: `unpdf`/`pdf-lib` API (Claude verifies versions before M4b); protocol rename must not break M3 hero.
