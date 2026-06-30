# Milestone A — Writing Desk (local) MVP

> Status: implementation plan (TDD-shaped, task-sequenced). **Codex-reviewed 2026-06-27 (CONDITIONAL GO → all findings folded in below).**
> Derives from `2026-06-26-writing-desk-and-external-research-integrations.md` §5–6 (Phase 1), §10 (Milestone A).
> Date: 2026-06-27.

## Goal

Make the app materially more useful for *writing* a literature review — offline when the configured judge is
local — by turning a pasted paragraph into a **typed claim map** with grounded evidence and a **conservative,
rule-based rewrite**, without changing the existing Check-Draft (audit) or Check-Claim (review) features.

## Non-goals (Milestone A)

- No external research providers (scite/Consensus) and **no new network of any kind**. That is Milestone B+.
- No LLM/generative prose. Offline rewrite is **rule-based hedging**, not model-written text.
- No new judge. Writing Desk reuses the **already-configured** judge exactly as audit/review do — so it adds no
  *new* network; it is *fully* offline only when that judge is local (mock/NLI/Ollama). A configured cloud judge
  makes the same call audit/review already make. The UI labels this (🔴#3).
- Do not modify the existing audit/review pipelines or their outputs (byte-stable, regression-pinned).

## How Writing Desk differs from the existing tabs

| Tab | Unit | Question it answers |
|---|---|---|
| Check Draft (audit) | sentence | "Does each *cited* sentence's citation hold up?" |
| Check Claim (review) | one thesis | "Where does my whole library stand on this one claim?" |
| **Writing Desk (new)** | **paragraph → claims** | "Per claim: is it supported / uncited / overclaimed, and how do I soften it?" |

Writing Desk is the only surface that (a) segments a paragraph into typed claims incl. **uncited** ones, and
(b) proposes an evidence-linked rewrite. **The risk is UI copy, not logic (Q7):** the tab must lead with
"Find uncited claims and get safer wording" — not reuse the audit "paste your paragraph" metaphor — or users
won't see the difference.

## Offline mechanisms — pinned deterministic approaches

- **Claim segmentation:** reuse `src/draft/sentences.ts#splitSentences`; a "claim" = a sentence carrying a factual
  assertion (filter pure transitions/questions via a small heuristic). Deterministic.
- **Claim-type detection:** deterministic lexical heuristic over cue words (`causal`: cause/lead to/result in/because/
  due to; `comparison`: more/less/higher/than; `association`: associated/linked/correlated/related; else
  `background`/`definition`/`method`/`limitation`). Honest: a crude classifier — labelled as heuristic in UI + code.
- **Missing-citation detection:** factual claim with **no usable inline citation** (reuse `src/draft/mentions.ts#extractMentions`) ⇒ `needs_citation`.
- **Overclaim detection (🔴#1 — the judge exposes no support-strength):** the judge returns only
  `verdict/reason/confidence/suggested_rewrite`, so "association-grade" must be *derived*. Run the **same claim-type
  cue heuristic over the evidence quote at `CheckResult.cited_source_support.quote`** (verdict is
  `cited_source_support.verdict`); flag `overclaimed` only when a `causal` claim is
  `supports`/`weakly_supports`-ed solely by `association`-typed evidence (no causal-typed support). Surfaced as a
  **heuristic risk annotation, not a verdict** (it will over-flag causal RCT evidence written associationally —
  accepted for the MVP, labelled as such).
- **Safer rewrite (🟡#6 — guard against ungrammatical edits):** **default to a non-destructive sentence wrapper** —
  `weakly_supported`/`overclaimed` → "Some evidence suggests that [original claim]"; `needs_citation` →
  "[original claim] (citation needed)". Cue-word replacement ("causes"→"is associated with") applies **only** when a
  tested regex confirms the cue is a top-level predicate (not in negation/subordinate clause/quotation); on no
  confident match, emit a **risk annotation instead of a fake-polished rewrite**. Always linked to the motivating
  evidence quote. No free-text generation.
- **Paper Snapshot (🔴#4 — `ToolContext` exposes no `Chunk[]`, only `texts: Map`):** Milestone A reads the source's
  full stored text via **`ctx.texts.get(sourceId)`** and runs an extractive **heading-regex** (Methods/Results/
  Limitations…), verbatim, never summarized. Heading-less papers (the toy corpus, all `section:"body"`) yield a
  sparse snapshot — labelled as such. The richer `Chunk.section`-structured snapshot needs a new
  `retriever.chunksBySource()` accessor and is an **A4-follow-up**, not this milestone.

## Reuse map — grounded against actual modules

- `src/draft/sentences.ts#splitSentences(text)→DraftSentence[]` + `src/draft/mentions.ts#extractMentions(text,offset)→Mention[]` — segmentation + inline-citation detection.
- `src/draft/audit.ts#auditDraft` is the **pattern to mirror** (splitSentences → extractMentions → resolve cited source → `checkClaim`). Writing Desk reuses the first three; checkClaim usage differs (below).
- `src/check/check.ts#checkClaim({claim, cited_source}, retriever, judge, k=3, opts?)` → `CheckResult` = `{cited_source_support: {verdict, quote, locator, reason, confidence}, corpus_counterevidence, traces}` — judges a claim **against a specific cited source** (the cited evidence quote is **`cited_source_support.quote`**, verdict `cited_source_support.verdict`). It *requires* a `cited_source` (fits **cited** claims). **Uncited / unresolved-citation** claims use a **new** `judgeClaimAgainstLibrary` helper (retrieve top-k for the claim text + judge directly) that returns a **comparable `{verdict, quote, locator}`** so status/overclaim logic reads the evidence quote uniformly — Codex Q2: keep it separate, do **not** make `checkClaim`'s `cited_source` optional (would blur Check-Claim semantics + risk double-judging).
- `Chunk` is at **`src/retrieve/types.ts`** (🟢#8 — not `src/types.ts`); its `section` field is for the *follow-up* structured snapshot only. Milestone A's snapshot uses `ctx.texts`.
- `src/providers/*` retriever/judge via `ToolContext` (`{sources, texts: Map, retriever, judge, …}`) — reused as-is.

## Data model

```ts
type WritingClaimType = "background" | "association" | "causal" | "comparison" | "method" | "limitation" | "definition";
type WritingClaimStatus = "supported" | "weakly_supported" | "needs_citation" | "overclaimed" | "contradicted" | "unclear";
```

**Status derivation (pure, tested) — explicit precedence (Q3), first match wins:**
1. **`contradicted`** — any judged evidence (cited or library) returns `contradicts`.
2. **`needs_citation`** — factual claim with **no usable citation**: no inline mention, **or** every mention resolves
   *unresolved/ambiguous* (🔴#2 — never pass an unresolved key to `checkClaim`; flag with a risk note instead).
3. **`overclaimed`** — causal claim supported only by association-typed evidence (heuristic, per above).
4. **`supported` / `weakly_supported`** — `supports` / `weakly_supports`.
5. **`unclear`** — `unclear` or `unsupported`.

Multi-citation claims: judge each resolved cited source, aggregate by the same precedence (any `contradicts` ⇒
contradicted; else best of supports/weakly; else unclear). A claim with ≥1 resolved citation never falls to `needs_citation`.

## Task sequence (TDD, per-task commit)

- **A1 — claim model + segmentation + type heuristic** (`src/writing/claims.ts`, pure): paragraph → `WritingClaim[]`
  (text, sentenceIndex, claimType, citedSources, isFactual). Unit tests incl. causal/association/uncited/non-factual.
- **A2 — status + evidence map** (`src/writing/report.ts`): cited claims via `checkClaim({claim, cited_source})`;
  uncited / unresolved-citation via the **new** `judgeClaimAgainstLibrary` (does **not** refactor `checkClaim`, keeping
  the existing pipeline byte-stable). Apply the precedence rules → `WritingClaim.status` + `localEvidence` +
  `paragraphSummary`. Tests with a scripted judge: contradicted / needs_citation / overclaimed / supported / weakly /
  unclear + multi-citation + unresolved-mention. Pure given injected retriever+judge.
- **A3 — rule-based rewrite** (`src/writing/rewrite.ts`, pure): `(claim, status, evidence) → suggestedRewrite | riskNote`
  via the guarded wrapper/cue templates. Tests assert: never strengthens; wrapper default; cue-replace only on
  confirmed top-level match; annotation-on-no-match.
- **A4 — paper snapshot** (`src/writing/paper-snapshot.ts`, pure): extractive heading-regex over `ctx.texts.get(sourceId)`
  → labelled sections (best-effort; sparse when heading-less). Tests on a headed fixture and a heading-less one.
- **A5a — worker protocol + runtime** (`src/app/protocol.ts` `analyze_paragraph` + `worker-runtime.ts` handler):
  request/response types + dispatch; round-trip unit test.
- **A5b — IPC + renderer tab** (`electron/{main,preload}.ts` + `api.d.ts`; `electron/renderer/tabs/WritingDesk.tsx`):
  typed bridge (no secrets) + the tab (claim map / evidence / rewrite). UI copy leads with "Find uncited claims and get
  safer wording" (Q7); honest-framing nudge + offline badge.
- **A5c — i18n + acceptance** (`i18n.dict.ts` EN+ZH for new strings; extend `scripts/acceptance.mjs` label-agnostically
  to drive the new tab end-to-end).

## Tests

- `tests/writing.claims.test.ts`, `tests/writing.report.test.ts`, `tests/writing.rewrite.test.ts`,
  `tests/writing.paper-snapshot.test.ts` (pure, deterministic, scripted judge where needed).
- `tests/app.writing-protocol.test.ts` (🟡#7): drives the full `worker-runtime.handleLine` → serialized-response path
  with a fixture `analyze_paragraph` message carrying a **mock API key**, asserting redaction; plus audit/review outputs unchanged.

## Red lines

- `src/**` never imports `electron/**` (iron rule).
- **No new network**: Writing Desk adds no provider/HTTP calls of its own; reuses the configured judge (offline when local).
  Existing audit/review outputs **byte-stable** (regression-pinned).
- Honest framing: claim-type + overclaim are heuristic, judge-dependent — labelled in UI + code, never oversold.
- Codex implements per task; Claude runs tests/tsc/lint + commits per task; **fresh-thread Codex review gate** at milestone end.

## Codex review resolutions (2026-06-27)

🔴#1 evidence-type derived from `CheckResult.quote` + overclaim = risk annotation · 🔴#2 unresolved/ambiguous citation →
`needs_citation` branch · 🔴#3 reframed "no *new* network" (configured judge may be remote, as today) · 🔴#4 snapshot via
`ctx.texts` heading-regex, structured version deferred · 🟡#5 A5 split a/b/c · 🟡#6 guarded rewrite (wrapper default) ·
🟡#7 redaction test at `handleLine` · 🟢#8 `Chunk` path `src/retrieve/types.ts` · Q3 precedence + multi-citation · Q7 UI copy lead.
