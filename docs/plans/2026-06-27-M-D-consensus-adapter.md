# Milestone D — Consensus provider adapter (REST quick_search, headless, fixture-tested)

> Status: implementation plan, authored against **D0-captured real contracts**. Builds on Milestone B (types + config + mcp-client). Date: 2026-06-27.

## Goal

Implement the **Consensus REST `quick_search` adapter** — `GET /v1/quick_search` (x-api-key) with zod-validated
parsing + mappers to the normalized `ExternalPaper` / `ExternalEvidenceCard`. Fixture-tested with injected
`fetch` (**no live network by default**); one **env-gated live smoke** exercises the real API.

## D0 — contract capture: DONE ✅

Codex captured the real contracts (fixtures `fixtures/external/consensus/{search.sample.json, quick_search-openapi.md}`). **Decisive findings:**
- **REST `GET /v1/quick_search`** (`x-api-key` header) → `{ results: QueryResult[] }`; each result has **`abstract, authors,
  doi, journal_name, pages, publish_year, title, url, volume, citation_count`** (required) + `study_type`, `takeaway`
  (optional). Query params: `query, year_min, year_max, study_types, human, sample_size_min, sjr_max, duration_min,
  duration_max, exclude_preprints, medical_mode`. **This is the clean, structured source.**
- **MCP `search`** returns `[{type:"text", text:"…rendered markdown…"}]` — **NOT structured JSON** (no per-paper
  fields, no doi). Plus it needs interactive **OAuth-PKCE/DCR** sign-in. → **low structured value + interactive auth.**

## Non-goals (Milestone D) — deferred (reality-informed)

- **No Consensus MCP `search` adapter.** It returns rendered markdown (fragile to parse, no doi/study_type) and needs
  an interactive OAuth browser flow — both make it a poor fit for a headless structured adapter. Deferred to the wire
  milestone (where the OAuth browser flow + a possible raw-text display live). REST quick_search supersedes it for structured data.
- No worker protocol / no Settings UI (the post-D "wire all providers" milestone). D is headless, like B/C.
- No broader Consensus REST beyond `/v1/quick_search` (blocked on additional official endpoint docs, §2.2).

## Reuse (no new config needed)

- **B's `ExternalHttpProviderConfigSchema` already supports `api-key-header` auth** (`{ type:"api-key-header", header, keyRef }`)
  — Consensus REST fits it directly; **no config-schema change**. The API key is a `KeyRef` (resolved by the future worker).
- `ExternalPaper` / `ExternalEvidenceCard` from `src/external/types.ts` (B). Reuse the §7.3-style robustness patterns from `scite-rest.ts`.

## Tasks (TDD, per-task commit) — `src/external/providers/`

- **D1 — Consensus REST adapter + mappers** (`consensus-rest.ts`): `createConsensusRest({ baseURL, apiKey }, deps:{ fetch })`
  with `quickSearch(query, opts?: ConsensusQuickSearchOptions)` → `GET {baseURL}/v1/quick_search` with the `x-api-key`
  header + the confirmed query params. **zod-validate** the `{ results: QueryResult[] }` response (strict on the required
  fields per D0, lenient on `study_type`/`takeaway`). Mappers: `mapConsensusResultToExternalPaper` → `ExternalPaper`
  (title/authors/doi/journal/year/abstract/citationCount/url + qualitySignals: study_type); `mapConsensusResultToEvidenceCard`
  → `ExternalEvidenceCard` from `takeaway` when present (relation "mentions", the paper as provenance). Robustness
  (mirror scite-rest): query trim+empty+length cap, bounded 429 retry honoring `Retry-After`, `x-api-key` only set when
  present + never logged, non-OK/zod errors emit status/issue-path only (no key/body leak). Injected `fetch` (no live network).
  Tests (`tests/external.consensus-rest.test.ts`): each mapper, a malformed response rejected by zod, the 429 retry, and
  that the `x-api-key` header is set (asserted via the captured request).
  **Codex review conditions (folded in):** (a) serialize `study_types` as **repeated params** — OpenAPI-3 default
  `form`+`explode=true`, i.e. `?study_types=rct&study_types=meta-analysis` (NOT CSV); assert the exact URL serialization
  in a test. (b) Create a **REST-shaped `fixtures/external/consensus/quick_search.sample.json`** (`{ results: [...] }`,
  hand-built from the confirmed `quick_search-openapi.md` schema — D0 captured the OpenAPI but not a real REST body; only
  the D2 live smoke validates the real body). (c) **Early-throw on a blank `apiKey`** before any fetch is issued.
- **D2 — env-gated live smoke** (`tests/external.consensus-live.test.ts`): `describe.skipIf` unless `CONSENSUS_LIVE_TEST=1`
  + `CONSENSUS_API_KEY` (clear skip note naming the missing var). Real `quickSearch("sleep and academic performance")` →
  assert ≥1 mapped `ExternalPaper` with a doi/title. Skipped by default; confirms the real response shape + key auth.

## Test plan

- `tests/external.consensus-rest.test.ts` (mappers + fixtures + 429 + zod-reject + x-api-key header), offline/injected.
- `tests/external.consensus-live.test.ts` — env-gated. Fixtures under `fixtures/external/consensus/` (D0 captures + a REST
  body built from the confirmed schema; the live smoke validates the real body).

## Red lines

- `src/**` never imports `electron/**`. **No live network by default** (inject `fetch`; only the env-gated smoke hits the API).
- The API key is an **argument** (resolved from the keystore by the future worker) — the adapter never reads the keystore,
  never logs/returns the `x-api-key`. zod-validate all responses. Respect 429/`Retry-After` + a time budget. Outbound =
  query only, never the draft (§9). External output is not a gold label (§9).

## Resolutions (Codex 2026-06-27 review — CONDITIONAL GO, conditions folded in)

1. **Defer MCP confirmed** — D0's MCP sample is rendered prose (no doi/fields) + needs OAuth; REST quick_search is clean
   structured JSON. No D-scope value lost.
2. **`study_types` = repeated params** (OpenAPI-3 default `form`+`explode=true`), asserted via URL serialization in a test (D1 cond. a).
3. **`takeaway` → an `ExternalEvidenceCard`** (relation "mentions") — the per-paper evidence snippet — plus noted on the paper.
4. Add a **REST-shaped `quick_search.sample.json`** fixture (D1 cond. b) + an **early-throw on a blank apiKey** (D1 cond. c).
5. Reuse of B's `api-key-header` config + the creds-as-args / injected-fetch pattern confirmed correct.
