# M6δ GOAL — policy_compliance metric (the §9-deferred companion; completes the eval trio)

Status: v2 (Codex plan-review stalled mid-run; Claude resolved the open questions from grounding) · Date: 2026-06-23 · Depends on: M0–M6γ (all on `main`, 121 commits / 167 tests)

## Resolved decisions (review stalled; Claude self-verified)
- **Shape** → **struct** `{ grounded_locator_rate, snippet_only_rate, outbound_chars }`; only `outbound_chars` (the
  mode-varying one) goes in the ablation table.
- **Signature** → `policyCompliance(results: { verdict: Verdict; source_hash: string }[], traces: TraceEvent[])`
  (NOT per-claim items): `grounded_locator_rate` from `results`, outbound from the **flat** `traces` sum. Grounded:
  only `judge_cited`/`judge_counter`/`plan_judge` carry outbound; retrieve events have `[]` (sum naturally ignores them).
- **`POLICY_MAX_SNIPPET_CHARS = 2000`** (constant + comment): toy chunks are sentence-sized and there is no clean
  chunker max constant; 2000 is > any single chunk yet << a whole multi-page doc, so it catches concatenation /
  whole-document leakage (the real §16 risk), not legitimate single snippets.
- **grounded_locator scope** → decisive verdicts only (`unclear` excluded). **all-unclear / no-outbound** →
  rate = **1.0** (vacuous: nothing violated).
- **Keep all three** → rates are governance/regression guards (honest: ~1.0 by construction = the proof), and
  `outbound_chars` is the informative, agentic-mode-varying privacy-cost signal. Verified: outbound comes only from
  the judge events, so `maxCandidates=3` (agentic ablation variant) WILL show higher `outbound_chars`. Additive to
  `EvalReport` (no exact-shape `toEqual` on it in tests). Iron rule + offline determinism hold.

## Why
The eval reports **accuracy** (macro-F1) and **faithfulness** (`answer_groundedness`, M6α). Spec §9 deferred a
third: **`policy_compliance`** — does the system's *behavior* obey its operating policy (snippet-only context,
structured grounding, privacy of outbound snippets §16)? This completes the eval trio and adds a **governance /
safety** dimension, not just quality.

**Honest framing (decide up front):** the compliance *rates* below are ~1.0 by construction on a correct system
— that is the **point**: they **prove** the invariants hold and **guard against regressions** (e.g. someone
concatenating snippets, or returning a verdict with no locator). The **informative, mode-varying** dimension is
**outbound volume** — the agentic loop (M6β) and plan-check (M6γ) examine more evidence ⇒ send *more* snippets
out ⇒ a measurable **privacy cost**. So M6δ also closes the loop on M6β: the agentic mode's tradeoff is now
quantified on *both* axes — accuracy/groundedness (down with a noisy judge) **and** outbound/privacy (up).

## What it measures (computed from the eval's per-claim results + traces — both already collected by `runEval`)
`policyCompliance(items: { verdict; source_hash; outbound: string[] }[]) → PolicyCompliance` (pure):
- **`grounded_locator_rate`** — of **decisive** verdicts (≠ `unclear`), the fraction whose locator `source_hash` is
  non-empty (a decisive verdict must be grounded in a real source). `unclear` is excluded (it may legitimately
  have no locator). Expected 1.0 — guards against ungrounded verdicts.
- **`snippet_only_rate`** — of all outbound snippets, the fraction with `length ≤ POLICY_MAX_SNIPPET_CHARS`
  (a single chunk, not a concatenated/whole-document blob). Expected 1.0 — guards the §16 snippet-only invariant.
- **`outbound_chars`** — total characters across all `outbound_snippets` in the run (the privacy cost / leakage
  volume). **Mode-varying**: rises with `maxCandidates` (agentic) and plan-check breadth.
- (optional) `outbound_snippets` — count, for context.

## T1 — the metric (pure, TDD core)
`src/eval/policy.ts`: `export function policyCompliance(items): PolicyCompliance` (+ `POLICY_MAX_SNIPPET_CHARS`).
Pure, deterministic. `tests/eval.policy.test.ts`: synthetic items covering — decisive+grounded → 1.0; a decisive
verdict with empty `source_hash` → rate < 1; an oversized outbound snippet → `snippet_only_rate` < 1; `outbound_chars`
sums correctly; an all-`unclear` set → `grounded_locator_rate` defined (no decisive ⇒ 1.0 by convention, document it).

## T2 — wire into `runEval` + report
- `runEval` ([runner.ts:22](../../src/eval/runner.ts)) already has `r.cited_source_support.verdict`,
  `r.cited_source_support.locator.source_hash`, and collects `traces`. Build `items` per gold claim (verdict +
  source_hash + that claim's outbound snippets from its traces) and compute `policy_compliance`.
- `EvalReport` gains `policy_compliance: PolicyCompliance`. Render the three numbers in the `report.md` header.
- **Eval&Trace UI**: show the trio + outbound_chars.

## T3 — ablation surfaces the privacy cost
- `AblationVariantResult` gains **`outbound_chars`** (the mode-varying one). `runAblation` maps it from the report;
  the ablation table adds an `outbound chars` column. Now the single-shot vs `agentic` worker variants (M6β) show
  the **full tradeoff**: accuracy/groundedness *and* outbound/privacy. (The compliance *rates* stay in the eval
  report, not the ablation table — they don't vary.)

## TDD / determinism / invariants
- Pure `policyCompliance` fully unit-tested; deterministic (counts + ratios, no model, no clock).
- `runEval`/ablation numbers stay reproducible; existing absolute-free assertions hold; the new field is additive.
- **Iron rule**: all logic in `src/`; only the Eval&Trace render touches `electron/`.
- **Reporting-only**: no pass/fail threshold (spec §15 discipline); keep the "seed, not a benchmark" framing.
- No new hardcoded `n` assertions; `policy_compliance` additive to `EvalReport` (watch for exact-shape `toEqual`
  on `EvalReport` in tests — update if any).

## Open questions for Codex review
1. **Shape** — `policy_compliance` as a **struct** `{ grounded_locator_rate, snippet_only_rate, outbound_chars }`
   (proposed) vs a single 0..1 number? I lean struct + put only `outbound_chars` in the ablation table.
2. **`POLICY_MAX_SNIPPET_CHARS`** — what bound proves "single chunk, not whole-doc"? A value tied to the chunker's
   max chunk size (find it) rather than a magic number; or a generous constant (e.g. 2000) with a comment.
3. **`grounded_locator` scope** — decisive verdicts only (proposed; `unclear` excluded) — agree?
4. **all-`unclear` convention** — `grounded_locator_rate = 1.0` when there are no decisive verdicts (vacuous truth)
   vs `0`/`NaN`? I lean 1.0 (nothing violated).
5. **Trivial-by-construction concern** — are the ~1.0 rates worth shipping as governance/regression guards, or is
   `outbound_chars` (the varying one) the only metric worth reporting? I lean keep all three (rates = guards,
   outbound = signal), framed honestly.

## Order
T1 (pure metric + tests) → T2 (runEval + report + UI) → T3 (ablation outbound_chars column) → 互评.
