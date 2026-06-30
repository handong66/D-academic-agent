# M5 — Provider-ization & Self-Use (local/cloud models, secure keys, persistent library) — Implementation Plan (v2.1)

> **Roles:** **Implementer = Codex** (TDD, local `node_modules/.bin/{vitest,tsc}`, no `npm install`, no `git`). **Reviewer + test-runner + deps + boot-smoke + git = Claude.** **Window/visual smoke = user.**
> REQUIRED SUB-SKILL (Codex): test-first, bite-sized, no placeholders.

**Goal:** Turn the demo (mock providers + frozen toy corpus) into a tool you can actually use: a **Provider Registry** (Embedder / Judge / PdfParser, each *local-downloadable* or *remote-API*), a **Settings** surface with **secure key storage**, a **local embedding** path (pure-JS, one-click model), a **deterministic local judge** (NLI), and a **persistent personal library** you add your own PDFs to. Offline-first; cloud optional. Core stays pure-TS + Electron-free (铁律 §3).

**Research-grounded selection (Claude + Codex search, 2026-06-23):**
- Embedding runtime: **`@huggingface/transformers`** (transformers.js, ONNX/WASM, offline via `env.allowRemoteModels=false`). Default model **`all-MiniLM-L6-v2`** (22M, Apache, **mean-pool / no prefix** — safe default); stronger option **`bge-small-en-v1.5`** (retrieval 51.68, MIT, **CLS-pool + query instruction**); long-ctx option **`nomic-embed-text-v1.5`** (Apache). Escape hatch: `onnxruntime-node`.
- Judge: **`MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`** NLI via transformers.js (entailment→`supports`, contradiction→`contradicts`, neutral→`unclear`) as a deterministic local judge; **cloud/`LlmJudge`** (existing, provider-agnostic) for hosted or **local Ollama** (OpenAI-compatible, zero new code); `node-llama-cpp` (GGUF/Metal) as an optional in-process LLM judge later.
- PDF: default **`pdf.js`/`unpdf`** (existing, pure-JS); optional sidecars **GROBID** (Java, Apache-2.0 — scholarly references/TEI, feeds `CitationResolver`) and/or **Docling** (Python, MIT — structure). Excluded as defaults: Marker (GPL+OpenRAIL), Nougat (CC-BY-NC), MinerU (license TBD), PyMuPDF (AGPL).
- Keys: **Electron `safeStorage`** (built-in, default) + `keytar` (optional). Downloads: **`@huggingface/hub`** + a custom TS **model registry** (`provider, modelId, revision, files, expectedBytes, sha256, license, runtime, localPath, status`).

**Depends on (locked, on `main`):** `Embedder`/`Judge` interfaces, `OpenAIEmbedder`/`LlmJudge` (provider-agnostic), `HashEmbedder`/`MockJudge`, `makeToolContext`/`buildMockContext`, `ingestPdf`, M3/M4 Electron app + worker protocol.

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — §3 铁律 / §5 provenance / §8 ledger / §13 tech / §16 privacy (outbound-snippet / offline).

## 0. v2 changelog (Codex plan review → adopted)
**M5a blockers:**
1. **Task 3** splits pure **`resolveEmbedder`/`resolveJudge` factories** (offline-testable: assert the right provider TYPE is constructed, **no `embed()`**) from `buildContext` (which calls `buildIndex`→`embed`). Offline tests build a real ctx ONLY with `hash`+`mock`; the `openai-compatible` path is unit-tested at the factory level (no network).
2. **Electron owns secrets; worker stays Electron-free (Task 4/5):** `safeStorage` lives in `electron/` — an **`electron/keystore.ts` module constructed/owned by `main`** after `app.whenReady` (guard `isEncryptionAvailable()`); the plain-Node worker **never imports Electron**. Renderer sends a key → **main** → keystore; on `set_config`, **main reads secrets from the keystore and passes them to the worker** in the rebuild payload. Worker holds a **mutable, rebuildable `ctx`** (runtime holder) so `set_config` swaps providers in place. `set_key` is a **main** concern, not a worker message.
3. **Ollama (Task 5):** endpoint **`http://localhost:11434/v1/`** + **explicit embedding + chat model IDs + dim** (not bare `localhost:11434`).

**Selection/refinements:** default local embedder = **`Xenova/all-MiniLM-L6-v2`** (mean pooling, no prefix, Apache, transformers.js-verified — safe default). **Pooling + query/doc prefix are PER-MODEL registry metadata** (BGE = **CLS** pooling + a query *instruction*, NOT `query:`/`passage:`; Nomic = task prefixes + extra postproc) — Task 6/7. **NLI judge (Task 12)** reaches only **3 of the 5 verdicts** (entailment→`supports` / contradiction→`contradicts` / neutral→`unclear`); weak/unsupported nuance needs the LLM judge, and the exact DeBERTa checkpoint's **ONNX export must be verified at impl**. **GROBID (Task 11)** needs an XML-parser dep + a defined TEI fixture shape. **CI:** absent models must **fail** under `env.allowRemoteModels=false`, never silently download.

**v2.1 (Codex re-review):** (i) reconciled `safeStorage` wording — Task 4 = an `electron/keystore.ts` owned by `main` (not inline in main.ts); (ii) selection-table default embedder → `all-MiniLM-L6-v2` (consistent with Task 6); (iii) pinned the **worker runtime contract**: `handleWorkerMessage(msg, ctx)` stays **pure + same signature**, while `worker.ts` owns a mutable `let ctx` and intercepts `get_config`/`set_config` in its loop (existing tests/call-sites untouched); (iv) added a **secrets-redaction rule** — the `set_config`/`secrets` payload must never reach a TraceEvent, stdout/stderr, a thrown error message, or any log (sanitize-error boundary in `worker.ts`; `main` must not log the key either).

**Phasing (each phase independently shippable; user may stop after any):**
- **M5a** Provider Registry + config + secure keys + Settings tab + cloud/Ollama wiring — *the unlock (mock→real)*. TDD core + settings smoke.
- **M5b** Local embedding provider (transformers.js) + model download manager. TDD + download smoke.
- **M5c** Persistent on-disk library + import-your-own-PDFs + `PdfParser` provider (pdf.js default; GROBID/Docling sidecar adapter). Bigger.
- **M5d** Deterministic NLI judge + optional `node-llama-cpp`/Ollama LLM judge + **provider ablation** (reuse M4 runner) + packaging. Later.

---

## Phase M5a — Provider Registry + Settings + secure keys (the unlock)

### Task 1: Provider descriptors + registry (headless, TDD)

**Files:** Create `src/providers/registry.ts`; Test `tests/providers.registry.test.ts`

- [ ] **Step 1: Failing test** — `PROVIDERS` lists built-in providers with `{ id, kind: "embedder"|"judge"|"pdf", location: "builtin"|"remote"|"local-download", needsKey: boolean }`; `embedderProviders()` includes `hash` (builtin) + `openai-compatible` (remote, needsKey). `getProvider("hash")` returns the descriptor.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** the descriptor type + a static `PROVIDERS` array (embedder: `hash`, `openai-compatible`, later `transformers-local`; judge: `mock`, `openai-compatible`, later `nli-local`; pdf: `unpdf`, later `grobid`,`docling`) + lookup helpers. Pure data + types.
- [ ] **Step 4:** green + `tsc`.
- [ ] **Step 5: Commit** `feat(harness): provider registry descriptors (M5 Task 1)`

### Task 2: App config (persisted) + Zod schema (headless, TDD)

**Files:** Create `src/providers/config.ts`; Test `tests/providers.config.test.ts`

- [ ] **Step 1: Failing test** — `AppConfig` Zod schema parses `{ embedder:{provider:"openai-compatible", model, baseURL, dim}, judge:{provider:"mock"}, pdf:{provider:"unpdf"} }`; `defaultConfig()` returns an all-offline default (`hash`+`mock`+`unpdf`); `loadConfig(path)`/`saveConfig(path,cfg)` round-trip JSON; unknown provider → parse error.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** the Zod `AppConfig` (provider ids validated against the registry), `defaultConfig`, `loadConfig`/`saveConfig` (JSON file, **never stores secrets** — only a `keyRef`).
- [ ] **Step 4:** green + `tsc`.
- [ ] **Step 5: Commit** `feat(harness): persisted AppConfig schema (M5 Task 2)`

### Task 3: `buildContext(config, secrets)` — config-driven ToolContext (headless, TDD)

**Files:** Create `src/providers/context.ts`; Test `tests/providers.context.test.ts`

- [ ] **Step 1: Failing test** — (a) `resolveEmbedder({provider:"hash",dim:256},{})` returns a `HashEmbedder`; `resolveEmbedder({provider:"openai-compatible",model:"m",baseURL:"http://x",dim:1536},{"openai-compatible":"sk-x"})` returns an `OpenAIEmbedder` **without calling `.embed`** (assert `instanceof`/`.model`/`.dim`, no network); unknown provider → throws. (b) `resolveJudge` analogously (`mock`→`MockJudge`, `openai-compatible`→`LlmJudge`). (c) `buildContext` with **`hash`+`mock`** (offline only) builds a working `ToolContext` that audits a toy claim.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `resolveEmbedder(cfg, secrets)` + `resolveJudge(cfg, secrets)` (pure factories, switch on provider id, secrets injected from the `secrets` map — **never from config**), then `buildContext(config, corpusDir, secrets)` = resolve providers → `assembleSources`/`buildIndex` → `makeToolContext`. **Generalizes `buildMockContext`** (which stays for tests). The offline suite only ever builds the index with `hash`+`mock`; remote providers are covered at the factory level. Switching embedder ⇒ re-index (provenance §5, enforced by `embedding_model/dim` + lint).
- [ ] **Step 4:** green + `tsc` + full suite.
- [ ] **Step 5: Commit** `feat(harness): config-driven buildContext over providers (M5 Task 3)`

### Task 4: Secure key store (Electron `safeStorage`) — adapter + headless fake

**Files:** Create `src/providers/keystore.ts` (interface + in-memory fake) + `electron/keystore.ts` (safeStorage impl); Test `tests/providers.keystore.test.ts`

- [ ] **Step 1: Failing test** — `InMemoryKeyStore` (headless) `set("openai", "sk-x")` / `get("openai")` round-trips; `get` of an unset id → `undefined`. (The `safeStorage` impl is Electron-only, smoke-verified.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `KeyStore` interface (`get/set/delete`) + `InMemoryKeyStore` in `src/providers/keystore.ts` (**pure, no Electron import** — used by tests/headless). `electron/keystore.ts` (Electron-only) implements it via `safeStorage` — **guard `safeStorage.isEncryptionAvailable()` first** (warn + degrade if false), `encryptString`/`decryptString` to a userData file (ciphertext only). **Owned by Electron main; the plain-Node worker never imports it.** Keys never touch config JSON or git.
- [ ] **Step 4:** green + `tsc`; `tsc -p electron/tsconfig.json` clean.
- [ ] **Step 5: Commit** `feat(app): secure key store (safeStorage) + headless fake (M5 Task 4)`

### Task 5: Worker config messages + Settings tab (shell, write-then-smoke)

**Files:** Modify `src/app/protocol.ts` (+ test), `src/app/worker.ts`, `electron/{main.ts,preload.ts}`, `electron/renderer/tabs/Settings.tsx`

- [ ] **Step 1 (TDD):** **Keep `handleWorkerMessage(msg, ctx)` pure + signature UNCHANGED** (audit/list_sources/run_eval/build_matrix — existing tests + call-sites stay green). The config/ctx mutation lives in `worker.ts`'s runtime, NOT the pure handler: factor a testable `runWorkerLoop({ in, out, corpusDir, readSecrets })` that owns a mutable `let ctx` and **intercepts** `{type:"get_config"}`→config and `{type:"set_config",config,secrets}`→validate + **rebuild `ctx` via `buildContext(config, corpusDir, secrets)`** (secrets arrive IN the message; the worker never reads the keystore), delegating every other message to `handleWorkerMessage(msg, ctx)`. **Redaction (security):** wrap the loop in a sanitize-error boundary — the `set_config`/`secrets` payload must NEVER appear in a TraceEvent, stdout/stderr, a thrown error message, or a log; never `console.log` the payload. Test `runWorkerLoop` over fake in/out: `set_config`→`hash`+`mock` then `audit` still works; bad config → `error` + ctx unchanged; **a secret placed in the payload never appears in any emitted line**. **`set_key` is a main concern, NOT a worker message** (Task 4).
- [ ] **Step 2:** `worker.ts` keeps the rebuildable runtime; `electron/main.ts` handles `set_key` (→ keystore) itself and, on config change, **reads secrets from the keystore and sends `{set_config, config, secrets}` to the worker**; `main.ts`/`preload` add the IPC channels.
- [ ] **Step 3 (smoke):** `Settings` tab: pick Embedder/Judge/PDF provider (dropdown from registry), enter API base/model/dim/key; key → `harness.setKey` (→ main → safeStorage), "Apply" → main rebuilds + `set_config`. Show active offline/online + privacy note. `tsc -p electron/tsconfig.json` clean; `node electron/build.mjs`; Claude boot-smoke; user smoke.
- [ ] **Commit (per step):** `feat(app): worker config/key messages + Settings tab (M5 Task 5)`

> **After M5a:** the app can audit YOUR draft against the corpus using **cloud (OpenAI-compatible) or local Ollama** (baseURL `http://localhost:11434/v1/`, with explicit embedding + chat model IDs + dim) and a real key in the OS keychain — no more mock-only.

---

## Phase M5b — Local embedding provider (one-click free model, pure JS)

### Task 6: `TransformersEmbedder` (transformers.js) — implements `Embedder`

**Files:** Create `src/providers/transformers-embedder.ts`; Test `tests/providers.transformers.test.ts`. Claude installs `@huggingface/transformers` first.

- [ ] **Step 1: Failing test** — `new TransformersEmbedder({ model:"Xenova/all-MiniLM-L6-v2", dim:384 })`; `await e.embed(["social media depression"])` returns `[number[]]` with length 384; `e.model` reflects the model id. (Downloads/caches the ONNX model on first run; test may be marked slow/network — see Step 3.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** via `pipeline("feature-extraction", model)` with **per-model** pooling + prefix from the model registry (Task 7): default `all-MiniLM-L6-v2` = **mean** pooling, **no prefix**; BGE = **CLS** pooling + a query *instruction* (not `query:`/`passage:`); Nomic = task prefix + extra postproc. Normalize → `number[][]`. Honor `env.cacheDir` + `env.allowRemoteModels=false` (absent model must **fail**, not download). **CI note:** gate the live test behind `process.env.M5_LIVE_EMBED` (default-skip); a shape test runs on a stubbed pipeline. Provenance: `model`/`dim` → Chunk (§5).
- [ ] **Step 4:** `tsc` + full suite (offline-skipped live test); Claude runs the live test once locally to confirm.
- [ ] **Step 5: Commit** `feat(harness): local TransformersEmbedder (transformers.js, ONNX) (M5 Task 6)`

### Task 7: Model download manager + registry (headless, TDD)

**Files:** Create `src/providers/models.ts`; Test `tests/providers.models.test.ts`

- [ ] **Step 1: Failing test** — `MODEL_REGISTRY` lists downloadable models `{ id, provider:"transformers-local", files, expectedBytes, sha256?, license, runtime, sizeLabel }`; `modelStatus(id, cacheDir)` returns `"absent"|"present"` by checking the cache; `resolveModelPath` is project/user-local.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** the registry + status/path helpers + a `downloadModel(id, cacheDir, onProgress)` using `@huggingface/hub` (or HTTP Range) writing to a temp file then atomic-rename, with progress callbacks. (Live download gated behind env like Task 6.)
- [ ] **Step 4:** green (status/path/registry unit-tested offline) + `tsc`.
- [ ] **Step 5: Commit** `feat(harness): model registry + download manager (M5 Task 7)`

### Task 8: Wire local embedder into providers + Settings download UI (smoke)

- [ ] `buildContext` handles `embedder.provider:"transformers-local"` → `TransformersEmbedder`. Settings tab gains a **model list with Download/▢Present + progress**; selecting a local model triggers download then **prompts re-index** (provenance). `registry.ts` adds `transformers-local`. tsc + boot-smoke + user smoke.
- [ ] **Commit:** `feat(app): local embedding model picker + download UI (M5 Task 8)`

> **After M5b:** fully offline — download a free ONNX model once, embed locally, no Python/JVM, no cloud key.

---

## Phase M5c — Persistent library + import your own PDFs + PdfParser provider

> Bigger; specified at contract level (Codex/Claude refine test sketches at implementation, per the same TDD flow).

### Task 9: On-disk persistent store (better-sqlite3 file DB, §4 subset)
- Persist `Source`/`Chunk` (+ provenance) to a user-data SQLite file (not `:memory:`); `openLibrary(path)`, `addSource`, `listSources`, `removeSource`; incremental index (only re-embed new/changed sources). TDD over a temp DB file. Invariant: a source's chunks are pinned to one `embedding_model/dim`; changing the active embedder marks the library **stale → re-index**.

### Task 10: `PdfParser` provider interface + default (pdf.js) + import flow
- `PdfParser { parse(bytes): Promise<{ pages: string[]; structure?: {...} }> }`; default `UnpdfParser` (wraps existing `ingestPdf`). Drag-drop / file-pick import in a **Library** tab → parse → `addSource` → index → usable in Audit. TDD the parser interface + import-to-library logic (headless); UI is smoke.

### Task 11: GROBID (and/or Docling) sidecar adapter (optional, detected)
- `GrobidParser` implements `PdfParser` by calling a local GROBID REST service (`/api/processFulltextDocument` → TEI) → sections + **references** (feed `CitationResolver`); detect "is GROBID running / installed?", guide the user to a one-time download (Docker/JRE) if absent; **never required** for default path. Map TEI sections → section-aware chunks (unlocks §5 section-aware retrieval). TDD the TEI→Source/Chunk mapping against a captured TEI fixture (no live JVM in CI).

---

## Phase M5d — Deterministic NLI judge + local LLM + provider ablation + packaging (later)

### Task 12: `NliJudge` (DeBERTa-v3 MNLI via transformers.js) — implements `Judge`
- entailment→`supports`, contradiction→`contradicts`, neutral→`unclear` (map weak via score threshold); pure-JS/ONNX, deterministic, snippet-only. TDD the label-mapping logic on stubbed scores; live model behind env gate. Register as judge provider `nli-local`.

### Task 13: Optional `node-llama-cpp` / Ollama LLM judge
- `node-llama-cpp` in-process GGUF (Metal) with JSON-schema-constrained output → the §6 judge schema; or rely on Ollama via the existing `LlmJudge` (baseURL). Provider `llama-local` / reuse `openai-compatible`.

### Task 14: Provider ablation (reuse M4 runner) + packaging
- Use the M4 `runAblation` to compare **local bge-small vs cloud OpenAI vs NLI** on the frozen gold → an `ablation.md` decision artifact (the co-evolution loop now spans providers). Then packaging (`electron-builder`, `electron-rebuild` for better-sqlite3 + native addons, asar unpack, signed `.app`).

---

## M5 Acceptance (per phase)
- [ ] **M5a:** `npm test` green incl. `providers.{registry,config,context,keystore}`; Settings tab swaps Embedder/Judge/PDF providers; API key stored via `safeStorage` (never in config/git); audit runs against a real cloud or local-Ollama provider.
- [ ] **M5b:** local ONNX model downloads once + embeds offline; switching model prompts re-index; CI stays offline (live tests env-gated).
- [ ] **M5c:** import your own PDF → persisted library → audit against it; GROBID optional + detected, never required.
- [ ] **M5d:** NLI judge offline; provider ablation produces a comparison artifact; (packaging optional).
- [ ] **铁律 throughout:** `src/**` Electron-free; secrets only in keychain; offline default; provenance enforced on embedder switch.

## Out of scope
GPU inference; multi-user/sync; Zotero/DOI sync (could be M6); non-OpenAI-compatible cloud SDKs; mobile.

## Review notes (plan author → Codex)
- M5a/M5b are the high-ROI "make it usable" core — implement first, fully TDD; M5c/M5d are larger and can follow.
- Reuse: existing `Embedder`/`Judge`/`OpenAIEmbedder`/`LlmJudge`/`makeToolContext`/`ingestPdf`/M4 `runAblation`/worker protocol. **The cloud + Ollama paths need NO new provider code — only config + key plumbing.**
- Invariants: secrets via `safeStorage` only (never config/git); offline-first defaults; **embedder switch ⇒ re-index** (provenance already enforced); `src/**` Electron-free; heavy parsers (GROBID/Docling) are detected optional sidecars, never default/bundled.
- CI must stay offline: gate all live model download/inference tests behind an env flag; unit-test the registry/config/mapping logic deterministically.
- Risk to verify at impl: `@huggingface/transformers` pooling/normalization correctness + offline cache flags; `safeStorage` availability on first run; better-sqlite3 under Electron when M5c persistence lands (electron-rebuild → M5d packaging).
