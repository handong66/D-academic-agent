# M6γ GOAL — plan → retrieve → check: a grounded evidence map (Planning + Multi-Agent)

Status: v2 (Codex-reviewed → CONDITIONAL GO, 4 must-fixes applied) · Date: 2026-06-23 · Depends on: M0–M6β (all on `main`, 118 commits / 161 tests)

## v2 must-fixes (Codex plan review)
- **MF1 (BLOCKER) — demo judge**: `MockJudge` (`judge.ts:23-29`) is lexical-overlap and **never emits `contradicts`**;
  it judges even Odgers/Orben (semantic disagreement) as `supports` (≥3 word overlap). So the supporting/contradicting
  **split only appears with a contradiction-capable judge (NLI / scripted)**. The deterministic demo test uses a
  **scripted judge** (returns `contradicts` for the odgers/orben snippets) to assert the split is *captured*; with
  MockJudge, assert only **structural invariants** (deterministic findings, trace event types/counts, budget, summary
  shapes). Honest framing in the deliverable: the evidence map's quality is **judge-dependent** — a lexical judge
  cannot surface contradiction (same lesson as M6β).
- **MF2 (BLOCKER) — judge budget**: `runPlan` budgets *retrieval* only; judging every deduped evidence is unbounded.
  Add an explicit `judgeBudget` (default 6) — judge `evidence.slice(0, judgeBudget)` in deterministic retrieval order.
- **MF3 (BLOCKER) — worker wiring**: `ToolContext` has no `planner` (`tools.ts:11-18`) and `protocol.ts` has no
  `plan_and_check` type. Add `planner: Planner` to `ToolContext` **defaulting to `new MockPlanner()`** (existing
  callers stay deterministic) + a `plan_and_check` worker message → `runPlanAndCheck(ctx.retriever, ctx.planner, ctx.judge, thesis, opts)`.
- **MF4 (must-fix) — refactor guard**: BEFORE extracting `judgeRelations`, add regression tests pinning
  `checkClaim`'s counter block: `judge_counter` event-type **sequence** + exact counter-item shape
  (`tests/check.check.test.ts` currently pins only loose behavior). Then refactor behavior-preserving.
- **NIT (known limitation)**: the shared relation mapping (`check.ts:122`) maps `weakly_supports`→`unrelated`. Keep
  it (changing it would alter `checkClaim`'s counter behavior); note that M6γ summaries may undercount weak support.

## Why
The planner (§7, M2) decomposes a question into subqueries and **retrieves** evidence
([orchestrate.ts:9](../../src/plan/orchestrate.ts)) — but it **never judges** what it gathers. That leaves the
harness's headline pipeline — spec §17 "**Agent Loop: plan→retrieve→judge→report**" — only half-built. M6γ
closes it: a **planner subagent** decomposes a thesis, the **checker/judge subagent** assesses each gathered
piece of evidence against the thesis, and the output is a **structured evidence map** — which sources *support*
vs *contradict* the thesis, each with a locator. This is the evidence-grounded literature-review hero output,
and it **demonstrates on this corpus** because the 6 seed sources genuinely disagree (Twenge/Keles support;
Odgers/Orben weak/contradict). Multi-agent (planner + judge) + planning + grounded synthesis, in one pipeline.

**Within §18 non-goals:** the output is a **structured map** (relation + locator per source), NOT generated
prose ("一键成文" stays excluded). No new model; reuses the existing judge (mock / NLI / Ollama / cloud).

## Input is a declarative thesis (not an interrogative question)
The judge scores `{claim, snippet}` entailment, so M6γ takes a **declarative thesis** to investigate
(e.g. "Social media use is associated with adolescent depression"), plans subqueries off it for broad
retrieval, then judges each evidence **against the thesis as the claim**. (A question can be accepted but is
treated as the thesis text; declarative is the contract.)

## T1 — shared relation-judging helper (DRY with checkClaim)
`checkClaim`'s counter-evidence block already judges a list of hits into `{relation: contradicts|supports|unrelated}`
items ([check.ts:114-123](../../src/check/check.ts)). Extract a pure-ish helper
`judgeRelations(judge, claim, hits, tracer?) → CounterItem[]` and have **both** `checkClaim` (block b) and M6γ
reuse it. **Refactor must be behavior-preserving** — `checkClaim`'s output + traces unchanged (regression-pinned).

## T2 — `runPlanAndCheck` orchestrator
`src/plan/orchestrate.ts`: add
`runPlanAndCheck(retriever, planner, judge, thesis, opts?: { k?; budget? }) → PlanCheckResult`:
1. `runPlan(retriever, planner, thesis, opts)` → `{ plan, evidence, traces }` (reuse as-is for decompose + retrieve).
2. Judge **each unique evidence** against `thesis` (via `judgeRelations`, or one judge call per evidence) →
   `findings: PlanFinding[]` where `PlanFinding = { source_id, subquery, locator, snippet, relation, reason }`.
3. `summary = { supporting_sources: string[], contradicting_sources: string[] }` (dedup source ids by relation;
   a source can appear in both if different chunks disagree — keep honest).
4. Emit a `plan_judge` trace event per evidence (reuse the existing `TraceEvent` shape; outbound_snippets recorded).
- Returns `{ thesis, subqueries, findings, summary, traces }`. **Deterministic** with MockPlanner + MockJudge.

## T3 — expose + measure
- **Worker**: a `plan_and_check` message in `worker-runtime.ts` (it owns ctx with retriever+judge) → returns the
  map. Secrets via the `redactSecrets` boundary. (App tab optional / later — not in M6γ.)
- **Eval/demo**: a deterministic test that runs `runPlanAndCheck` on a seed thesis and asserts the support/
  contradict split is non-trivial (e.g. Twenge in supporting, Odgers in contradicting) — proving the map captures
  the corpus disagreement. (Reporting-only; not a gold-scored benchmark.)

## TDD (offline, deterministic)
- `tests/plan.plan-and-check.test.ts`: MockPlanner + a scripted/Mock judge over the seed corpus → assert
  `findings` cover multiple sources, `summary.supporting_sources`/`contradicting_sources` are populated and
  disjoint-where-expected, and the trace has `planner_plan` + `plan_retrieve` + `plan_judge` events (multi-stage).
- `tests/check.check.test.ts` (regression): after the T1 refactor, `checkClaim`'s `corpus_counterevidence`
  items + traces are unchanged.
- Worker test: `plan_and_check` returns the structured map; offline; no secret echo.

## Cross-cutting invariants
- **Behavior-preserving refactor**: T1 must not change `checkClaim` output/traces (existing suite green).
- **Iron rule**: all logic in `src/`; only the (optional, deferred) app tab would touch `electron/`.
- **Snippet-only**: judge one snippet at a time; no concatenation. Determinism: MockPlanner/MockJudge, no network.
- **Non-goals**: structured map only — no prose synthesis. Reporting-only framing.

## Open questions for Codex review
1. **Thesis-as-claim** — judge each evidence against the thesis text directly (proposed), or also judge against
   each *subquery*? I lean thesis-only (subqueries are retrieval aids, not claims).
2. **`judgeRelations` extraction** — is block (b) of `checkClaim` cleanly extractable without changing its trace
   event order/shape? Flag any coupling.
3. **`summary` semantics** — a source in both supporting & contradicting (different chunks) — keep both (honest
   disagreement) or pick the dominant? I lean keep-both + note it.
4. **Judge cost** — judging every unique evidence could be many calls; cap via `budget`/top-N per subquery?
5. **Compose with M6β** — should the per-evidence judging use the agentic loop, or is single-judge-per-evidence
   right here (the loop is per-claim, this is per-evidence)? I lean single-judge-per-evidence.

## Order
T1 (extract `judgeRelations`, behavior-preserving) → T2 (`runPlanAndCheck`) → T3 (worker + demo test) → 互评.
