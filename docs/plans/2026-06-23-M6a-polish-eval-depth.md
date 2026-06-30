# M6α GOAL — review-tail polish (×3) + eval depth (×1: gold + answer_groundedness)

Status: v2 (Codex plan-review stalled mid-run; Claude self-verified the critical points + folded must-fixes) · Date: 2026-06-23 · Depends on: M5 (all on `main`, 111 commits / 153 tests)

## v2 must-fixes (verified by Claude, replacing the stalled review)
- **MF1 (T4a):** exactly **2 tests hard-code `r.n === 23`** — [`tests/integration.m1-eval.test.ts:12`](../../tests/integration.m1-eval.test.ts) and [`tests/eval.runner.test.ts:13`](../../tests/eval.runner.test.ts). Gold expansion MUST update both to the new count. All other eval/ablation assertions are ranges/types/finite (`toBeGreaterThan(0)`, `typeof "number"`, 0..1 bounds) — they survive.
- **MF2 (T4a integrity authority):** verified gold `locator.source_hash` == `sources.lock.json` hash for **23/23** entries → the integrity test's authority is **`fixtures/sources.lock.json`** (per-`id` `source_hash`). Test asserts: (a) gold.source_hash == lock[cited_source].source_hash; (b) lock hash == `sourceHash(canonicalize(corpusText))` (freeze consistency); (c) locator offsets in range + snippet present.
- **MF3 (T2 callers):** `importPdf` returning `{source, duplicate}` (was `Source`) breaks callers — update `src/app/worker-runtime.ts` `import_pdf` handler + `tests/library.import.test.ts`.
- **Open questions resolved (Claude):** ① groundedness = **support-precision** (deterministic primary; NLI cross-check deferred); ② gold ≈**40** total, rebalance weakly_supports/unclear/contradicts; ③ integrity test = **hard gate**; ④ T2 = explicit **`{source, duplicate}`** flag; ⑤ T3 reason surfaced for **all** judges (additive; NLI's is most informative).

## Why
Close the three small items the M5 互评 rounds deferred, then add the **eval-depth** piece that most
strengthens the "Evaluation" JD headline: a **bigger gold set** + a new reported metric,
**`answer_groundedness`**. All offline-deterministic, TDD'd, following the established patterns.

Scope = **3 polish + 1 depth** (the "+1"):
- **T1** GROBID references → persist into `citation_metadata.raw` (M5c-C tail).
- **T2** import dedup by `source_hash` (M5c review NIT).
- **T3** `judge.reason` → surfaced through `DraftAudit` + renderer (M5d review N1).
- **T4** eval depth: **(a)** grow `gold_claims.jsonl` + a gold-integrity test; **(b)** add `answer_groundedness` to the eval report + ablation.

---

## T1 — GROBID references persistence
`teiToSourceChunks` already returns `references: {title?,author?,year?}[]` ([grobid.ts:99,133](../../src/library/grobid.ts)),
but `GrobidParser.parse` returns only `{source, chunks}` (drops them). The library already persists the full
`citation_metadata` as JSON (`library.ts:171` `JSON.stringify(source.citation_metadata)` ↔ `:117` parse), and
`CitationMetadata` already has `raw?: Record<string, unknown>` ([types.ts:1-4](../../src/types.ts)).
- **Fix:** in `GrobidParser.parse`, set `source.citation_metadata.raw = { ...source.citation_metadata.raw, references }`
  before returning. `importPdf` persists `source` unchanged → references land in the DB, no schema change.
- **TDD:** extend `tests/library.grobid.test.ts` — the captured-TEI path yields `source.citation_metadata.raw.references`
  containing the `Orben` reference. (Pure, offline.)

## T2 — import dedup by source_hash
`addSource` does a bare `INSERT` ([library.ts:146](../../src/library/library.ts)); re-importing the same PDF makes a
duplicate row. `source_hash` is only known **after** parse (it's `sourceHash(canonicalize(fulltext))`), so dedup must
happen post-parse, pre-embed (to also skip the expensive embedding).
- **Fix:** add `Library.findBySourceHash(hash): Source | undefined` (indexed lookup). In `importPdf`: after `parse`,
  if `library.findBySourceHash(source.source_hash)` exists → **skip embed + addSource**, return `{ source: existing, duplicate: true }`.
  Add a `UNIQUE(source_hash)` index as a DB-level backstop. `importPdf` return type becomes `{ source; duplicate: boolean }`.
- **Worker:** `import_pdf` reply includes `duplicate` so the Library tab can show "already imported" instead of a silent dup.
- **TDD:** `tests/library.import.test.ts` — import the same bytes twice → 2nd returns `duplicate:true`, `listSources().length === 1`.

## T3 — judge.reason → audit + UI
`JudgeOutput.reason` exists but `MentionSupport` ([audit.ts:11](../../src/draft/audit.ts)) drops it (the mapping at
`:53-56` copies verdict/locator/quote/suggested_rewrite, not reason). For the NLI judge especially, `reason`
(`"NLI: entailment=0.82 …"`) explains the verdict and is worth showing.
- **Fix:** add `reason: string` to `MentionSupport` + the `api.d.ts` `HarnessMentionSupport`; map `check.cited_source_support.reason`
  in `audit.ts`; render it in the Audit hero (`electron/renderer/App.tsx`, near the existing verdict/rewrite display).
- **TDD:** the draft-audit test asserts `sentence.support.reason` is populated end-to-end.

## T4 — eval depth (the "+1")

### T4a — grow the gold set + integrity test
Current `fixtures/gold_claims.jsonl` = **23** claims (supports:10, unsupported:7, contradicts:3, **weakly_supports:2, unclear:1**),
6 sources, 12 overclaim-tagged. Thin classes (weakly_supports, unclear, contradicts) weaken per-class metrics.
- **Add ~15–17 grounded annotations** (target ≈40 total) read from the 6 corpus `.txt` files, **balancing the thin classes**
  (bring weakly_supports + unclear + contradicts up). Each entry: real `cited_source`, correct `source_hash` (= the corpus
  source's actual hash), a valid `locator` (char offsets in range) whose `snippet` is present at that span, a `rationale`,
  and `overclaim` where applicable. Honest labels only — this is the eval's ground truth.
- **NEW gold-integrity test** `tests/eval.gold-integrity.test.ts`: for every gold entry, (1) `source_hash` equals the
  corpus source's computed `sourceHash(canonicalize(text))`; (2) `locator.char_start < char_end ≤ len(text)`; (3) the
  `snippet` occurs in the source text at/around the locator. This makes the expanded gold trustworthy (catches typo'd
  offsets/hashes) and is itself an "eval rigor" signal.

### T4b — answer_groundedness metric
Add a new reported signal complementary to `overclaim_recall` (which is recall on the *bad* side). `answer_groundedness`
measures the *good* side: **when the system asserts support, how often is that grounded (gold-correct)?**
- **Proposed definition (review point):** `answer_groundedness` = **precision of the support decision** = of predictions in
  `{supports, weakly_supports}`, the fraction whose gold label is also in `{supports, weakly_supports}`; `0` if none.
  Computable from the existing `goldL`/`predL` arrays ([runner.ts:29-44](../../src/eval/runner.ts)) — no model needed, deterministic.
- **Wire:** add `answer_groundedness: number` to `EvalReport`; compute it; include in `report.md` header + per the
  Eval&Trace UI; add it to the **ablation** rows (`AblationVariantResult` + `runAblation` + the Eval&Trace table) so
  local-vs-cloud comparisons show groundedness too.
- **TDD:** `tests/eval.metrics.test.ts` (or runner test) — a tiny gold/pred fixture where some supports are wrong →
  asserts the exact groundedness value; ablation test asserts the field flows through.

---

## Cross-cutting (unchanged invariants)
- **Iron rule:** `src/**` never imports electron. All T1–T4 logic lives in `src/`; only T3's render touches `electron/`.
- **Offline determinism:** no new model loads; T4 is pure arithmetic over gold/pred. Default `vitest` stays offline.
- **Reporting-only:** `answer_groundedness` is reported, **no pass/fail threshold** (spec §15 / M1 gate discipline). Keep the
  "Seed set — not an authoritative benchmark" framing.
- **Secrets:** unaffected; `redactSecrets` boundary stays.

## Open questions for Codex review
1. **`answer_groundedness` definition** — support-precision (proposed) vs an NLI-cross-check ("judge the judge" with M5d-A
   NLI, the "禁同模型出题+判卷" spirit)? The NLI variant couples eval to a model (non-deterministic/gated) — I lean
   support-precision for the core metric. Agree, or want both (NLI as a separate live-gated signal)?
2. **Gold expansion size/labels** — is ≈40 total + rebalancing thin classes right, or a different target/spread?
3. **Should the gold-integrity test be a hard gate** (fail CI on inconsistent gold) — yes, I think (it's the eval's truth)?
4. **T2 dedup return shape** — `{source, duplicate}` vs a thrown "DuplicateSource" the worker catches? I lean the explicit flag.
5. **T3** — surface `reason` for all judges, or only when non-empty (mock/LLM also set reason; NLI's is most informative)?

## Order
T1 → T2 → T3 (polish bundle, one Codex dispatch) → T4a → T4b (eval-depth bundle, one dispatch) → post-merge Codex 互评.
