# Milestone E — Reference health on scite search results

**Goal:** when you search scite (the W4 Library "Search online sources" panel), each result shows its
**reference-health signal** — support/pushback/mention counts, a **risk badge**, and a prominent
**retraction / editorial-notice warning** — so you can see which papers are disputed or retracted *before* citing
them. This is the payoff of the scite integration (scite's whole value is citation analysis).

**User-chosen scope (2026-06-27):** "搜索结果的引用健康" — surface health on **search results**, NOT library papers.

## Grounded facts (verified in code, 2026-06-27)

- **The data already flows.** `mapSearchHitToExternalPaper` (`src/external/providers/scite-rest.ts:402-409`) already
  computes `mapSciteTallyToReferenceSignal(hit.tally)` and `normalizedNotices(hit.editorialNotices)` — but buries both
  in the **untyped `qualitySignals: Record<string, unknown>`**, so the renderer can't read them typed. **⇒ Milestone E
  adds ZERO new network calls** — it re-types + surfaces data the existing search already returns.
- **The risk rule is too thin.** `mapSciteTallyToReferenceSignal` (`scite-rest.ts:354`) emits only `ok` / `needs_care`
  (from `contradicting/considered ≥ 0.2`). The type `ReferenceExternalSignalRisk` already allows `risky` / `blocked` /
  `unknown` but they're never produced; **retraction/editorial notices don't affect risk at all** (the mapper sees only
  the tally, not the notices).
- **Editorial-notice shape** (`SciteEditorialNoticeSchema`, `scite-rest.ts:53`): `{ status?, date?, noticeDoi?, urls? }`,
  `status` e.g. `"retraction_notice"` / `"expression_of_concern"`. Retraction is derivable from `status`.
- **`ReferenceExternalSignal`** (`src/external/types.ts:59`): `{ provider, doi?, supportCount?, pushbackCount?,
  mentionCount?, unclassifiedCount?, citingPublicationCount?, risk }` — no editorial-notice field yet.
- `HarnessExternalPaper` is `import()`'d from the src type (`api.d.ts:194`) → adding a field **auto-syncs** to the
  renderer type; **`PreloadExternalPaper` (`preload.ts:210`) is hand-mirrored** → must add the field there too.
- **Out of scope (needs a prerequisite, deferred to a later milestone):** "library reference health" — `Source`
  (`src/types.ts:6`) has **no DOI**, and the GROBID parser drops DOIs (`grobid.ts:134` keeps only title/author/year),
  so checking *your imported papers'* references needs a DOI-capture pipeline change first. Not in E.
- **Scope framing (review must-fix #6):** E delivers the **search-result slice** of parent §13 reference health, NOT the
  full `external_enrich_doi` / `external_reference_health` deliverables (those need DOIs + a worker enrich path → the
  deferred library milestone). E must not be described as "completing §13 reference health."

## Tasks (TDD; Codex implements, Claude verifies + commits)

- **E1 — retraction-aware reference-health model** (`src/external/types.ts` + `src/external/providers/scite-rest.ts`,
  pure + fixture-tested):
  - Extend `ReferenceExternalSignal` with `editorialNotices?: Array<{ status?: string; date?: string; noticeDoi?: string;
    urls?: string[] }>` and `retracted?: boolean`.
  - New pure `classifyReferenceRisk({ tally?, editorialNotices?, retracted? }) → ReferenceExternalSignalRisk` —
    **risk = the MOST severe of the notice-derived and tally-derived tiers** (severity `blocked > risky > needs_care > ok`):
    - `blocked` — `retracted === true` **or** any notice `status` ~ `/retract/i`.
    - `risky` — any notice `status` ~ `/concern|withdraw/i` **or** `tally` `contradicting/considered ≥ 0.4`.
    - `needs_care` — `tally` `contradicting/considered ≥ 0.2` **OR any other editorial notice present**
      (correction/erratum/unrecognized status → at least `needs_care`: a notice exists, worth a look — **must-fix #3**).
    - `ok` — a `tally` exists, low pushback, and no notice.
    - `unknown` — no `tally` **and** no notices.
    (`considered = max(supporting + contradicting + mentioning, 1)`.)
  - **§7.3 boundary (must-fix #2):** only the `needs_care ≥ 0.2` tier comes from spec §7.3; the `risky`/`blocked`/`0.4`
    tiers + all notice-driven risk are a **product extension beyond §7.3** — E1 tests them explicitly as extensions.
  - **Retraction source:** search hits carry no `retracted` boolean → derive from notice `status`; **prefer
    `ScitePaperResponse.retracted` when `getPaper` data is available** (a future path; not on the E search flow).
  - New `buildReferenceSignal({ tally?, editorialNotices?, retracted?, doi? }) → ReferenceExternalSignal` (counts from
    the tally, `editorialNotices`/`retracted` carried through, `risk` from `classifyReferenceRisk`).
  - Keep `mapSciteTallyToReferenceSignal(tally)` working (delegate to `buildReferenceSignal({ tally })` — tally-only,
    so existing behavior/tests are byte-stable: ok/needs_care, no notices).
  - Tests: the risk matrix (retracted→blocked; concern→risky; 0.4→risky; 0.2→needs_care; clean→ok; nothing→unknown),
    notice carry-through, and the back-compat of the tally-only mapper.

- **E2 — type the signal onto `ExternalPaper` + thread it through** (`types.ts` + `scite-rest.ts` + `electron/preload.ts`
  + `electron/renderer/api.d.ts`):
  - Add `referenceSignal?: ReferenceExternalSignal` to `ExternalPaper`.
  - `mapSearchHitToExternalPaper`: set `referenceSignal: buildReferenceSignal({ tally: hit.tally ?? undefined,
    editorialNotices: normalizedNotices(hit.editorialNotices), doi })` when there's a tally **or** any notice; drop the
    untyped `qualitySignals.tally` / `qualitySignals.editorialNotices` (keep `isOa`/`oaStatus`/`relevancyScore`/`source`).
  - Consensus papers carry no tally → `referenceSignal` stays `undefined` (no health shown — honest).
  - `PreloadExternalPaper`: add the mirrored `referenceSignal?` shape (+ the risk union). `HarnessExternalPaper`
    auto-syncs (import()'d). No provider-factory change (it passes `ExternalPaper` through).
  - Tests: extend `tests/external.provider-factory.test.ts` / `external.scite-rest.test.ts` to assert a scite hit with a
    tally + a retraction notice yields a typed `referenceSignal` with `risk:"blocked"`.

- **E3 — render reference health on the W4 search cards** (`electron/renderer/tabs/Library.tsx` + `i18n.dict.ts` +
  `electron/renderer/lib.ts`):
  - On each search-result card with a `referenceSignal`: a **risk badge** (color-mapped: ok→neutral/green,
    needs_care→amber, risky→orange, blocked→red), a compact **counts line** ("12 supporting · 3 contradicting ·
    40 mentioning"), and a prominent **editorial-notice/retraction warning** when notices exist ("⚠ Retraction notice ·
    2020-01-02"). No badge when `referenceSignal` is absent (Consensus / no data).
  - Pure helpers in `renderer/lib.ts` (`referenceRiskLabelKey(risk)`, `referenceRiskTone(risk)`) — **unit-tested** in
    `renderer.lib.test.ts` (so the logic is verified without creds).
  - Bilingual EN + reviewed ZH for all new strings (risk labels, counts, notice labels).
  - **Pixel verification (no creds):** the Playwright driver injects a fixture search result via the renderer (drive the
    panel's result state, or stub `window.harness.externalSearch` to return a tally+notice fixture) → screenshot the
    badge + retraction warning in EN + ZH. (A real live scite search still needs the user's creds — gated, unchanged.)

## Red lines

- `src/**` never imports `electron/**`. **No new network**: E surfaces data the existing scite search already returns —
  it adds no outbound call, no new egress, no secret-path change. Offline + opt-in guarantees are untouched.
- Back-compat: `mapSciteTallyToReferenceSignal` stays byte-stable for tally-only callers; existing search/audit/review
  paths unchanged. Consensus path unaffected (no tally → no signal).
- The signal is a **candidate quality cue, not a verdict** — the UI frames it as scite's citation analysis, not the
  app's judgment.

## Open questions for the reviewer

1. Risk thresholds (blocked=retracted; risky=concern-notice or contradicting≥0.4; needs_care≥0.2) — reasonable + faithful
   to spec §7.3? Any threshold you'd move?
2. Replace `qualitySignals.tally`/`editorialNotices` with the typed `referenceSignal` (clean), keeping `qualitySignals`
   for `isOa`/`oaStatus`/`relevancyScore` — OK, or keep both for back-compat?
3. E3 pixel verification via a Playwright renderer-state/`externalSearch`-stub injection (since a live search needs creds)
   — acceptable, or prefer a different seam?
4. Is surfacing on search results alone a satisfying E, with "library reference health" (needs DOI capture) as the
   explicit next milestone?
