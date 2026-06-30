# Milestone Wire — surface external research (scite + Consensus) in the app

> Status: implementation plan (TDD, task-sequenced). Builds on B (foundation) + C (scite) + D (Consensus REST), all merged.
> Internal wiring (no external contract capture needed). Codex-reviewed before any code. Date: 2026-06-27.

## Goal

Make the merged external adapters **usable in the app**: configure provider credentials in Settings, then run an
**external search** (scite + Consensus) whose normalized `ExternalPaper` results appear in a surface. Uses only the
**non-interactive** auth paths (scite client-credentials, Consensus REST `x-api-key`) — no OAuth browser flow.

## Non-goals (this milestone) — deferred

- **No Consensus MCP OAuth-PKCE browser flow.** It's interactive (Electron BrowserWindow DCR + redirect) and
  **Consensus REST quick_search already covers search** — so the OAuth/MCP path is a separate later milestone.
- No deep per-claim Writing-Desk integration ("find external evidence for this claim", "add to library") — a follow-up
  once search is wired. This milestone delivers a standalone external-search surface; DOI enrichment
  (`external_enrich_doi`) is deferred to Milestone E (reference health) — see resolution 6.
- No broader Consensus REST (blocked on more endpoint docs). No new adapters.

## Grounded facts (verified)

- `electron/main.ts` `set_config` (363-367) currently resolves only the **single top-level `keyRef`** →
  `secrets:{[keyRef]:value}` → worker. **Must extend** to collect+resolve ALL keyRefs in `config.externalResearch`
  (each provider's `auth.*KeyRef` + `secretEnvKeyRefs`) from the keystore into the secrets map.
- `src/app/worker-runtime.ts` owns `secrets` (registered via `set_config`), `redactSecrets` scrubs every secret value
  from ALL responses at the boundary, and `buildRuntimeContext` builds the ToolContext. New external messages inherit
  redaction automatically (they go through `handleLine`).
- Adapters take **resolved creds as args + injected I/O**: scite = `createSciteTokenCache(client_id/secret)`→bearer→
  `createSciteRest({token})` / `sciteSearchLiterature`; Consensus = `createConsensusRest({apiKey})`. `provider-registry`
  gives `enabledProviders(cfg)` + `declaredCapabilities`.
- `ExternalHttpProviderConfigSchema` (api-key-header) + `ExternalMcpProviderConfigSchema` (scite-client-credentials) already exist (B).

## Tasks (TDD, per-task commit)

- **W1 — provider factory + worker protocol** (`src/external/provider-factory.ts` + `src/app/protocol.ts` + `worker-runtime.ts`):
  - `buildExternalProvider(providerCfg, secrets, deps:{fetch})` → resolves the provider's creds from `secrets` (by its
    keyRefs) and returns a uniform `{ search(query, opts?) → Promise<ExternalSearchResult>, status }`. scite → token via
    scite-auth then `sciteRest.search` (rich REST path, per C); Consensus → `consensusRest.quickSearch`. A provider whose
    creds are absent/deferred-auth → a `{connected:false}` status (no throw).
  - **🟡#1 scite config contract (pin before coding):** scite is an `ExternalMcpProviderConfig` with
    `scite-client-credentials` auth (`clientIdKeyRef` + `clientSecretKeyRef`); the factory resolves BOTH from `secrets`,
    gets a bearer (scite-auth), and calls `sciteRest.search` with **REST baseURL = `new URL(transport.url).origin`**
    (i.e. `https://api.scite.ai`, derived from the MCP `url`) — no HTTP-provider schema change. Consensus is an
    `ExternalHttpProviderConfig` (`api-key-header`).
  - **🟡#2 partial scite creds:** when only ONE of `clientIdKeyRef`/`clientSecretKeyRef` resolves from `secrets`, return
    `{connected:false}` and **do NOT fetch** (the token POST needs both). Use the imports under `src/external/providers/` (🟢#8).
  - Worker messages: `external_provider_status` (config-only: which configured providers are enabled + have creds present
    + capabilities — no live call) and `external_search { providerId, query, opts? }` → builds the provider from
    `config.externalResearch` + `secrets`, runs it, returns `{ provider, papers, evidence }` (redacted by the boundary).
  - Tests (`tests/external.provider-factory.test.ts`, `tests/app.external-protocol.test.ts`): fake fetch; scite + consensus
    dispatch + mapping; scite cred matrix — **no keys / only clientId / only clientSecret / both** (the first three →
    `{connected:false}`, no fetch; only "both" fetches); a missing Consensus api_key → graceful status; **the secret never
    appears in the serialized response** (drive `handleLine` with a secret in `secrets`).
- **W2 — main secret resolution + IPC bridge** (`electron/main.ts`, `preload.ts`, `renderer/api.d.ts`):
  - `set_config` collects + resolves **all** keyRefs (top-level + every `externalResearch` provider's `auth.*KeyRef` +
    `secretEnvKeyRefs`) from the keystore → secrets map (still never logged; same redaction downstream).
  - `ipcMain.handle` + typed preload `externalSearch(providerId, query, opts?)` + `externalProviderStatus()`; `api.d.ts`
    Harness types. No secrets cross to the renderer.
- **W3 — Settings external-research UI** (`renderer/tabs/Settings.tsx` + i18n): a section to enable/configure scite
  (client_id + client_secret → `set_key` under their keyRefs; non-secret config via `set_config`) and Consensus REST
  (api_key → `set_key`); a "Check providers" button calling `externalProviderStatus()` (shows enabled/creds-present/
  capabilities). Bilingual EN+ZH. Saved-keys never shown (mirror the existing API-key field).
- **W4 — external-search surface** (🟡#4 — pinned: a **"Search online sources" panel in the Library tab**, co-locating
  external search with library-building + keeping the nav lean; "add to library" is a later follow-up) — `renderer/tabs/Library.tsx`
  + i18n + acceptance: a query box + provider toggle → `externalSearch` → `ExternalPaper` cards (title/authors/year/
  journal/doi→link/citationCount + provider provenance + scite reference-signal/Consensus takeaway when present). Honest
  "online, sends your query to <provider>" note. Extend `scripts/acceptance.mjs` (label-agnostic, with no creds → the
  surface shows a "configure a provider in Settings" empty state, not an error).

## Red lines

- `src/**` never imports `electron/**`. Secrets: resolved in main from the keystore, passed via `set_config` secrets,
  **redacted at the worker boundary**. **Renderer-secret invariant (🟡#3):** the renderer never receives
  *persisted/resolved* credentials **back** from main/worker — status returns only booleans + capabilities, and saved
  keys are never echoed; it only **transiently handles user-typed secret fields** in Settings, cleared right after
  `set_key` (mirroring the existing API-key field). External calls are **opt-in** (only when a provider is enabled + has
  creds); the offline audit/review/Writing-Desk paths are unchanged and never call out.
  **Outbound payload (corrected after milestone review):** the search **query** plus an **allowlisted set of
  non-sensitive structural filters**, each **validated/allowlisted at the egress adapter before the request leaves the
  process** — scite reads only `limit`/`offset`/`page` (a `.strict()` `SciteSearchOptionsSchema`); Consensus accepts only
  its declared filters (`year_min`/`year_max`/`study_types`/`human`/`sample_size_min`/`sjr_max`/`duration_min`) via a
  `.strict()` input schema. Any unknown field is **rejected** (fail-closed). The user's **draft, corpus, or library
  content is NEVER sent**, and the W4 surface currently passes the query alone. External results are candidates,
  **not** gold labels (§9).
- A provider with missing creds / deferred auth → a graceful `{connected:false}` status, never a crash or a silent wrong result.

## Resolutions (Codex 2026-06-27 review — CONDITIONAL GO, conditions folded in)

1. **Defer Consensus MCP OAuth confirmed** (REST covers search; MCP code already returns deferred status); defer deep Writing-Desk integration confirmed.
2. **W4 = a "Search online sources" panel in the Library tab** (🟡#4 pinned).
3. **scite config** = the MCP config w/ scite-client-credentials; factory derives REST baseURL from the MCP url origin (🟡#1); **partial creds → `{connected:false}`, no fetch, tested** (🟡#2).
4. **Renderer-secret invariant reworded** (🟡#3): never receives *resolved/persisted* creds back; transient user-entry only, cleared after `set_key`.
5. **Secret pipeline sound end-to-end** (🟢#5: main→keystore→set_config secrets→worker redaction; safeStorage; unknown-key strip). Opt-in/offline-unchanged confirmed (🟢#7).
6. `external_search` **per-provider** (merge in the surface). **DOI enrichment (`external_enrich_doi`) DEFERRED to Milestone E** (reference health) — W1 stays search + status.

## Milestone-end review (Codex 2026-06-27, post-implementation) — NO-GO → resolved → GO

5 red lines PASS. One 🔴 (Red Line 5) + two minors, all resolved:
- 🔴 **Outbound ≠ query only**: `opts` filters reach the outbound URL. Verified **not a leak** (scite read only `limit`/`offset`/`page`;
  Consensus `.strict`; W4 sends query alone) — a plan-wording gap. **Fixed:** corrected Red Line 5 to "query + allowlisted
  non-sensitive filters, validated at egress, fail-closed"; **made scite's allowlist explicit** (`SciteSearchOptionsSchema.strict()`
  + reject unknown opts, mirroring Consensus) with a test.
- 🟡 `PreloadAppConfig` omitted `externalResearch` → **added** (typed from the src schema, parity with `HarnessAppConfig`).
- 🟢 DOI non-goal wording contradicted resolution 6 → **corrected** (non-goal line now defers it).
