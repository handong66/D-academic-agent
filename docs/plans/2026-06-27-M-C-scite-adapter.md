# Milestone C — scite provider adapter (headless, fixture-tested, no live calls by default)

> Status: implementation plan, **revised against C0-captured real contracts**. Codex-reviewed (NO-GO → C0 done → revised here).
> Builds on Milestone B (types + config + provider-registry + mcp-client wrapper). Date: 2026-06-27.

## Goal

Implement the **scite provider adapter** — client-credentials auth, the REST calls, the MCP `search_literature`
call — with **zod-validated parsing** + **mappers** to `ExternalPaper` / `ExternalEvidenceCard` /
`ReferenceExternalSignal`. Fixture-tested with injected I/O (**no live network by default**); one **env-gated
live smoke** exercises the real API.

## C0 — contract capture: DONE ✅ (the NO-GO unblock)

Codex captured the real contracts (fixtures in `fixtures/external/scite/`): `openapi-excerpts.json`,
`search_literature.sample.json`, `C0-contract-report.md`. **Confirmed facts (use these, not guesses):**
- **Tally fields** (`TallyResponse`, required): `total, supporting, contradicting, mentioning, unclassified` (+ `doi`,
  `citingPublications`). **`contradicting`, NOT `contrasting`** — the mapper field names are correct.
- **Auth**: only security scheme is `BearerAuth` (JWT). Programmatic = client-credentials: `POST
  https://api.scite.ai/auth_token_users/token` with `client_id`+`client_secret`+`grant_type:"client_credentials"`
  → JWT bearer; docs say that bearer **also authorizes the MCP endpoint** (`/mcp` `tools/call search_literature`).
  ⚠️ The token endpoint is documented in OpenAPI *prose*, not an expanded path — so the **exact request/response
  field names + token lifetime + scope/premium gating need the user's real creds to confirm (the C4 live smoke)**.
- **MCP `search_literature` is SPARSE**: real result = `{ results: [{ title, url, doi }] }` (see the saved sample).
  → MCP is a light DOI-discovery search, **not** the rich-evidence source.
- **REST `/api_partner/search` is RICH**: `{ count, aggregations, hits, … }`; each hit has `id, doi, title, authors,
  journal, abstract, year, tally(→TallyResponse), editorialNotices, fulltextExcerpts, citations, isOa, …`.
  → **REST search is the rich source** for `ExternalPaper` + `ExternalEvidenceCard` (excerpts/tally/notices).
- **REST `/papers/{doi}` (`PaperResponse`)**: `abstract, authors, doi, editorialNotices, journal, title, type, year,
  retracted, …` (exact component block not fully expandable in C0; zod stays lenient + the live smoke confirms).

## Non-goals (Milestone C) — deferred

- No worker protocol / no Settings UI (the post-D "wire all providers" milestone, parent §13 Task 6). C is headless, like B.
- No advanced scite endpoints (citation statements, references graph, reference_check, assistant). Capability-gated/later.
- No Consensus (D). External output is not a gold label and doesn't replace local evidence (§9).

## Types (add to `src/external/types.ts`, additive)

- `SciteTally` (zod, the confirmed fields) + `ReferenceExternalSignal { provider; doi?; supportCount?; pushbackCount?;
  mentionCount?; unclassifiedCount?; citingPublicationCount?; risk: "ok"|"needs_care"|"risky"|"blocked"|"unknown" }`.

## Tasks (TDD, per-task commit) — `src/external/providers/`

- **C1 — scite auth** (`scite-auth.ts`): `resolveSciteBearerToken({clientId, clientSecret, baseURL}, deps:{fetch, now})`
  → POST `/auth_token_users/token` (`grant_type=client_credentials`), parse the token **defensively** (accept
  `access_token`+`expires_in`; tolerate field-name variance pending C4) → `{token, expiresAt}`; `SciteTokenCache`
  returns the cached token until ~60s pre-expiry then refreshes. Injected `fetch`+`now`. Tests: fetch+parse, cache,
  refresh, non-200 surfaces a clear error **without echoing client_secret**. Creds are **arguments** (worker resolves
  keyRefs later); the adapter never reads the keystore.
- **C2 — scite REST adapter + mappers** (`scite-rest.ts`): `sciteRest(deps:{fetch, token?})` with `getPaper(doi)`,
  `getTally(doi)`, `aggregateTallies(dois[]≤100)`, `search(query, opts?)` (`/api_partner/search`). **zod-validate every
  response** against the C0 schemas; map → `ExternalPaper` (from paper/search hits), `ExternalEvidenceCard` (from a
  hit's `fulltextExcerpts` + `editorialNotices`), `ReferenceExternalSignal` (`mapSciteTallyToReferenceSignal`, §7.3
  rule). **REST search is the rich path.** Handle 429/`Retry-After` (bounded retry + total time budget); **URL-encode
  the DOI** in path calls. Tests: fixtures built from the C0 `openapi-excerpts.json` schemas + injected `fetch` — each
  mapper, the tally→signal risk rule, a malformed response rejected by zod, the 429 retry path.
- **C3 — scite MCP adapter** (`scite-mcp.ts`): `sciteSearchLiterature(args, deps:{transport})` via B's
  `connectExternalMcpProvider` + `callAllowedExternalTool("search_literature", …)`; map the **confirmed sparse**
  `{results:[{title,url,doi}]}` → `ExternalPaper[]` (title/url/doi). Real use wires `StreamableHTTPClientTransport` to
  `api.scite.ai/mcp` + B's `bearerAuth(token)`; tests inject `InMemoryTransport` + a fake server returning the saved
  `search_literature.sample.json`. Tests: the mapper + allowlist (only `search_literature`). (Rich data comes from C2/REST.)
- **C4 — env-gated live smoke** (`tests/external.scite-live.test.ts`): `describe.skipIf` unless **all** of
  `SCITE_LIVE_TEST=1`, `SCITE_CLIENT_ID`, `SCITE_CLIENT_SECRET` are set (clear skip reason naming the missing var).
  Real token exchange + one `getTally(doi)` + one MCP `search_literature`; asserts the mappers produce sane shapes
  **and prints/asserts the real token endpoint req/resp field names** (closes the C0 prose gap). Skipped by default.

## Test plan

- `tests/external.scite-auth.test.ts`, `.scite-rest.test.ts` (mappers + fixtures + 429 + zod-reject),
  `.scite-mcp.test.ts` (InMemoryTransport + the real sample) — all offline/injected.
- `tests/external.scite-live.test.ts` — env-gated. Fixtures under `fixtures/external/scite/` (C0 captures + REST
  bodies built from the confirmed schemas; the live smoke validates real bodies).

## Red lines

- `src/**` never imports `electron/**`. **No live network by default** (inject `fetch`/`transport`; only the env-gated
  smoke hits the real API).
- Adapter takes **resolved creds as arguments + injected `fetch`/`transport`** — never reads the keystore, never
  logs/returns `client_id`/`client_secret`/token (the token-exchange error path must redact the body).
- **zod-validate all external responses** before mapping (malformed = clean error). Respect 429/`Retry-After` + a total
  retry-time budget. **URL-encode** DOIs; cap query length. Outbound = query/DOI only, never the draft (§9).

## Resolutions (Codex NO-GO → C0 captures, folded in)

🔴 tally field names → CONFIRMED `contradicting`/`unclassified`/`citingPublications`. 🔴 auth → confirmed
client-credentials `/auth_token_users/token` bearer (works MCP per docs); exact token fields + premium gating → C4
(user creds). 🔴 MCP shape → confirmed SPARSE `{results:[{title,url,doi}]}`; rich evidence comes from REST search.
🔴 fixtures → C0 captured the real OpenAPI excerpts + a real MCP sample (record-then-redact); REST bodies from the
confirmed schemas, validated live in C4. 🟡 C0 inserted + done. 🟡 security adds (DOI URL-encode, query cap, retry
budget, log redaction) folded into C1/C2 red lines. 🟡 scope cut (headless only) confirmed. 🟢 live-smoke gates on all env vars.

## Needs the user's scite credentials (only for C4)

C1–C3 build + fixture-test **now** against the confirmed contracts. **C4 (live smoke) needs the user's
`SCITE_CLIENT_ID` + `SCITE_CLIENT_SECRET`** to verify the real token exchange, response bodies, and whether MCP
requires premium — until provided, C4 is skipped (the adapter is otherwise complete + tested).
