# M3 — Electron Mac App: Draft Citation Audit Hero (dev-runnable) — Implementation Plan (v2)

> **Roles (this milestone):** **Implementer = Codex** (TDD, per-task commits). **Reviewer + test-runner = Claude** (runs the vitest suite + `tsc` + lint; Codex's sandbox may EPERM on network, so Codex writes test+impl+`tsc` and Claude confirms `npm test` green). **Window smoke = user** (`npm start` on macOS — neither Codex nor Claude can render an Electron window here).
> REQUIRED SUB-SKILL (Codex): test-first, bite-sized, no placeholders. Steps use checkbox (`- [ ]`).

**Goal (spec §12 + §15 #5):** A dev-runnable Electron Mac app whose **Draft Citation Audit** hero screen takes a pasted draft + inline citations and shows **real-time per-sentence diagnosis** — verdict, evidence quote/locator, suggested rewrite, confidence — via the existing headless core. **No gold/eval metrics on the hero path** (§12). `npm start` runs it; packaging and secondary tabs are **M4**.

**Scope (user, 2026-06-22):** dev-runnable Hero app; Hero screen only.

## 0. v2 changelog (Codex plan review → disposition; all 5 adopted)
1. **Task 5** deterministic child-process test: local `tsx` (`node_modules/.bin/tsx`, not `npx`), handle `stderr`/`error`/`exit`/timeout, line-buffered stdout, `stdin.end()`; worker uses `(await buildMockContext()).ctx`.
2. **Task 6** IPC fully specified: buffered JSON-lines parser, `crypto.randomUUID()` ids, pending `Map`, reject all pending on child `exit`/`error`, malformed-line handling.
3. **Task 8** real-time per §15 #5: **debounced audit-on-input** (not a manual button).
4. **Task 9** exact run wiring: esbuild compiles main/preload/renderer → `electron/dist/*.cjs` + `renderer/dist/bundle.js`; `npm start` = `node electron/build.mjs && electron electron/dist/main.cjs` (`.ts` cannot be Electron's entry; `"type":"module"` → CJS bundle).
5. **Tasks 1–3** offset tests assert exact `slice === text/raw_citation`; hero uses **reduced non-persistent DTOs** (see scope note).

**§4/§6 scope note (deliberate, not omission):** the hero path uses **reduced, non-persistent DTOs** (`DraftSentence`-lite + per-mention audit). It does **not** persist the full §4 model (`Draft.id/assignment_id/created_at`, `resolution_status`, `ClaimCitationPair` rows) and treats **claim = whole sentence** (no §6 `ClaimSpan`/atomicity/manual-correction). Full persistence + atomic claim extraction → **M4**.

**Architecture (铁律 §3/§5):**
```
 Electron main (BrowserWindow + spawn child) ⇄ stdio JSON-lines ⇄ Node CHILD (src/app/worker.ts: core ctx + better-sqlite3, runs auditDraft)
 Renderer (React hero) ⇄ contextBridge(preload) ⇄ ipcMain ⇄ child
```
- `src/**` stays **Electron-free**; `electron/**` is the only Electron code. Core (incl. `better-sqlite3`) runs **only** in the plain Node child → **no electron-rebuild** this milestone (Codex confirmed: ABI-safe iff better-sqlite3 is never loaded in Electron main/preload/renderer).
- **TDD (Tasks 1–5):** engine + protocol + worker round-trip. **Write-then-smoke (Tasks 6–10):** Electron shell.

**Depends on (locked):** `src/tools/tools.ts` (`makeToolContext`,`ToolContext`), `src/cli-ctx.ts` (`buildMockContext` → `{ctx,embedder,judge}`), `src/check/check.ts` (`checkClaim`), `src/citation/resolver.ts`, `src/retrieve/*`, `src/trace/trace.ts`.

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — §3/§4/§6①/§12/§15.

---

## File Structure
```
academic-agent/
  src/draft/{sentences.ts, mentions.ts, audit.ts}       # core engine (TDD)
  src/app/{protocol.ts, worker.ts}                       # core-process adapter (TDD)
  electron/{main.ts, preload.ts, build.mjs, tsconfig.json}
  electron/renderer/{index.html, main.tsx, App.tsx, api.d.ts}
  tests/{draft.sentences,draft.mentions,draft.audit,app.protocol,app.worker}.test.ts
```

---

## Phase M3a — Draft Audit Core (headless, pure TS, TDD)

### Task 1: Sentence splitting

**Files:** Create `src/draft/sentences.ts`; Test `tests/draft.sentences.test.ts`

- [ ] **Step 1: Failing test** (exact-offset invariant)
```ts
import { describe, it, expect } from "vitest";
import { splitSentences } from "../src/draft/sentences.js";
describe("splitSentences", () => {
  it("splits sentences with offsets that exactly index the original text", () => {
    const text = "Social media is linked to depression (Twenge, 2018). It may cause anxiety (Orben, 2019).";
    const s = splitSentences(text);
    expect(s.length).toBe(2);
    expect(s.map((x) => text.slice(x.char_start, x.char_end))).toEqual(s.map((x) => x.text)); // exact reconstruction
    expect(s[0]!.text).toContain("Twenge");
    expect(s[1]!.index).toBe(1);
    expect(s[0]!.char_end).toBeLessThanOrEqual(s[1]!.char_start);
  });
});
```
- [ ] **Step 2:** `npm test -- draft.sentences` → FAIL.
- [ ] **Step 3: Implement** `DraftSentence { index, char_start, char_end, text }`. Split on `.?!` + whitespace before a capital, keeping the trailing citation paren with its sentence. `char_start/char_end` index the ORIGINAL string; `text === original.slice(char_start,char_end)`. Deterministic, dependency-free.
- [ ] **Step 4:** green + `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(harness): draft sentence splitter (M3 Task 1)`

### Task 2: Citation-mention extraction

**Files:** Create `src/draft/mentions.ts`; Test `tests/draft.mentions.test.ts`

- [ ] **Step 1: Failing test** (exact span both at offset 0 and offset N)
```ts
import { describe, it, expect } from "vitest";
import { extractMentions } from "../src/draft/mentions.js";
describe("extractMentions", () => {
  it("reconstructs raw_citation exactly via slice at offset 0", () => {
    const text = "X is linked to Y (Twenge, 2018) per \\cite{orben2019}.";
    const m = extractMentions(text, 0);
    expect(m.map((x) => text.slice(x.char_start, x.char_end))).toEqual(m.map((x) => x.raw_citation));
    expect(m.map((x) => x.raw_citation)).toEqual(["(Twenge, 2018)", "\\cite{orben2019}"]);
  });
  it("shifts spans by the given offset", () => {
    const text = "Linked (Twenge, 2018).";
    const m = extractMentions(text, 100);
    expect(m[0]!.char_start).toBe(100 + text.indexOf("(Twenge"));
    expect(m[0]!.char_end).toBe(m[0]!.char_start + "(Twenge, 2018)".length);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `CitationMention { raw_citation, char_start, char_end }`. Regexes: `\([A-Z][^)]*\b(?:19|20)\d{2}[a-z]?\)` and `\\cite\{[^}]+\}`. `char_start = offset + match.index`; `char_end = char_start + raw.length`. Source order; drop overlaps.
- [ ] **Step 4:** green + typecheck.
- [ ] **Step 5: Commit** `feat(harness): citation-mention extractor with char spans (M3 Task 2)`

### Task 3: auditDraft engine (the hero engine)

**Files:** Create `src/draft/audit.ts`; Test `tests/draft.audit.test.ts`

> Reduced non-persistent DTOs (see §0 scope note): `claim = sentence.text`; no DB writes; no gold/eval metrics.

- [ ] **Step 1: Failing test** (toy draft cites M0 fixtures; uses M2 `makeToolContext`)
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { makeToolContext } from "../src/tools/tools.js";
import { auditDraft } from "../src/draft/audit.js";
async function ctx() {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  return makeToolContext(sources, texts, await buildIndex(sources, texts, new HashEmbedder(256)), new MockJudge());
}
describe("auditDraft", () => {
  it("returns per-sentence diagnosis with resolved citations + verdicts (+ traces), no gold metrics", async () => {
    const draft = "Social media use is associated with adolescent depression (Twenge, 2018). Sleep is unrelated here (Orben, 2019).";
    const r = await auditDraft(draft, await ctx());
    expect(r.sentences.length).toBe(2);
    const m0 = r.sentences[0]!.mentions[0]!;
    expect(m0.status).toBe("resolved");
    expect(m0.source_id).toBe("twenge2018");
    expect(typeof m0.support?.verdict).toBe("string");
    expect(r.traces.length).toBeGreaterThan(0);
    expect(r).not.toHaveProperty("macro_f1");
  });
  it("marks an unresolvable citation without crashing", async () => {
    const r = await auditDraft("This cites nobody real (Nonexistent, 1999).", await ctx());
    expect(r.sentences[0]!.mentions[0]!.status).not.toBe("resolved");
    expect(r.sentences[0]!.mentions[0]!.support).toBeUndefined();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `auditDraft(draftText, ctx: ToolContext): Promise<DraftAudit>`: `splitSentences` → per sentence `extractMentions(s.text, s.char_start)` → per mention `ctx.resolver.resolve(raw)`; if `resolved` + `source_id`, `checkClaim({ claim: s.text, cited_source: source_id }, ctx.retriever, ctx.judge)` → `support = {verdict,quote,locator,suggested_rewrite,confidence}` (from `cited_source_support`), `counterevidence_found = corpus_counterevidence.found`, append `traces`. Return `{ sentences: SentenceAudit[], traces }`. No gold/eval.
- [ ] **Step 4:** green + typecheck.
- [ ] **Step 5: Commit** `feat(harness): auditDraft hero engine — per-sentence snippet-only diagnosis (M3 Task 3)`

---

## Phase M3b — Core-process adapter (TDD)

### Task 4: Worker message protocol (pure handler)

**Files:** Create `src/app/protocol.ts`; Test `tests/app.protocol.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { buildMockContext } from "../src/cli-ctx.js";
import { handleAuditMessage } from "../src/app/protocol.js";
describe("handleAuditMessage", () => {
  it("answers an audit request with the matching id and a DraftAudit result", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: "req-1", type: "audit", draftText: "Linked to depression (Twenge, 2018)." }, ctx);
    expect(res.id).toBe("req-1");
    expect(res.type).toBe("audit_result");
    expect(res.type === "audit_result" && res.result.sentences.length).toBe(1);
  });
  it("returns an error response (not a throw) on a bad request", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: "x", type: "audit", draftText: null as unknown as string }, ctx);
    expect(res.type).toBe("error");
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `AuditRequest {id;type:"audit";draftText}`; `AuditResponse = {id;type:"audit_result";result:DraftAudit} | {id;type:"error";message}`. `handleAuditMessage(msg, ctx)` runs `auditDraft` in try/catch → error response on throw. Pure (no Electron, no I/O).
- [ ] **Step 4:** green + typecheck.
- [ ] **Step 5: Commit** `feat(harness): typed worker audit protocol + pure handler (M3 Task 4)`

### Task 5: Worker child-process entry (stdio JSON-lines) — integration-tested

**Files:** Create `src/app/worker.ts`; Test `tests/app.worker.test.ts`

- [ ] **Step 1: Failing test** (deterministic: local `tsx`, robust line buffering, error/exit/timeout handling)
```ts
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");
function audit(req: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, ["src/app/worker.ts"], { cwd: process.cwd() });
    let buf = "", err = ""; const t = setTimeout(() => { child.kill(); reject(new Error("worker timeout\n" + err)); }, 30000);
    child.stdout.on("data", (b) => {
      buf += b.toString(); const nl = buf.indexOf("\n");
      if (nl >= 0) { clearTimeout(t); child.kill(); try { resolve(JSON.parse(buf.slice(0, nl))); } catch (e) { reject(e); } }
    });
    child.stderr.on("data", (b) => { err += b.toString(); });
    child.on("error", (e) => { clearTimeout(t); reject(e); });
    child.on("exit", (code) => { if (code && code !== 0 && !buf.includes("\n")) { clearTimeout(t); reject(new Error(`worker exit ${code}\n${err}`)); } });
    child.stdin.write(JSON.stringify(req) + "\n"); child.stdin.end();
  });
}
describe("audit worker (child process)", () => {
  it("answers a stdin request with one stdout JSON line", async () => {
    const res = await audit({ id: "1", type: "audit", draftText: "Linked to depression (Twenge, 2018)." });
    expect(res.id).toBe("1");
    expect(res.type).toBe("audit_result");
    expect(res.result.sentences.length).toBe(1);
  }, 40000);
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `worker.ts`: `const { ctx } = await buildMockContext();` ONCE; `readline.createInterface({ input: process.stdin })`; per line `JSON.parse` → `handleAuditMessage(msg, ctx)` → `process.stdout.write(JSON.stringify(res)+"\n")`. Malformed line → write an `error` response (with a generated id). No top-level throws.
- [ ] **Step 4:** `npm test -- app.worker` green (Claude runs it; really spawns a child) + typecheck.
- [ ] **Step 5: Commit** `feat(harness): audit worker child-process (stdio JSON-lines) (M3 Task 5)`

---

## Phase M3c — Electron shell (write-then-smoke; user runs `npm start`)

> Tasks 6–10 are not unit-tested (need Electron runtime + display). Acceptance = `tsc` clean for `electron/` + the **user's `npm start` smoke**. Keep `src/**` Electron-free.

### Task 6: Electron main process + robust IPC↔child round-trip

**Files:** Create `electron/main.ts`, `electron/tsconfig.json`

- [ ] `BrowserWindow` (`contextIsolation:true`, `nodeIntegration:false`, preload = `electron/dist/preload.cjs`, loads `electron/renderer/index.html`).
- [ ] Spawn the child ONCE: `spawn(join(__dirname,"..","..","node_modules",".bin","tsx"), ["src/app/worker.ts"], { cwd: <projectRoot> })` (dev).
- [ ] **Buffered JSON-lines reader on child stdout**: accumulate into a string, split on `\n`, parse each complete line, dispatch by `id`.
- [ ] **Pending map** `Map<string,{resolve,reject}>`; `ipcMain.handle("audit", (_e, draftText) => { const id = crypto.randomUUID(); write {id,type:"audit",draftText}; return new Promise(...) stored under id; })`. On a parsed response, `resolve` the matching pending and delete it; ignore unknown ids; malformed line → log, skip.
- [ ] **On child `exit`/`error`: reject ALL pending** and clear the map (so the renderer gets an error, not a hang). Kill the child on window close.
- [ ] `electron/tsconfig.json` includes only `electron/**`.
- [ ] **Acceptance:** `npx tsc -p electron/tsconfig.json --noEmit` clean.
- [ ] **Commit** `feat(app): Electron main + worker spawn + buffered IPC round-trip (M3 Task 6)`

### Task 7: Preload bridge

**Files:** Create `electron/preload.ts`, `electron/renderer/api.d.ts`

- [ ] `contextBridge.exposeInMainWorld("harness", { auditDraft: (text:string) => ipcRenderer.invoke("audit", text) })`. Declare `window.harness` in `api.d.ts`.
- [ ] **Acceptance:** tsc clean.
- [ ] **Commit** `feat(app): preload contextBridge harness.auditDraft (M3 Task 7)`

### Task 8: React hero screen — real-time Draft Citation Audit

**Files:** Create `electron/renderer/{index.html, main.tsx, App.tsx}`

- [ ] Hero UI: `<textarea>` for the draft + **debounced audit-on-input** (≈600ms idle → `await window.harness.auditDraft(text)`; §15 #5 real-time). Render each sentence with a verdict chip (color by verdict), evidence `quote` + `locator`, `suggested_rewrite`, a `confidence` bar; unresolved/ambiguous mentions → muted "unresolved citation" badge. Cancel/ignore stale in-flight audits (keep only the latest). Loading + error states. **No eval/gold metrics anywhere on this screen** (§12).
- [ ] **Acceptance:** tsc clean (renderer tsconfig); renders under `npm start` (user smoke).
- [ ] **Commit** `feat(app): real-time Draft Citation Audit hero (React, debounced) (M3 Task 8)`

### Task 9: Dev build + run wiring (exact)

**Files:** Create `electron/build.mjs`; edit root `package.json`

- [ ] Add devDeps: `electron`, `react`, `react-dom`, `esbuild`, `@types/react`, `@types/react-dom`. Pin `electron` to a current major.
- [ ] `electron/build.mjs` (esbuild) produces THREE bundles:
  - `electron/main.ts` → `electron/dist/main.cjs` (`platform:"node"`, `format:"cjs"`, `external:["electron"]`).
  - `electron/preload.ts` → `electron/dist/preload.cjs` (same).
  - `electron/renderer/main.tsx` → `electron/renderer/dist/bundle.js` (`platform:"browser"`, `format:"iife"`, bundle React). `index.html` references `dist/bundle.js`.
- [ ] `package.json` scripts: `"start": "node electron/build.mjs && electron electron/dist/main.cjs"`. (Electron's entry is compiled JS, never `.ts`; under `"type":"module"` the main/preload bundles are `.cjs`.)
- [ ] **Acceptance:** root `npm run typecheck` (src only) still clean; `node electron/build.mjs` produces the 3 bundles; `npm start` launches the window (user smoke).
- [ ] **Commit** `feat(app): dev build (esbuild → cjs/iife) + npm start (M3 Task 9)`

### Task 10: Smoke procedure + README

**Files:** Create `electron/SMOKE.md`; edit `README.md`

- [ ] `SMOKE.md`: `npm i && npm start`; paste `"Social media use is associated with adolescent depression (Twenge, 2018). Sleep is unrelated here (Orben, 2019)."`; expect 2 sentences, Twenge resolved with a verdict + quote/locator, no metrics. Note packaging/tabs = M4.
- [ ] README: add the M3 section + app location + smoke steps.
- [ ] **Commit** `docs(app): M3 smoke procedure + README (M3 Task 10)`

---

## M3 Done — Acceptance
- [ ] **Automated (Claude runs):** `npm test` green incl. `draft.sentences/draft.mentions/draft.audit/app.protocol/app.worker`; `npm run typecheck` clean; `npm run lint` 0; `npx tsc -p electron/tsconfig.json --noEmit` clean.
- [ ] **§15 #5 (user smoke):** `npm start` → paste draft → **real-time** per-sentence diagnosis (verdict + quote/locator + suggested rewrite + confidence); unresolved citations flagged; **no gold/eval metrics** on the hero.
- [ ] **铁律:** `src/**` imports no `electron`; `better-sqlite3`/core load only in the Node child.

## Out of scope (→ M4)
electron-rebuild / asar / signed `.app`; secondary tabs; PDF ingest; literature-matrix UI; real-provider worker ctx; full §4 persistence + §6 ClaimSpan/atomicity; native drag-drop + outbound-snippet view.

## Review notes (plan author → Codex implementer)
- TDD fully on Tasks 1–5 (`npm test`/`tsc` each). Tasks 6–10 are tsc-checked + user-smoked.
- Reuse: `makeToolContext`, `checkClaim`, `CitationResolver`, `buildMockContext().ctx`, `TraceEvent`. Keep `auditDraft` snippet-only, no gold.
- Invariants: offsets index the original draft (locators depend on it); `src/**` Electron-free; child = plain Node (no electron-rebuild); Electron entry = compiled `.cjs`.
