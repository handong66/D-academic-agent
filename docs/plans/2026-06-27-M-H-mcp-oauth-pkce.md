# Milestone H — OAuth-PKCE for external MCP providers (Consensus the concrete case)

**Goal:** connect an OAuth-gated MCP server (Consensus) via the standard **OAuth 2.1 PKCE + Dynamic Client
Registration browser flow** — a **reusable MCP-auth capability** (works for any OAuth-gated MCP), not Consensus-specific.

**User-chosen (2026-06-27):** "直接做完整 OAuth-PKCE 能力" — the full flow, accepting it's interactive (needs the
user's live Consensus login to verify end-to-end) and that Consensus MCP `search` returns markdown (REST already
covers structured search — the value here is the OAuth capability itself).

## Grounded facts (verified in code, 2026-06-27)

- **The MCP SDK ships the entire OAuth toolkit** (`@modelcontextprotocol/sdk/client/auth.js`): `auth(provider, opts)`
  orchestrator; `discoverOAuthMetadata`/`discoverAuthorizationServerMetadata`/`discoverOAuthProtectedResourceMetadata`
  (.well-known); `registerClient` (DCR); `startAuthorization` (builds the authorize URL + PKCE verifier/challenge);
  `exchangeAuthorization`; `refreshAuthorization`; plus the **`OAuthClientProvider`** interface and
  `StreamableHTTPClientTransport({ authProvider })` + `transport.finishAuth(code)`. **We do NOT hand-roll crypto/DCR.**
- **Config already has the shape** (`src/providers/config.ts:54-59`): `oauth-pkce` = `{ type, resource?, scopes(min 1),
  tokenKeyRef }`. Discovery finds the endpoints. **Add optional `clientIdKeyRef`(+`clientSecretKeyRef`) — the DCR
  fallback, REQUIRED for servers without a `registration_endpoint`** (SDK `registerClient` throws otherwise); default =
  DCR. (keyRefs, not raw secrets — preserves the no-secret-in-config rule.)
- **B left the stub to replace:** `src/external/mcp-client.ts:27` `oauthPkceAuth` throws `UnsupportedAuthError`.
- **Architecture (respects the iron rule):** the OAuth lifecycle needs `BrowserWindow` (interactive authorize) +
  `safeStorage` (token persistence) → it lives in **`electron/` (main)**. The **worker's MCP client consumes the
  resulting access token as a bearer** (reuse B's `bearerAuth`) — so `src/**` stays electron-free and the worker never
  runs the OAuth dance. Main owns sign-in + token storage + refresh; the token reaches the worker via the existing
  `set_config` secrets path; the worker's `oauth-pkce` auth → `bearerAuth(resolvedToken)` (else `{connected:false}`).

## Tasks (TDD where possible; interactive parts verified structurally + by the user's live login)

- **H1 — main-side OAuth core + worker bearer wiring** (`electron/oauth/` (new) + `src/external/mcp-client.ts`):
  - `electron/oauth/keychain-oauth-provider.ts`: an `OAuthClientProvider` impl backed by the keystore implementing the
    SDK's REQUIRED methods — `get redirectUrl()`, `get clientMetadata()`, `clientInformation()`, `tokens()`,
    `saveTokens()`, **`redirectToAuthorization(url)`** (🟡 was omitted; opens the sign-in BrowserWindow in main),
    `saveCodeVerifier()`, `codeVerifier()` — plus `state()` (**we ALWAYS supply + validate state; the SDK's `finishAuth`
    does NOT validate it**, so CSRF is the app's job) and `saveClientInformation()`. **All OAuth state (tokens + DCR
    client info + verifier) is a single JSON blob in the keychain under `tokenKeyRef`** (keystore is string→string). A
    pure, testable serialize/deserialize layer (`tests/oauth.provider.test.ts`: round-trip; nothing plaintext).
  - **🟡 DCR fallback:** `clientInformation()` returns a **pre-registered client** when the config supplies optional
    `clientIdKeyRef`(+`clientSecretKeyRef`); otherwise DCR registers + `saveClientInformation` persists it. (The SDK
    `registerClient` THROWS if the server has no `registration_endpoint` — so non-DCR servers MUST have the pre-registered
    keyRefs.) These are keyRefs (no raw secret in config).
  - `electron/oauth/sign-in.ts`: `signInWithOAuth(providerCfg, deps)` — drives the SDK two-phase `auth()` (discovery →
    DCR-or-pre-registered → `startAuthorization` → `provider.redirectToAuthorization(url)` opens the window → returns
    "REDIRECT"; then `auth(provider, {authorizationCode})` → `exchangeAuthorization` → `saveTokens`). Testable with a
    **fake authorization server** (injected `fetch`/`fetchFn`) + an injected redirect-capture (no real browser); cover the
    happy path AND **state-mismatch** + **timeout** rejection.
  - `src/external/mcp-client.ts`: replace the `oauthPkceAuth` throw — `oauth-pkce` resolves a **bare access-token string**
    from `secrets[tokenKeyRef]` (main passes ONLY the access_token, NOT the blob — see H2 / red lines); present →
    `bearerAuth(token)`, absent → graceful `{connected:false}` deferred status (no throw). Keeps InMemoryTransport tests green.

- **H2 — Electron interactive sign-in window + access-token-only worker handoff** (`electron/main.ts` + `electron/oauth/`):
  - `ipcMain.handle("oauth_sign_in", (providerId))` → `signInWithOAuth` → open a **`BrowserWindow`** to `authorizeUrl`;
    capture the redirect via a **loopback `http://127.0.0.1:<ephemeral>/callback`** listener → extract `code`+`state`,
    **validate `state` (reject on mismatch)** → finish → persist the full token blob in the keychain → close the window →
    return a connected status (**booleans only**).
  - **🔴 access-token-only handoff (must-fix):** main's `set_config` secret resolution, for an `oauth-pkce` provider's
    `tokenKeyRef`, **parses the keychain blob and passes ONLY the `access_token` string to the worker** — never the
    refresh_token or DCR client info. So `secrets[tokenKeyRef]` the worker sees is a **scalar access token** →
    `redactSecrets` (exact-value scrub) covers it, and the refresh_token/client_secret never leave main.
  - **🔴/typed refresh (must-fix):** refresh is handled **in main, proactively on (re)connect** — before pushing, main
    checks token expiry and, if expired, runs the SDK `refreshAuthorization` (stored refresh_token) → re-persists the blob
    → pushes the fresh access_token. A mid-session 401 surfaces as a `{connected:false}` and the user reconnects (which
    refreshes); NO untyped worker→main refresh signal.
  - **Hard guardrails (enforced, structurally testable):** loopback binds **127.0.0.1 only**, the callback is
    **single-use**, **state is validated** (CSRF), and the listener **times out**; the code/token are **never logged**.

- **H3 — Settings: Consensus MCP provider + Connect** (`electron/renderer/tabs/Settings.tsx` + IPC + i18n):
  - In the External-research section, a **Consensus MCP (OAuth)** sub-form: the MCP **URL** + **scopes** (text inputs;
    pre-filled with sensible Consensus defaults the user can correct) + a **"Sign in / Connect"** button → `oauth_sign_in`
    → shows connected/disconnected (booleans only; the token is NEVER shown) + a "Disconnect" (clears the keychain blob).
  - Builds the `oauth-pkce` MCP provider config (URL + scopes + tokenKeyRef) via the existing `setConfig` flow. Bilingual.
  - Playwright: screenshot the Settings sub-form + the Connect button (the live OAuth window needs the user's account —
    gated, like the scite/consensus live smokes).

## Red lines

- `src/**` never imports `electron/**` — the OAuth lifecycle is entirely in `electron/`; the worker only ever sees a
  **bare access-token string** (via the existing redacted `set_config` secrets path).
- **Tokens live ONLY in the keychain** (access + refresh + DCR client info, as a JSON blob under `tokenKeyRef`); never in
  config, git, traces, logs, or any worker-response line. **The worker is handed ONLY the `access_token` scalar** (main
  parses the blob first) — so the refresh_token + client_secret never reach the worker, and `redactSecrets`' exact-value
  scrub covers the scalar (no JSON-substring gap). The **renderer never receives a token** — sign-in returns
  booleans/status only; there is no token field in the UI (URL/scopes are not secret).
- **PKCE + `state`** always (the SDK enforces PKCE; we validate `state` on the redirect for CSRF). The redirect is
  **loopback or the app's own window only** — never a remote redirect target.
- Opt-in: the OAuth flow runs ONLY on the explicit "Sign in / Connect" action; offline/audit/review/search/reference-health
  paths are unchanged and never trigger it.
- The Consensus MCP `search` (markdown) is **not** wired as a structured source (REST covers search) — H delivers the
  connection/auth capability + status, not a new data surface.

## Resolutions (Codex 2026-06-27 review — CONDITIONAL GO, must-fixes folded)

1. **🔴 access-token-only handoff:** main parses the keychain blob and passes ONLY the `access_token` scalar to the worker
   (refresh_token + DCR client info stay in main) → exact-value `redactSecrets` covers it, no JSON-substring leak.
2. **🔴 typed refresh:** handled in main, proactively on (re)connect (no untyped worker→main signal); 401 → reconnect.
3. **🟡 provider method `redirectToAuthorization`** added (was omitted) + `state()` always supplied AND app-validated
   (SDK `finishAuth` doesn't check state).
4. **🟡 DCR fallback:** optional `clientIdKeyRef`/`clientSecretKeyRef` (required for servers without a registration
   endpoint) — answers the "non-DCR + no-secret-in-config" question (they're keyRefs).
5. **🟡 redirect = loopback `127.0.0.1` only**, single-use, state-validated, timeout — HARD requirements (enforced+tested).
6. **🟢 boundary confirmed:** OAuth lifecycle in `electron/main`, worker = bearer-consumer; testable parts =
   OAuthClientProvider serialize/deserialize + the discovery→DCR→exchange orchestration vs a fake OAuth server (injected
   `fetch`/`fetchFn`) + **state-mismatch + timeout + DCR-missing-fallback + worker-never-gets-refresh-token** tests; the
   BrowserWindow + live Consensus login are gated/manual (accepted, like packaging + the live smokes).
