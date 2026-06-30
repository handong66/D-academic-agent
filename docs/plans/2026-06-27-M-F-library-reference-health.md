# Milestone F — Library reference health (check your imported papers against scite)

**Goal:** for the papers you've imported (your Library — typically the papers you cite), check each against scite and
flag **retracted / disputed** ones, so you don't cite a paper that's been retracted or heavily contradicted. This is
the deferred high-value slice from Milestone E ("查我自己引用的文献有没有被撤稿").

**Prerequisite (the reason E deferred this):** imported papers carry **no DOI** today — so F first captures DOIs.

## Grounded facts (verified in code, 2026-06-27)

- **DOIs are extractable on both import paths:** GROBID TEI has `<idno type="DOI">` in the header `biblStruct` (and per
  reference) but `grobid.ts` keeps only title/author/year; the default **unpdf** path yields chunks with text
  (`import.ts:10` → `parser.parse` → `{source, chunks}`), and a paper's DOI almost always appears in the page-1 text →
  a **regex** recovers it. So F can get the paper's own DOI for BOTH parsers.
- **Storage needs no schema migration:** `Source.citation_metadata` (`src/types.ts:1` `CitationMetadata{bibtex_key, raw?}`)
  is persisted as a JSON column (`library.ts` `citation_metadata TEXT`). Adding `doi?: string` to `CitationMetadata`
  round-trips through the existing column — no SQL change. `listSources()` summary (`library.ts:9`) is
  `{id,title,year,type}` → must add `doi?` to surface it.
- **scite shapes:** `ScitePaperResponse` (`scite-rest.ts`) has `doi` + `editorialNotices` + `retracted` but **NO tally**;
  `getTally(doi)` / `aggregateTallies(dois)` (≤100) give the counts. So full per-paper health = `aggregateTallies`
  (counts, 1 call) **+** `getPaper(doi)` (retraction/notices, 1 call each). E's `buildReferenceSignal({tally, editorialNotices,
  retracted})` already composes them into a `ReferenceExternalSignal`.
- The provider-factory (`src/external/provider-factory.ts`) exposes only `{status, search?}` → F adds a `referenceHealth`
  capability. The worker handles external messages in `worker-runtime.handleLine` (where config+secrets live).
- **Reference DOIs (a paper's bibliography) are GROBID-only** (structured refs) and out of scope — F checks each LIBRARY
  PAPER's own health (if you import the papers you cite, that IS your citation list).

## Tasks (TDD; Codex implements, Claude verifies + commits)

- **F1 — DOI capture on import** (`src/types.ts` + `src/library/grobid.ts` + `src/library/doi.ts` (new) + `src/library/import.ts`,
  pure + tested):
  - Add `doi?: string` to `CitationMetadata`.
  - New pure `extractDoiFromText(text): string | undefined` — standard DOI regex `\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b`
    (case-insensitive), first match in the GIVEN text, strip trailing punctuation. Unit-tested (clean DOI,
    `https://doi.org/…`, `DOI:` prefix, none, trailing-paren/period).
  - **🟡#1 confidence gate (must-fix):** the caller passes only a BOUNDED PREFIX — the **first chunk's text capped at
    ~2000 chars** (≈ page 1), NOT the whole document — so a DOI from the back-matter reference list can't be mis-picked
    as the paper's own. If no DOI in that window → **no DOI** (don't scan further). Extraction is **best-effort**; a
    mis-pick or miss → that paper shows "no DOI" and is skipped, **never a false retraction claim** — and F3 shows the
    exact DOI that was checked so the user can sanity-check it.
  - `grobid.ts`: extract the paper DOI from the header `biblStruct` `idno[@type=DOI]` → set `citation_metadata.doi`.
    **Best-effort + add a TEI test fixture WITH an `<idno type="DOI">`** (the existing `tests/library.grobid.test.ts`
    TEI has none, so the extraction must be covered by a new fixture).
  - `import.ts`: after `parser.parse`, if `source.citation_metadata.doi` is absent, run `extractDoiFromText` on the
    bounded first-chunk prefix and set it. Works for unpdf + GROBID-without-idno. (Zero-chunk + dedup logic unchanged.)
  - **🟡#2 DOI threading (must-fix) — `doi?` must flow through ALL of these, not just storage:** `library.ts`
    `listSources()` summary (`:9`); the worker protocol source summary (`src/app/protocol.ts:98`); the import response
    shape (`worker-runtime.ts:282`); `electron/preload.ts` `PreloadSourceSummary` (`:47`); `electron/renderer/api.d.ts`
    `HarnessSourceSummary` (`:45`). Without all five, the renderer can't read a paper's DOI to call `referenceHealth`.

- **F2 — `referenceHealth` provider capability + worker batch** (`src/external/provider-factory.ts` + `src/app/protocol.ts`
  + `src/app/worker-runtime.ts`, fixture-tested with injected fetch):
  - provider-factory: scite handle gains `referenceHealth(dois: string[]) → Promise<ReferenceExternalSignal[]>` —
    **`aggregateTallies(dois)` chunked ≤100** for counts **+** `getPaper(doi)` per DOI for `editorialNotices`/`retracted`,
    composed via **`buildReferenceSignal({tally, editorialNotices, retracted, doi})`** (E's full composer — NOT
    `mapSciteTallyToReferenceSignal`, which clamps tally-only `risky`→`needs_care` for the legacy search path, 🟢#4).
    **🟡#3 (must-fix): concurrency-limit the `getPaper` fan-out** (a small pool, ≤~5 in flight) + an overall DOI cap (e.g.
    100) so a large library can't burst hundreds of requests. Missing creds → `{connected:false}`/no-fetch (same gate as
    search). Consensus has no equivalent → not offered.
  - protocol + `worker-runtime.handleLine`: `library_reference_health {dois}` → `library_reference_health_result
    {signals: ReferenceExternalSignal[]}` (validate dois are strings; cap the count; only when scite enabled+connected,
    else a clear `{connected:false}`-style result). Redacted at the boundary as usual.
  - Tests: `aggregateTallies`+`getPaper` composition (a retracted paper → `blocked`; a contradicted one → risky/needs_care;
    a clean one → ok); chunking >100; missing-creds → no fetch; a secret in `secrets` never appears in the response line.

- **F3 — main IPC + Library UI** (`electron/main.ts` + `preload.ts` + `api.d.ts` + `electron/renderer/tabs/Library.tsx`
  + `i18n.dict.ts`):
  - IPC: `library_reference_health(dois)` forwarder (mirror `external_search`); typed result.
  - Library tab: a **"Check reference health"** button (shown only when scite is connected — reuse `externalProviderStatus`)
    that gathers the library papers' DOIs, calls `libraryReferenceHealth`, and renders **per-row health** in the existing
    sources table (a risk badge + a retraction/notice warning on rows whose paper is flagged; reuse E's `referenceRiskTone`/
    `ReferenceHealthBlock` styling). Papers with no DOI show "no DOI" (honest). **Each checked row shows the DOI that was
    used** (so a mis-extracted DOI is visible + verifiable — the 🟡#1 honesty mitigation). An **explicit opt-in note**:
    "This sends your library's DOIs to scite." Bilingual.
  - Playwright: screenshot via the main-process `ipcMain` override (live needs creds) — a retracted library row in EN+ZH.

## Red lines

- `src/**` never imports `electron/**`. **New network is opt-in + DOIs-only:** `referenceHealth` runs ONLY on the explicit
  "Check reference health" action when scite is enabled+connected; outbound = the library's DOIs (public paper identifiers),
  **never draft/corpus/library text**; the user is told the DOIs go to scite (informed opt-in). Offline/audit/review/search
  paths unchanged. DOI extraction is **fully offline** (regex / TEI), adds no network.
- Secret model unchanged: creds resolved in main → set_config secrets → worker, redacted at the boundary; renderer never
  sees creds. `referenceHealth` missing creds → graceful `{connected:false}`, no crash.
- The signal is scite's citation analysis (a cue), **not** the app's verdict — same framing as E ("from scite").
- DOI extraction is **best-effort** (regex can miss / mis-pick); a wrong/absent DOI → that paper shows "no DOI"/"unknown",
  never a false retraction claim.

## Resolutions (Codex 2026-06-27 review — CONDITIONAL GO, must-fixes folded)

1. **Network model = capped batch + fan-out (🟢#2, must-fix #3):** `aggregateTallies` (≤100, chunked) + concurrency-limited
   `getPaper` per DOI — NOT aggregate-only-lazy (that would permanently miss retraction, the core goal). Confirmed.
2. **DOI gate = bounded prefix (🟡#1, must-fix #1):** regex only the first chunk / ~2000 chars (not the whole doc) so a
   reference DOI can't be mis-picked; best-effort; mis-pick/miss → "no DOI", never a false claim; F3 shows the checked DOI.
3. **UI = inline per-row** in the existing Library sources table, reusing E's `referenceRiskTone`/styling. Confirmed.
4. **Privacy = informed opt-in note** ("sends your DOIs to scite") is sufficient (DOIs are public paper IDs; no library
   TEXT egresses) — 🟢#3. No per-run modal needed.
5. **Scope coherent (🟡#5):** library papers' OWN health now; bibliography-reference health (GROBID-only structured refs)
   deferred. **Hidden prereq folded → must-fix #2:** thread `doi?` through all 5 summary/IPC shapes (listSources, protocol
   summary, import response, preload, api.d.ts).
6. **Back-compat (🟢#4):** reuse `buildReferenceSignal` (full composer), NOT `mapSciteTallyToReferenceSignal` (legacy
   tally-only clamp); adding `referenceHealth` to the factory leaves `search` untouched.
