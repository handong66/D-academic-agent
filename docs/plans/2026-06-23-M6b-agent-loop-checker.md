# M6β GOAL — iterative retrieval agent-loop in the checker (the "Agent Loop" capability)

Status: v2 (Codex-reviewed → CONDITIONAL GO, 5 must-fixes applied) · Date: 2026-06-23 · Depends on: M0–M6α (all on `main`, 115 commits / 156 tests)

## v2 must-fixes (Codex plan review)
- **MF1 (BLOCKER) default regression**: no existing test pins `checkClaim`'s default trace shape, so "byte-identical"
  is unguarded. Add a regression: with `maxCandidates=1` (default), exactly **one** `judge_cited`, unchanged
  event order, unchanged `quote`/`locator`. Compare traces **excluding the dynamic `ts`** (trace.ts:17,49).
- **MF2 (BLOCKER) all-unclear locator**: when every examined candidate is `unclear`, return the **top (rank-0)**
  candidate's `locator`/`quote` ("best available evidence"), NOT the last low-ranked one. Test it.
- **MF3 (BLOCKER) Q5 honesty + negative-control**: with a noisy judge, stop-on-first-decisive can flip a correct
  `unclear`→wrong decisive → **macro-F1 / answer_groundedness DOWN**. The agentic ablation row is a **diagnostic /
  risk probe, NOT a presumed gain** — say so in the label/UI. Add a negative-control test: an `unclear` claim whose
  lower candidate is (wrongly) judged `supports` ⇒ assert the agentic mode flips it (documenting the failure mode),
  so the over-commitment is a *tested, known* behavior, not a silent regression.
- **MF4 (WARN) candidate rank in trace**: each per-candidate `judge_cited` records that candidate's rank/score via
  the existing `retrieval` field (reuse it; no new event type) so "which candidate / which iteration" is explicit.
- **MF5 (WARN) ablation test sync**: adding a `hash+mock+agentic` worker variant breaks the exact rows/skipped
  assertions at `tests/coevo.ablation.test.ts:56-60` — update them.
- **NIT**: normalize `maxCandidates` to a positive int, cap to `min(maxCandidates, k, inSrc.length)`.

## Why
The single most on-message capability for a DeepSeek **Agent Harness** role is a real **agent loop**:
act → observe → decide → act, with a stopping criterion and observable steps. Today `checkClaim`
([check.ts:53](../../src/check/check.ts)) is **single-shot**: it retrieves top-k within the cited source but
**judges only `inSrc[0]`**; if that snippet is inconclusive it returns `unclear` and stops. The agent-loop
upgrade: **when the top evidence is inconclusive, examine the next-ranked candidates before concluding** —
a bounded retrieve→judge→decide loop. Each judged candidate is a trace step (observable multi-step agent
behavior, §10). It plugs into the M5d-B ablation + M6α `answer_groundedness` so the gain is **measurable**
(single-shot vs agentic).

**Additive + backward-compatible:** the loop is opt-in via a budget that defaults to current behavior.

## T1 — opt-in iterative cited-support loop in `checkClaim`
Add an options arg: `checkClaim(input, retriever, judge, k = 3, opts?: { maxCandidates?: number })`.
- `maxCandidates` defaults to **1** ⇒ byte-identical to today (judges `inSrc[0]` only). **No caller breaks.**
- When `maxCandidates > 1`: retrieve top-`k` within the cited source, then **iterate candidates in rank order**:
  judge `inSrc[0]`; if the verdict is **`unclear`** and candidates remain (and `< maxCandidates` examined),
  judge `inSrc[1]`, `inSrc[2]`, … **Stop on the first decisive verdict** (`supports`/`weakly_supports`/
  `unsupported`/`contradicts`) or when candidates/budget are exhausted.
- The returned `cited_source_support` comes from **the candidate that produced the chosen decisive verdict**;
  if every examined candidate is `unclear`, return the **top (rank-0) candidate's** verdict/locator/quote
  (best available evidence — MF2), not the last low-ranked one.
- **Pure, testable loop-control** `decideStep(verdict, examined, available, maxCandidates): "stop" | "next"`:
  `stop` iff verdict ≠ `unclear`, or `examined >= maxCandidates`, or no candidate left; else `next`.
- **Trace**: emit a `judge_cited` step **per examined candidate** (with its snippet) so an `unclear` claim shows
  N steps — the loop is visible in the §10 trace. Keep the existing event types.

## T2 — make it measurable (eval + ablation exposure)
- `runEval` ([runner.ts:22](../../src/eval/runner.ts)) gains an optional `maxCandidates` that it threads into
  `checkClaim`. Default 1 ⇒ existing eval numbers unchanged.
- `AblationVariant` ([ablation.ts:7](../../src/coevo/ablation.ts)) gains optional `maxCandidates`; `runAblation`
  passes it to `runEval`. Add a default **agentic variant** in the worker `defaultAblationVariants`
  ([worker-runtime.ts](../../src/app/worker-runtime.ts)) — e.g. `hash+mock` (single-shot) vs
  `hash+mock+agentic` (maxCandidates=3) — so the ablation table shows the macro-F1 / `answer_groundedness`
  delta from iterating. Offline, deterministic.

## TDD (offline, deterministic)
- `tests/check.agent-loop.test.ts`:
  - **pure** `decideStep` over the cases (decisive→stop, unclear+budget→next, unclear+exhausted→stop).
  - **integration with a scripted judge** (a stub `Judge` returning `unclear` for snippet A then `supports` for
    snippet B): a claim whose `inSrc[0]` is judged `unclear` but `inSrc[1]` `supports` ⇒ with `maxCandidates=1`
    the result is `unclear`; with `maxCandidates=3` the result is `supports` and the quote is snippet B.
    Asserts the loop **changes the outcome** + the trace has **≥2 `judge_cited` steps**.
  - **all-unclear** case ⇒ multi-step trace, final `unclear`, ≤ maxCandidates steps.
- **Regression**: with `maxCandidates=1` (default), `checkClaim` output + traces are identical to today; the full
  existing suite stays green (no caller passes opts).
- `tests/coevo.ablation.test.ts`: an agentic variant runs offline and yields a row (numbers deterministic).

## Cross-cutting invariants
- **Additive/back-compat**: default `maxCandidates=1` preserves current behavior exactly. No model, no network.
- **Iron rule**: all logic in `src/`; no electron import. Determinism: pure loop-control + stub-judge tests.
- **Snippet-only**: the loop still judges one snippet at a time (no concatenation); context discipline unchanged.
- **Reporting-only**: ablation stays seed/no-threshold; honest "not a benchmark" framing.

## Open questions for Codex review
1. **Stop condition** — treat only `unclear` as "keep looking", or also low-confidence `weakly_supports`
   (e.g. `confidence < τ`)? I lean **`unclear`-only** (simplest, deterministic; confidence thresholds invite tuning).
2. **Candidate scope** — iterate only the already-retrieved top-`k` (proposed), or also **deepen** (increase `k`,
   re-retrieve) when the first `k` are exhausted? I lean candidate-iteration only for M6β; deepen = later.
3. **Counter-evidence path (b)** — leave single-pass as-is (it already judges all `cross` candidates), or also
   loop? I lean **leave as-is** (it's already exhaustive over `cross`).
4. **Default agentic in the app** — keep the Audit hero single-shot (fast) and expose agentic only via the
   ablation/eval, or add an Audit toggle? I lean **ablation/eval only** for M6β (keep the hero snappy).
5. Any concern that iterating could **lower** macro-F1 (a later candidate flips a correct `unclear` to a wrong
   decisive)? The stop-on-first-decisive could over-commit — is the gold's `unclear` set a regression risk?

## Order
T1 (loop + pure control + traces) → T2 (eval/ablation thread + agentic variant) → post-merge Codex 互评.
