# Milestone I — Writing Desk: find external evidence for a claim

**Goal:** in the Writing Desk, for a claim you're drafting (especially one that's `needs_citation` / `weakly_supported`
locally), **find external papers that could support it** — search scite/Consensus for the claim and show the results
with their **reference health** (from E). The last of the user's 3 follow-ups ("③ Writing Desk 深度接外部证据").

## Grounded facts (verified in code, 2026-06-27)

- The Writing Desk `ClaimCard` (`electron/renderer/tabs/WritingDesk.tsx:106-167`) renders per claim: `claim.text`,
  status badge, claimType, citedKeys, `localEvidence`, riskNotes, suggestedRewrite. **No external usage today** — and
  WritingDesk does NOT currently fetch `externalProviderStatus` (Library does). I2 adds the per-claim external action.
- **`window.harness.externalSearch(providerId, query)` already exists** (Wire) and returns `ExternalSearchResult`
  whose `papers` carry the typed `referenceSignal` (E). The external-paper **card + `ReferenceHealthBlock` is rendered
  inline in `Library.tsx`** (~528-560) — extract it into a shared component so WritingDesk reuses it (no duplication;
  mirrors the G2 lib.ts helper lift). `referenceRiskTone`/badge helpers are already shared in `lib.ts`.
- **Egress reality (the crux):** searching for a claim makes the **claim's text (the user's DRAFT sentence) the search
  query** → it leaves the process to the provider. This is a DELIBERATE, scoped change from the prior external-search
  red line ("never draft content"): it's the entire point of "find evidence for this claim." So it must be **opt-in
  per-claim, the query shown + EDITABLE before sending, and clearly disclosed.**
- **Out of scope:** "add this external paper to my library" (external papers have only metadata/DOI, no PDF → a
  different, metadata-only import mechanism) — deferred. I delivers find + display only.

## Tasks (TDD where there's pure logic; UI verified via tsc/build/Playwright)

- **I1 — extract a shared external-results component** (`electron/renderer/ExternalPaperResults.tsx` (new) +
  `electron/renderer/tabs/Library.tsx`):
  - Pull the external-search result rendering (the `papers.map` → paper card: title, authors, year, journal,
    DOI→`doiHref` link, citationCount, provider badge, takeaway/evidence, and the `ReferenceHealthBlock` risk badge +
    counts + retraction marker) out of `Library.tsx` into a reusable `<ExternalPaperResults result={...} t={...} />`
    (props: the `HarnessExternalSearchResult` + the translator). Library renders it (BEHAVIOR-UNCHANGED — the W4/E
    search panel looks/works identically). **Must preserve `paperKey`/`samePaper`/`evidenceForPaper` (the
    match-by-paper-then-index logic) + the result block** (the Library component is named `ReferenceHealth`, not
    `ReferenceHealthBlock`) — the extracted component owns that matching or receives pre-matched evidence. Keep using the
    shared `lib.ts` helpers.
  - Any pure helper moved stays unit-tested (extend `renderer.lib.test.ts` if a helper moves).

- **I2 — per-claim "Find external evidence"** (`electron/renderer/tabs/WritingDesk.tsx` + i18n):
  - WritingDesk fetches `externalProviderStatus()` on mount (like Library) → `connectedExternalProviders`.
  - Each claim component (`ClaimResult`, `WritingDesk.tsx:101`) gets a **"Find external evidence"** button, shown ONLY when a provider is connected. Clicking it
    reveals an **inline, EDITABLE query box pre-filled with `claim.text`** + a provider selector + a **Search** button +
    an explicit disclosure: **"This sends the text below to {provider} as a search query."** (so the user sees + can
    redact the draft text before it egresses — the principled handling of draft egress).
  - Search → `window.harness.externalSearch(providerId, editedQuery)` → render `<ExternalPaperResults>` inline in the
    card (loading/error/empty states). Results are framed as **candidate external evidence (scite/Consensus), not the
    app's verdict** — consistent with E's "from scite" framing.
  - Bilingual EN + reviewed ZH for all new strings. Playwright: screenshot a claim card with the query box + results
    (via the main-process IPC override, since live search needs creds) EN + ZH.

## Red lines

- `src/**` never imports `electron/**` (I is renderer-only + reuses existing IPC; no `src/` change expected).
- **Draft egress is opt-in, visible, and editable:** external evidence-provider search runs ONLY on the explicit
  per-claim "Find external evidence" → Search; the query (the claim text) is shown in an editable box with a clear "this
  sends … to {provider}" disclosure; the user can edit/redact before sending. Outbound = the (possibly-edited) query
  string only — no corpus/library text, no other claims.
- **🟡 must-fix (disclosure precision):** the correct statement is **"no AUTOMATIC external evidence-provider
  (scite/Consensus) search"** — NOT "analyze stays fully local." `analyzeParagraph` already egresses claim+snippet to the
  configured **LLM judge** (`src/check/llm-judge.ts` via `report.ts`) when a cloud/Ollama judge is selected — that is a
  SEPARATE, pre-existing, already-disclosed egress. M-I does not change it; the UI copy must NOT conflate the two paths
  (the new egress is only the explicit per-claim evidence search).
- Opt-in on connectivity: the button shows only when scite/Consensus is connected (reuse `externalProviderStatus`); no
  provider → no button (no dead action). External results are candidates, **not** the app's verdict (reuse E framing).
- I1 is behavior-preserving for Library's existing W4/E search panel (the extraction must not change its render).

## Resolutions (Codex 2026-06-27 review — CONDITIONAL GO, must-fix folded)

1. **🟡 disclosure precision (must-fix):** reworded — "no AUTOMATIC external evidence-provider search" (NOT "analyze stays
   fully local"); the analyze path's LLM-judge egress is a separate, pre-existing, already-disclosed path; the UI copy
   must not conflate them. The new egress is ONLY the explicit per-claim evidence search.
2. **Draft egress = editable pre-filled query + disclosure** (🟡 acceptable as a deliberate scoped relaxation *iff* the
   query box is revealed + editable BEFORE the `externalSearch` call). IPC carries only `providerId + query + opts` (no
   corpus/other claims) — confirmed.
3. **I1 seam confirmed 🟢** (`<ExternalPaperResults result t>`); must preserve `paperKey`/`samePaper`/`evidenceForPaper`
   + the `ReferenceHealth` block; test against Library's W4/E panel for no regression. Names corrected (`ClaimResult`,
   `ReferenceHealth`, `electron/renderer/api.d.ts`).
4. **Provider-status gate 🟢** (WritingDesk fetches its own `externalProviderStatus()` — per-tab local state, like Library
   + Settings; no shared store, no conflict). **Reuse 🟢** (low regression risk; typed externalSearch + referenceSignal).
5. **Scope 🟢:** find + display only; "add to library" (external papers are metadata/DOI, no PDF bytes — a different
   import path) deferred. Render **inline in the claim** (closest to the claim); button on **all factual claims**.
