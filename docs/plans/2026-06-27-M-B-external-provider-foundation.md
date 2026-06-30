# Milestone B — External research provider foundation (headless, fake-tested, no live calls)

> Status: implementation plan (TDD, task-sequenced). Derives from `2026-06-26-…-external-research-integrations.md` §7.2, §9, §13.1–13.3.
> Authored by Claude as the Phase-1 design gate; to be Codex-reviewed (fresh, read-only) before any code.
> Date: 2026-06-27.

## Goal

Lay the **headless foundation** for external research providers (scite / Consensus): the normalized types,
the non-secret config schema, a provider registry, and an MCP client wrapper — all exercised by an
**in-memory fake MCP server**, with **zero live network and zero UI**. This is the base that Milestones
C–E build live adapters on.

## Non-goals (Milestone B) — deliberately deferred

- **No live scite/Consensus calls** (no real HTTP/MCP network at all in this milestone) — §12.
- **No worker/IPC/Settings wiring** — the `analyze`/search worker messages + the Settings provider UI land
  with the first live adapter (Milestone C: scite), where there is something real to test/connect.
- **No OAuth-PKCE / scite-client-credentials live implementation** — the auth *union* is in the schema, but
  those strategies **throw an explicit "implemented in Milestone C/D" error** rather than silently no-op.
  Only `none` + `bearer` (header injection) are implemented in B (both fake-testable in-memory).
- No keystore change (see grounded facts).

## Grounded facts (verified against the installed code)

- `KeyStore` (`src/providers/keystore.ts`) is a generic `{ get/set/delete }(key: string)` store — it **already**
  holds arbitrary named secret refs, so external `*KeyRef`s need **no keystore change** (parent §13.1's
  "if too narrow" does not apply). Secrets reach the worker via `set_config`'s `secrets` map (main resolves
  keyRefs→values from `ElectronKeyStore`/safeStorage) and are redacted at the worker boundary — that wiring
  is **Milestone C** (no worker calls in B).
- `@modelcontextprotocol/sdk` (^1.29.0) — import via the package **export specifiers** (the exports map resolves
  them to `dist/esm/`; import the specifier, never `require()` a literal path): `Client` from
  `@modelcontextprotocol/sdk/client/index.js` — real API `Client.connect(transport, options?)`,
  `listTools(params?, options?) → { tools, … }`, `callTool(params, resultSchema?, options?)`; transports
  `/client/stdio.js`, `/client/streamableHttp.js`; OAuth `/client/auth.js`; and **`InMemoryTransport`**
  (`/inMemory.js`, `.createLinkedPair(): [InMemoryTransport, InMemoryTransport]`). **The repo already uses this rig
  in `tests/mcp.server.test.ts` — mirror it** (Codex-confirmed against the installed declarations; no phantom API).
- `src/providers/config.ts` holds `AppConfigSchema`; adding `externalResearch` with a default keeps existing
  saved configs parseable (back-compat).
- **Security model**: config carries **keyRefs only** (`tokenKeyRef`/`clientIdKeyRef`/`clientSecretKeyRef`/`keyRef`),
  never raw secret values (the §13.2 zod schemas already do this). B enforces + tests that invariant.

## Tasks (TDD, per-task commit)

- **B1 — types** (`src/external/types.ts`, pure): `ExternalProviderId`, `ExternalResearchCapability` (the §13.2
  enum), `ExternalPaper`, `ExternalEvidenceCard`, `ExternalProviderStatus`, plus a normalized
  `ExternalSearchResult { provider; papers: ExternalPaper[]; evidence: ExternalEvidenceCard[] }` and an
  **`OutboundRequest { provider; tool; query: string }`** shape (makes "what leaves the machine" explicit — a
  query string, never the full draft, per §9). Type-only; a tiny structural test or fold into B2.
- **B2 — config schema** (`src/providers/config.ts`): add `ExternalMcpProviderConfigSchema`,
  `ExternalHttpProviderConfigSchema`, `ExternalResearchConfigSchema` (§13.2, **keyRefs only**) + `externalResearch`
  on `AppConfigSchema` defaulting to `{ mcpProviders: [], httpProviders: [] }`.
  - **🔴 Secret-safety fixes to the §13.2 schema (Codex must-fix):** define a shared
    **`KeyRefSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)`** (a slug-shaped *reference*,
    not a secret value) and use it for **every** keyRef field (`*KeyRef`; and `secretEnvKeyRefs: z.record(KeyRefSchema)`
    mapping env-var-name → keyRef, resolved at spawn in C). `headers`/`env` are **non-secret only** (documented;
    auth/secrets go through keyRefs, never here).
  - **Honest invariant (Codex 2nd-pass — a `z.string()` can't cryptographically tell a ref from a pasted secret):**
    the guarantee is **architectural + structural**, not value-proof — the config declares **no field that receives a
    secret value**; every secret-bearing field is a slug-validated `KeyRef`; **actual secret values live only in the
    keystore** (set via `set_key`, never in the persisted config object), and the Settings UI (C) keeps the
    secret-value input separate from the keyRef. KeyRefSchema's slug + 120-char cap is defense-in-depth that rejects an
    obvious pasted secret (spaces/newlines/over-length), not a proof.
  - **🟡 Capability source (Codex):** add an explicit `capabilities: z.array(z.string()).default([])` to the **MCP**
    schema (parity with the HTTP one) so B3/B4 read a real capability list rather than inferring from `allowedTools`.
  - Tests (`tests/providers.config.test.ts`): (a) existing config w/o `externalResearch` still parses (back-compat);
    (b) a sample scite/Consensus config parses; (c) malformed (missing `allowedTools`/keyRef, bad url) rejected;
    (d) **no-raw-secret invariant** — every secret-bearing field uses `KeyRefSchema`; assert it **rejects** a value
    with spaces/newlines/over-120-chars (an obviously-pasted secret) and a parsed config carries only keyRefs.
- **B3 — provider registry** (`src/external/provider-registry.ts`, pure): `enabledProviders(cfg)`,
  `providerById(cfg, id)`, `declaredCapabilities(providerCfg)` — reads the **explicit `capabilities` field only**
  (validated into the `ExternalResearchCapability` enum); `allowedTools` is **solely** the call-authorization
  allowlist (B4), never a capability source. Unit-tested.
- **B4 — MCP client wrapper** (`src/external/mcp-client.ts`):
  - `AuthStrategy` = a **pure header/transport-option builder**: `noneAuth` (no headers); `bearerAuth(token)` →
    `{ headers: { Authorization: ` + "`Bearer ${token}`" + ` } }`. `oauth-pkce` + `scite-client-credentials`
    factories **throw `UnsupportedAuthError`** (live auth lands in C/D) — and a provider configured with them yields
    a **`{ connected: false }` "deferred" status, not a silent success** (Codex Q4).
  - `connectExternalMcpProvider(providerCfg, deps)` — `deps.transport` injectable (real Stdio/StreamableHTTP in C;
    `InMemoryTransport` in tests); `new Client(...)`, `await client.connect(transport)`, `await client.listTools()`,
    returns `{ client, status: ExternalProviderStatus(connected:true, capabilities from the **explicit config field**) }`.
  - `callAllowedExternalTool(client, providerCfg, name, args?: Record<string, unknown>)` — **throws (no call) when
    `name ∉ allowedTools`**; else `client.callTool({ name, arguments: args })` (SDK `arguments` is
    `Record<string, unknown> | undefined` — 🟢). Allowlist = the safety gate.
  - `tests/external.mcp-client.test.ts` (InMemoryTransport): a fake `McpServer` w/ one read-only `search` tool
    (mirror `tests/mcp.server.test.ts`) → connect lists `search` + status connected + capabilities;
    `callAllowedExternalTool` **rejects** a non-allowlisted name without calling; an allowed call returns the fake
    payload; the deferred auth factories throw.
  - **🟡 Bearer is NOT testable via the in-memory MCP protocol** (it bypasses HTTP), so `bearerAuth` gets a **separate
    pure unit test** (`tests/external.auth.test.ts`) asserting its header output; wiring it into a real
    `StreamableHTTPClientTransport` is Milestone C.

## Test plan

- `tests/external.mcp-client.test.ts` (InMemoryTransport fake server — the §9 "in-memory fake MCP server" test).
- `tests/providers.config.test.ts` additions (parse / back-compat / malformed / no-secret).
- `tests/external.registry.test.ts` (registry + capability lookup).
- All **offline/in-memory** — no real network, no env-gated live tests in B (those arrive in C–E).

## Red lines

- `src/**` never imports `electron/**` (iron rule).
- **No live network in Milestone B** — every test uses `InMemoryTransport` or pure data; no real
  scite/Consensus/HTTP request is made or possible from the code paths shipped here.
- Secrets: every secret-bearing field is a slug-validated **`KeyRef`** (`*KeyRef`, `secretEnvKeyRefs`); `headers`/`env`
  non-secret. The config declares **no secret-value field**; actual secret values live **only in the keystore**
  (an architectural guarantee — KeyRefSchema's slug/length cap is defense-in-depth, not a value proof). Tested.
- **Back-compat**: `externalResearch` defaults empty so every existing saved `AppConfig` still parses.
- **Tool allowlist** enforced before any `callTool` (no arbitrary tool execution).
- **Outbound minimization**: the search abstraction takes a `query` string, not the draft/paragraph (§9 "do not
  send full draft externally by default").
- Deferred-not-silent: unimplemented auth strategies throw; worker/Settings/live adapters are explicitly C–E.

## Resolutions (from Codex's 2026-06-27 review — CONDITIONAL GO, all folded in)

1. **Scope cut confirmed** — headless foundation is the right boundary; do **not** pull `external_provider_status`
   into B (main only resolves the top-level `keyRef` into worker `secrets`; provider status without the C worker
   wiring would be misleading). Nothing in B is live-dependent once bearer gets its own unit test.
2. **🔴 Raw-secret maps fixed** — `secretEnv`→`secretEnvKeyRefs` (refs), `headers`/`env` non-secret; the no-raw-secret
   invariant is now enforceable + tested.
3. **MCP SDK confirmed real** — `Client.connect`, `listTools→{tools}`, `callTool`, `InMemoryTransport.createLinkedPair()`
   all match sdk ^1.29.0; the repo's `tests/mcp.server.test.ts` already uses this rig (mirror it). Import via export
   specifiers, not literal file paths. `callTool` args = `Record<string, unknown> | undefined`.
4. **Auth deferral sound** — keep `oauth-pkce`/`scite-client-credentials` in the union so old configs deserialize;
   throwing `UnsupportedAuthError` must yield a **`{connected:false}` deferred status, not a silent success**.
5. **Capability source** — explicit `capabilities` field on the MCP schema (B3 reads it).
6. **Bearer** — pure header-builder unit-tested separately (in-memory protocol can't exercise HTTP headers); real
   transport wiring is C.
7. **2nd-pass (final, Codex-specified):** a slug-shaped `KeyRefSchema` (≤120 chars) for all keyRefs **and** the
   invariant narrowed to the honest architectural guarantee (no secret-value fields; values only in the keystore);
   B3 reads the explicit `capabilities` only, `allowedTools` is call-authorization only. → GO.
