# M5d — Deterministic NLI judge · provider ablation · local-LLM judge · packaging

Status: v2 (Codex-reviewed → CONDITIONAL GO, 5 must-fixes applied) · Date: 2026-06-23 · Depends on: M5a/b/b.1/c (all on `main`)

## Why

M5b gave us an **offline local embedder**. The judge is still either `MockJudge` (rule-of-thumb,
not a quality model) or a **cloud** LLM (`openai-compatible`, needs a key + network). For a genuinely
self-usable, offline, *deterministic* claim-checker we want a **local NLI judge** — the judge analog
of the local embedder. We also want to **measure** local-vs-cloud quality (ablation) and, eventually,
ship a **double-clickable `.app`**.

## Scope decision (recommended)

| Phase | What | Value | Effort/Risk | Recommendation |
|---|---|---|---|---|
| **M5d-A** | Deterministic **NLI judge** (transformers.js, DeBERTa-NLI) | High — offline real judge | Medium, mirrors M5b | **DO NOW** |
| **M5d-B** | **Provider ablation** surface (reuse `runAblation`) | Medium — portfolio + quality proof | Low (infra exists) | **DO NOW** |
| **M5d-C** | **node-llama-cpp** in-process GGUF judge | Low-Med (Ollama already works) | High (native, electron-rebuild) | **OPTIONAL / defer** |
| **M5d-D** | **Packaging** `.app` (electron-builder, asar, rebuild) | High — "real app" | High (native rebuild + signing) | **OPTIONAL / separate** |

**Free win, no new code:** a **local generative LLM judge via Ollama** is *already* reachable —
set judge provider `openai-compatible`, `baseURL=http://localhost:11434/v1`, model e.g. `llama3.1`.
M5d-C only adds *in-process* GGUF (no server). So Phase C is mostly a **Settings preset + doc**, with
node-llama-cpp as a genuinely-optional extra.

---

## M5d-A — Deterministic NLI judge (transformers.js)

### Contract
A new `NliJudge implements Judge` (`src/check/nli-judge.ts`). NLI models score a **(premise, hypothesis)**
pair over `{entailment, neutral, contradiction}`. For claim-checking:
- **premise = snippet** (the retrieved evidence), **hypothesis = claim** (the draft sentence's claim).
  Direction confirmed by Codex against `zero-shot-classification.js:120-128` — entailment(snippet→claim) = "evidence supports claim".

> **MUST-FIX #1 (Codex BLOCKER, verified vs `@huggingface/transformers@4.2.0` source):**
> `pipeline("text-classification", hfId)` does **NOT** accept sentence pairs (its callback is `(texts, options)` only,
> no `text_pair`), and `pipeline("zero-shot-classification")` **discards the neutral logit** we need. So we **cannot**
> use a high-level pipeline. The correct, verified path is the **lower-level Auto\* classes**:
> ```ts
> import { AutoTokenizer, AutoModelForSequenceClassification, env } from "@huggingface/transformers";
> env.allowRemoteModels = false;                 // MUST-FIX #4: runtime never auto-downloads (default is true)
> const tok = await AutoTokenizer.from_pretrained(hfId);
> const model = await AutoModelForSequenceClassification.from_pretrained(hfId);
> const inputs = await tok(snippet, { text_pair: claim, padding: true, truncation: true });
> const { logits } = await model(inputs);        // softmax the 3 logits
> ```
> **MUST-FIX #3 (id2label):** label index order differs per model — read `model.config.id2label`
> (e.g. `{0:"contradiction",1:"neutral",2:"entailment"}`) to map logit positions → `{entailment,neutral,contradiction}`
> BEFORE calling `mapNliToVerdict`. Never assume a fixed index.

### Entailment → Verdict mapping (the crux — TDD this as a PURE function)
`mapNliToVerdict(scores: {entailment; neutral; contradiction}): {verdict, confidence}`:

| Condition | Verdict | confidence |
|---|---|---|
| argmax = entailment, p ≥ 0.75 | `supports` | p |
| argmax = entailment, 0.50 ≤ p < 0.75 | `weakly_supports` | p |
| argmax = contradiction, p ≥ 0.50 | `contradicts` | p |
| argmax = neutral (or no class ≥ 0.50) | `unclear` | p |

- `unsupported` is intentionally **not** emitted by NLI (neutral≈"evidence doesn't establish it" → we use
  the conservative `unclear`; "unsupported" stays a cloud/LLM-judge verdict). **← confirm with Codex.**
- `reason` = templated, e.g. `"NLI: entailment=0.82 neutral=0.10 contradiction=0.08"` (deterministic).
- `suggested_rewrite = ""` (NLI is not generative) — acceptable; the UI already tolerates empty.
- `model` = the NLI model id.

### Model registry
NLI models have a **different shape** than embedders (labels, not pooling/dim). Add a *separate*
`NLI_MODEL_REGISTRY` (pure, renderer-safe) in `model-registry.ts` — **a separate slot, NOT folded into
`MODEL_REGISTRY`**, because `tests/providers.models.test.ts:8-30` asserts the exact M5b embedder list and
must stay green (Codex WARN).
- **default `nli-deberta-v3-xsmall` → `Xenova/nli-deberta-v3-xsmall`** (MUST-FIX #2: Codex found this id
  referenced in the installed transformers.js zero-shot examples; the `-small` variant has **no** node_modules
  hit and its ~140MB size was unverified — start with xsmall, promote `-small` only after a live test).
- (alt, also referenced in-package) `Xenova/mobilebert-uncased-mnli`.
- (candidate) `bart-large-mnli` → too big (~1.6GB) — exclude as default.
- Fields: `{ id, hfId, license, sizeLabel }`. **Do NOT hardcode the label index map** — read it at runtime
  from `model.config.id2label` (MUST-FIX #3); the registry only needs the model identity.
- **download/status reuse:** `downloadModel`/`modelStatus` (M5b) currently warm the cache via
  `pipeline("feature-extraction")` — for NLI the warm path is `AutoModelForSequenceClassification.from_pretrained(hfId)`
  (+ `AutoTokenizer`). Generalize the download trigger by model *kind*, keep the same `cacheDir`/status logic.

### Wiring
- `registry.ts`: judge provider `{ id:"transformers-nli", kind:"judge", location:"local-download", needsKey:false }`.
- `context.ts resolveJudge`: `case "transformers-nli"` → `new NliJudge({ hfId, labelMap })` from the NLI registry.
- `models.ts`: `modelStatus`/`downloadModel` must handle NLI ids too (reuse the same cache-dir logic).
- **Settings**: Judge section — when `transformers-nli` selected, show model picker + Download + status
  (mirror the embedder local-model UX; factor the shared "local model row" if cheap).

### TDD (offline)
- `tests/check.nli-judge.test.ts`: **pure** `mapNliToVerdict` over the 4 bands (entailment-high→supports,
  entailment-mid→weakly_supports, contradiction→contradicts, neutral→unclear; tie/low→unclear). No model load.
- **Live** (`M5D_LIVE_NLI=1`, default skip): load `Xenova/nli-deberta-v3-xsmall`, judge a clearly-entailed
  pair → `supports`, a clearly-contradicted pair → `contradicts`. CI stays offline.
- Determinism: same input → same verdict (argmax, no sampling).
- **MUST-FIX #4 (offline is a RUNTIME guard, not just a test gate):** transformers.js defaults
  `allowRemoteModels: true` (`src/env.js:210-211`), so a runtime NLI judge or `run_ablation` could *silently
  download* a model if the cache is cold. `NliJudge` must set `env.allowRemoteModels = false` before any
  inference; a missing model then throws (caught + surfaced as "model not downloaded") instead of hitting the
  network. The `M5D_LIVE_NLI` gate only governs the *test* — it does not protect the app path.

---

## M5d-B — Provider ablation surface (reuse `runAblation`)

`runAblation` (M4) already runs variants over the gold set → `ablation.md` (macro-F1 / overclaim-recall /
retrieval-recall@k). M5d-B = **expose** it so the user can compare providers:

- **MUST-FIX #5 (Codex WARN — IPC missing in ALL three layers):** `run_ablation` exists nowhere yet —
  add it to (1) `src/app/protocol.ts` (the worker message + handler), (2) `electron/preload.ts` (expose
  `runAblation()`), (3) `electron/renderer/api.d.ts` (the typed method). The plan's B is not done until all three land.
- `src/app/protocol.ts`: a `run_ablation` message → builds **offline** default variants (Codex Q4):
  `hash+mock`, `all-MiniLM+mock`, `all-MiniLM+NLI` — include a transformers row **only if the model is already
  cached** (`modelStatus`), else emit a skipped row (never trigger a download from ablation). Calls
  `runAblation(variants, {corpusDir, goldPath: gold fixture, outDir})`.
- **Surface the path (Codex WARN):** `runAblation` writes `ablation.md` but *returns only rows* — the worker
  handler must also return the `ablation.md` path so the renderer can show/open it.
- **Label sanitization (Codex NIT):** variant `label` becomes a directory segment (`ablation.ts:34-35`) —
  reject/replace slashes + special chars before use.
- **Determinism/offline:** default variants use only offline providers (hash/local, cached-only). Live providers gated.
- **Electron**: Eval&Trace tab — an "Ablation" button that triggers `run_ablation` and renders the table.
- TDD: `tests/coevo.ablation.test.ts` (extend) — two offline variants over the seed gold → two rows,
  `ablation.md` written, deterministic numbers.

> Honest framing (already in `renderAblation`): "Seed set — NOT an authoritative benchmark." Keep it.

---

## M5d-C — Local generative LLM judge (OPTIONAL)

1. **Ollama (no new code):** document + add a **Settings preset** "Local (Ollama)" that fills
   judge `openai-compatible` + `baseURL=http://localhost:11434/v1` + a model field. Hint: `ollama serve` + `ollama pull llama3.1`.
2. **node-llama-cpp (optional, heavy):** in-process GGUF judge `LlamaCppJudge implements Judge` — native
   bindings, needs `electron-rebuild`, model file picker. **Contract-level only**; do not add the dep until
   the user wants offline-generative-without-a-server. Defer to after packaging is figured out.

---

## M5d-D — Packaging `.app` (OPTIONAL, separate)

- `electron-builder` config: mac target, `asar`, `asarUnpack` for native `.node` (better-sqlite3, onnxruntime).
- `electron-rebuild` / `@electron/rebuild` for `better-sqlite3` against the Electron ABI (currently the
  worker runs as a plain-Node child — confirm better-sqlite3 loads under the packaged runtime).
- transformers.js model cache: ensure `env.cacheDir` points into `userData` (writable in a signed app),
  not the asar (read-only).
- Code-signing/notarization: out of scope for a private portfolio build (document the unsigned-dev path:
  `npm run package` → `out/*.app`, Gatekeeper right-click-open).
- **Risk:** native ABI mismatch is the classic Electron footgun — verify the worker's better-sqlite3 +
  onnxruntime load inside the packaged app before claiming done.

---

## Cross-cutting invariants (unchanged)
- **Iron rule:** `src/**` never imports electron. NLI judge + ablation live in `src/`.
- **Offline determinism:** every model-loading test gated (`M5D_LIVE_NLI`); default `vitest` pulls no model.
- **Secrets:** NLI/local judges need no key; the `redactSecrets` boundary (M5c follow-up) still applies.
- **Provider switch ⇒ re-index** already holds for embedders; the **judge** has no index, so switching the
  judge only rebuilds ctx (cheap) — no re-embed.

## Open questions — RESOLVED (Codex plan review)
1. neutral → **`unclear`** ✅ (Codex: `unsupported` would mean "absence of evidence = evidence of absence" — wrong semantics).
2. default model → **`Xenova/nli-deberta-v3-xsmall`** ✅ (the `-small` id has no in-package hit + unverified size; xsmall is referenced in the installed transformers.js examples). Alt: `Xenova/mobilebert-uncased-mnli`.
3. thresholds 0.75 / 0.50 → **OK as conservative start** ✅; data-tune after the first ablation run.
4. default ablation variants → **`hash+mock`, `all-MiniLM+mock`, `all-MiniLM+NLI`** ✅ (max info, offline, cached-only).
5. Phase C/D → **DEFER confirmed** ✅ (Ollama = existing openai-compatible path; node-llama-cpp + packaging add native-build risk atop better-sqlite3 + ONNX).

Also confirmed by Codex: `suggested_rewrite = ""` does **not** break the contract — it's typed `string`,
flows through `checkClaim`/audit unchanged, and the UI already renders "No rewrite suggested." (`App.tsx:88-91`).
Iron rule holds (A+B add only `src/check/nli-judge.ts` + `src/app/protocol.ts` entries; no electron in `src/`).

## Suggested order
A (NLI judge) → B (ablation surface) → C-doc (Ollama preset) → [optional] C-llama-cpp → [optional] D-packaging.
