# M6ε GOAL — thesis consensus verdict (the "report" capstone of plan→retrieve→judge→report)

Status: v2 (Codex-reviewed → CONDITIONAL GO, 4 must-fixes applied) · Date: 2026-06-23 · Depends on: M0–M6δ (all on `main`, 124 commits / 173 tests)

## v2 must-fixes (Codex plan review)
- **MF1 (BLOCKER) — don't hardcode a seed verdict; the demo was fragile.** `JudgeInput` has no `source_id`, so a
  judge can't be scripted per-source, and the seed's real split is *not* a clean "3-vs-2" (riehm also supports;
  primack is a different domain — young adults / social isolation, not adolescent depression). So **T3 asserts the
  end-to-end verdict is SELF-CONSISTENT with its own findings counts** (e.g. recompute S/C from the returned
  `findings` and assert `thesis_verdict` matches the formula) — robust regardless of what the judge produces. The
  **CONTESTED semantics are proven in T1** on deterministic synthetic findings (a clean 3-vs-2 → `contested`).
- **MF2 (must-fix) — per-source dominant from `findings`, NOT the M6γ `summary`** (which already lets a source
  appear on both sides). Re-aggregate `findings` by `source_id`.
- **MF3 (WARN) — protocol must actually return `thesis_verdict`**: extend the `PlanCheckResponse` `Pick` AND add
  `thesis_verdict` to the runtime response object (`protocol.ts:212-219`); the worker `plan_and_check` test asserts
  its presence (currently no exact-shape assertion would catch a drop).
- **MF4 (NITs) — naming**: rename `confidence` → **`decisiveness`** (avoid clash with the judge-level `confidence`);
  `ThesisVerdict` as a **const-union** (like `VERDICTS`), in `src/plan/synthesize.ts` (NOT `src/types.ts`, to stay
  out of the AGENTS doc-sync scope).
- Honest seed framing: the corpus leans support-with-dissent (~3 support: twenge/keles/riehm; ~2 contradict:
  odgers/orben; primack ≈ unrelated/different-domain). The verdict is judge-dependent (a lexical judge can't emit
  `contradicts` → everything looks `supported`) — same M6β/γ caveat.

## Why
M6γ produces a grounded **evidence map** (which sources support vs contradict a thesis) but stops there — the
spec §17 pipeline is plan→retrieve→judge→**report**, and "report" is missing. M6ε adds the **synthesis capstone**:
collapse the map into a single **calibrated thesis verdict** that *accounts for corpus disagreement* —
**supported / contested / refuted / insufficient** — which is the literature-review product's headline value
("is this claim settled in the literature?"). It is **demonstrable on the seed**: the disagreeing corpus
(Twenge/Keles/Primack support; Odgers/Orben contradict) ⇒ a 3-vs-2 split ⇒ **CONTESTED**, the honest conclusion.

**Within §18 non-goals**: a **structured verdict** (enum + counts + confidence), NOT generated prose. Deterministic,
no model (operates on M6γ's already-judged findings). Pure function ⇒ fully TDD-able.

## What it computes — `src/plan/synthesize.ts`
`synthesizeThesisVerdict(findings: PlanFinding[]) → ThesisVerdict` (pure):
- **Per-source dominant relation** (a source may have several findings): for each `source_id`, count its `supports`
  vs `contradicts` findings → net **supporting** (supports > contradicts), **contradicting** (contradicts > supports),
  or **mixed** (equal and > 0). `unrelated`-only sources are not counted as evidence.
- `S = #supporting sources`, `C = #contradicting sources`, `M = #mixed sources`.
- **`consensus`** = `(S + C) > 0 ? S / (S + C) : (M > 0 ? 0.5 : 0)` (mixed-only ⇒ maximally split = 0.5).
- **`verdict`**: `S + C + M === 0` → **`insufficient`**; else `consensus ≥ 0.67` → **`supported`**,
  `consensus ≤ 0.33` → **`refuted`**, otherwise → **`contested`** (mixed sources fall here).
- **`confidence`** (0..1): decisiveness of the split = `(S + C) === 0 ? 0 : Math.abs(consensus - 0.5) * 2`
  (0 = perfectly split/contested, 1 = unanimous). Reporting-only — NOT a pass/fail gate.
- Return `{ verdict, consensus, confidence, supporting: S, contradicting: C, mixed: M }`.
- **Naming**: `supported|contested|refuted|insufficient` — deliberately distinct from the claim-level `Verdict`
  enum (`supports|weakly_supports|unsupported|contradicts|unclear`) to avoid confusion.

## T1 — the pure synthesizer (TDD core)
`src/plan/synthesize.ts` + `tests/plan.synthesize.test.ts`: synthetic findings covering all 5 outcomes —
unanimous support → `supported`; unanimous contradict → `refuted`; 3-vs-2 → `contested`; a source with mixed
findings → counted mixed (contested-leaning); empty/all-`unrelated` → `insufficient`. Assert exact
`verdict`/`consensus`/counts.

## T2 — wire into the map + the worker
- `PlanCheckResult` ([orchestrate.ts:19](../../src/plan/orchestrate.ts)) gains `thesis_verdict: ThesisVerdict`;
  `runPlanAndCheck` computes it from `findings` (after the judge loop). Additive.
- `PlanCheckResponse` ([protocol.ts:65](../../src/app/protocol.ts)) — extend the `Pick` to include `thesis_verdict`
  so the worker `plan_and_check` reply carries it.
- (App tab still deferred — not in M6ε.)

## T3 — demonstrate the corpus disagreement
`tests/plan.plan-and-check.test.ts` (extend): with the contradiction-capable **scripted judge** on the seed thesis
"social media use is associated with adolescent depression", assert `thesis_verdict.verdict === "contested"`
and `supporting >= 3 && contradicting >= 2` — proving the synthesis captures the real split. (With MockJudge,
structural only — it can't emit `contradicts`, same M6β/γ lesson.)

## Cross-cutting invariants
- **Pure / deterministic**: no model, no network, no clock. Additive to `PlanCheckResult` (no exact-shape break).
- **Iron rule**: all in `src/`; no electron import. **Reporting-only**: the verdict is a *summary*, no pass/fail gate.
- **Non-goals**: structured verdict only — no prose. Honest framing: the verdict is only as good as the judge
  (a lexical judge can't detect contradiction ⇒ everything looks `supported`; surface this caveat).

## Open questions for Codex review
1. **Thresholds 0.67 / 0.33** — reasonable reporting-only consensus bands, or different (e.g. 0.6/0.4)?
2. **Per-source dominant relation** (proposed) vs counting raw findings, or vs the M6γ `summary` arrays (which
   already allow a source in both)? I lean per-source dominant (one vote per source).
3. **`confidence` formula** — `|consensus−0.5|*2` (decisiveness) — sensible, or factor in evidence *volume* too
   (few sources ⇒ lower confidence even if unanimous)?
4. **mixed-only corpus** (`S=C=0, M>0`) → `contested` with consensus 0.5 — agree, or `insufficient`?
5. **Naming** — `supported/contested/refuted/insufficient` distinct from `Verdict` — OK?

## Order
T1 (pure synthesizer + tests) → T2 (wire into PlanCheckResult + worker) → T3 (seed-disagreement demo) → 互评.
