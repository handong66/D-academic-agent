# Milestone G — Bibliography reference health (check a paper's CITED references against scite)

**Goal:** for a GROBID-imported paper, check the papers it CITES (its bibliography) against scite and flag which
references are retracted / disputed — "are the papers cited *inside this paper* safe?" Extends F (which checks each
library paper's OWN health) to the references *within* a paper.

**User-chosen (2026-06-27):** "① 参考文献级健康 … GROBID 结构化 refs" — explicitly the GROBID structured-reference path.

## Grounded facts (verified in code, 2026-06-27)

- **GROBID already extracts references** into `citation_metadata.raw.references` as `{title?,author?,year?}`
  (`grobid.ts:158-159,172`) — but **no DOI**. `biblDoi(value)` (added in F1, `grobid.ts:74`) recursively finds an
  `idno[@type=DOI]` and is **reusable per reference biblStruct**. So G1 = add `doi: biblDoi(ref)` to each reference.
- **References are NOT reachable by the renderer today.** The source summary returns `{id,title,year,type,doi}`
  (`protocol.ts:274-279`); the only per-source fetch is `get_source_text` (fulltext, `protocol.ts:239`). So G needs a
  new `get_source_references(sourceId)` path. The worker has the full `ctx.sources` (with `citation_metadata.raw`).
- **The health check is REUSED from F2** — `library_reference_health(dois)` (`worker-runtime.handleLine`) +
  `referenceHealth` (provider-factory: aggregateTallies + getPaper → `buildReferenceSignal`). G adds **no new network
  capability**; it calls the existing worker message with a paper's *reference* DOIs. Badge UI reuses E/F's
  `referenceRiskTone`/styling.
- **`SourceViewer`** (`electron/renderer/SourceViewer.tsx`) is a reusable overlay (sourceId + range + onClose, opened
  from App/Review/WritingDesk) — the model for G's references overlay.
- **Hard limitation (honest):** references exist ONLY for GROBID-imported papers (the default **unpdf path yields no
  references**), and GROBID's per-reference `idno` is **spotty** — many references have no DOI → unverifiable. The UI
  must state this and degrade gracefully (no references → a clear "GROBID import needed" empty state; reference without
  a DOI → "no DOI", not an error).

## Tasks (TDD; Codex implements, Claude verifies + commits)

- **G1 — reference DOIs + a renderer data path** (`src/library/grobid.ts` + `src/app/protocol.ts` +
  `src/app/worker-runtime.ts` + `electron/preload.ts` + `electron/renderer/api.d.ts`):
  - `grobid.ts`: `type Reference` gains `doi?`; the reference map sets `doi: biblDoi(ref)` (only when found). Existing
    title/author/year behavior unchanged.
  - **🟡#1 reference count on the summary (must-fix):** add `referenceCount?: number` to the source summary (thread it
    through listSources/protocol summary/import-response/preload/api.d.ts, exactly alongside F1's `doi`) =
    `citation_metadata.raw.references?.length`. The Library row shows the "N references" affordance ONLY when
    `referenceCount > 0` — no per-row references fetch until the overlay opens (avoids the `library.ts:128` summary
    stripping references).
  - New worker message `get_source_references {sourceId}` → `source_references {sourceId, references: Reference[]}` —
    reads `ctx.sources.find(id)?.citation_metadata.raw.references` (typed/validated; missing → `[]`). Offline, no network.
  - preload `getSourceReferences(sourceId)` + `api.d.ts` `HarnessReference`/`getSourceReferences`.
  - Tests: a GROBID TEI fixture whose references carry `<idno type="DOI">` → `references[i].doi` captured; a reference
    without an idno → `doi` absent; `get_source_references` round-trip via the worker (handleLine), missing source → `[]`.

- **G2 — references-with-health UI** (`electron/renderer/tabs/Library.tsx` + a small `ReferencesPanel` (new or inline)
  + `i18n.dict.ts`):
  - A per-row **"references"** affordance in the Library table (e.g. a "N references" button), shown only for papers that
    HAVE references (others omit it). Clicking it opens a **references overlay** (model: `SourceViewer`) listing each
    reference (title · author · year · DOI when present).
  - In the overlay, a **"Check reference health"** button (shown only when scite is connected) → collect the references'
    DOIs → `window.harness.libraryReferenceHealth(dois)` (REUSE F's IPC) → render a per-reference risk badge + retraction
    marker + the checked DOI (reuse E/F's `referenceRiskTone`/badge). References without a DOI → "no DOI". The
    opt-in note ("sends these DOIs to scite") + the GROBID-only empty state. Bilingual EN + reviewed ZH.
  - **🟡#2 disclosure (must-fix):** the overlay states **"checked {N} of {total} references"** (N = references that have
    a DOI); if those DOIs exceed F2's 100-cap, add **"first 100 checked"**. So the user never assumes full coverage —
    GROBID-spotty DOIs + the truncation are both visible.
  - Playwright: screenshot the overlay with a few references (one retracted) via the main-process IPC override (EN+ZH).

## Red lines

- `src/**` never imports `electron/**`. **No new network capability** — G reuses F2's `library_reference_health`
  (opt-in, DOIs-only, never draft/corpus/library text). Reference DOI extraction is **fully offline** (TEI). Secret
  model unchanged; renderer never sees creds.
- **Honest gating:** GROBID-only references + spotty reference DOIs → the UI never implies completeness; "no references"
  and "no DOI" are first-class states, not errors. Best-effort — a mis-parsed reference DOI → that reference's scite
  health (and the checked DOI is shown), never a fabricated claim about the paper.
- Reuse F2's `referenceHealth` exactly (cap 100, concurrency-limited, `buildReferenceSignal`) — no second network path.

## Resolutions (Codex 2026-06-27 review — CONDITIONAL GO, must-fixes folded)

1. **UI = references overlay** (SourceViewer model) from a per-row button. Confirmed.
2. **`get_source_references` reads `ctx.sources` (🟢)** — correct: a nonempty library `loadAll()`s into `makeToolContext`
   (`worker-runtime.ts:167`) and rows deserialize full `citation_metadata` (`library.ts:114`); no active-corpus gap.
3. **Honest count disclosure (🟡#2 must-fix):** overlay shows "checked {N with DOI} of {total} references".
4. **First-100 truncation disclosed (🟡#2 must-fix):** runtime slices to 100 (`worker-runtime.ts:271`) — UI says "first 100".
5. **Reference-count affordance (🟡#1 must-fix):** add `referenceCount?` to the summary so rows show "N references" only
   when present, without a per-row references fetch.
6. **Coherent + red lines preserved (🟢):** reuses F2's `library_reference_health` (no new network), offline DOI
   extraction, secret model intact; GROBID-only gating is honest. No 🔴.
