# C0 Contract Capture - scite External Provider

Project root: `academic-agent/`

Fixture directory: `academic-agent/fixtures/external/scite/`

## Sources Used

- OpenAPI spec: <https://api.scite.ai/openapi.json>
- OAuth authorization-server metadata: <https://api.scite.ai/.well-known/oauth-authorization-server>
- MCP tool call: `search_literature` with `term: "sleep and academic performance"`, `limit: 5`

Local shell network note: direct `curl` could not reach scite from this sandbox. With proxy env vars present, `curl` failed on `127.0.0.1:7897`; with proxy env vars unset, `curl` failed DNS resolution for `api.scite.ai`.

## A. Tally Field Names

The REST tally field is `contradicting`, not `contrasting`.

From the live OpenAPI `TallyResponse` schema, the response fields are:

- `total`
- `supporting`
- `contradicting`
- `mentioning`
- `unclassified`
- `doi`
- `citingPublications`

Required fields in the schema:

- `total`
- `supporting`
- `contradicting`
- `mentioning`
- `unclassified`

The OpenAPI description also states that the UI may use "contrasted", but the API uses `contradicted`/`contradicting`. The saved exact schema excerpt is in `openapi-excerpts.json`.

## B. Auth Reality Check

Confirmed from the OpenAPI spec:

- The spec says scite endpoints require tokens except the `tallies` and `papers` endpoints.
- The spec describes a programmatic API-key flow using `client_id`, `client_secret`, and `grant_type: "client_credentials"` against `https://api.scite.ai/auth_token_users/token`.
- The returned bearer token is documented as usable against the MCP JSON-RPC endpoint `https://api.scite.ai/mcp` for `tools/call`, including `search_literature`.
- `components.securitySchemes` contains exactly one scheme: `BearerAuth` with `type: "http"`, `scheme: "bearer"`, and `bearerFormat: "JWT"`.

Confirmed from `/.well-known/oauth-authorization-server`:

- `authorization_endpoint`: `https://api.scite.ai/mcp/oauth/authorize`
- `token_endpoint`: `https://api.scite.ai/mcp/oauth/token`
- `registration_endpoint`: `https://api.scite.ai/mcp/oauth/register`
- `grant_types_supported`: `authorization_code`, `refresh_token`
- `token_endpoint_auth_methods_supported`: `none`
- `code_challenge_methods_supported`: `S256`

Interpretation:

- Programmatic REST access is documented as client-credentials via `/auth_token_users/token`, but that endpoint appears in the OpenAPI prose, not as an expanded path definition in the captured `paths` object.
- MCP supports two documented auth paths: OAuth 2.1 authorization-code with PKCE/DCR for interactive clients, and the programmatic bearer token from the API-key/client-credentials flow for server-to-server or CLI use.
- The MCP connector available in this Codex environment successfully ran `search_literature`; that proves this connector is usable here, but it does not prove the user's future scite REST `client_id`/`client_secret` will have the same scopes.

Still needs the user's actual scite credentials to verify:

- Whether their `client_id` and `client_secret` successfully exchange at `/auth_token_users/token`.
- Exact token expiry and scope/entitlement behavior for their account.
- Whether that token authorizes `/api_partner/search` and `/mcp` in their account.
- Whether their MCP access requires an active premium entitlement beyond valid OAuth/API credentials.

## C. MCP `search_literature` Shape

The real MCP call returned this top-level shape:

```json
{
  "results": [
    {
      "title": "...",
      "url": "...",
      "doi": "..."
    }
  ]
}
```

Top-level keys actually present:

- `results`

Per-result keys actually present in the saved sample:

- `title`
- `url`
- `doi`

The exact returned JSON is saved in `search_literature.sample.json`.

## D. REST `/api_partner/search` Shape

From the live OpenAPI `SearchResultsResponse` schema, top-level response keys are:

- `count`
- `countIsApproximate`
- `aggregations`
- `hits`
- `suggestedTerm`
- `restrictedCites`

Required top-level keys:

- `count`
- `aggregations`
- `hits`

Each `hits[]` item uses `SearchResultSchema`. Top-level item fields captured from the schema:

- `id`
- `doi`
- `title`
- `slug`
- `authors`
- `journal`
- `shortJournal`
- `publisher`
- `memberId`
- `abstract`
- `year`
- `date`
- `lastUpdate`
- `volume`
- `issue`
- `page`
- `tally`
- `issns`
- `editorialNotices`
- `normalizedTypes`
- `isOa`
- `oaStatus`
- `meshTypes`
- `relevancyScore`
- `citations`
- `fulltextExcerpts`
- `highlightedFields`

The `tally` field in search results references `TallyResponse`, so its REST tally subfields use `contradicting`, not `contrasting`.

## E. REST `/papers/{doi}` Shape

The live OpenAPI endpoint `GET /papers/{doi}` returns:

```json
{
  "$ref": "#/components/schemas/PaperResponse"
}
```

Useful paper fields observed in the OpenAPI examples include:

- `abstract`
- `authors`
- `doi`
- `editorialNotices`
- `id`
- `issns`
- `issue`
- `journal`
- `journalSlug`
- `keywords`
- `memberId`
- `normalizedTypes`
- `page`
- `preprintLinks`
- `publicationLinks`
- `publisher`
- `retracted`
- `shortJournal`
- `slug`
- `title`
- `type`
- `volume`
- `year`

Important limitation: the web renderer exposed the endpoint `$ref` and examples, but did not expose a clean expandable `PaperResponse` component block. I saved the exact endpoint `$ref` plus observed example field names instead of fabricating unobserved component details.

## F. Real Tally Sample Attempt

Requested unauthenticated URL:

`https://api.scite.ai/tallies/10.1371/journal.pone.0000308`

Result in this environment:

- Local shell with proxy env vars: `curl: (7) Failed to connect to 127.0.0.1 port 7897`
- Local shell with proxy env vars unset: `curl: (6) Could not resolve host: api.scite.ai`
- Web channel did not return a retrievable live JSON response for that exact tally endpoint.

No `tally.sample.json` was saved because no live HTTP response body or HTTP auth status was obtained. This is a network/access failure in the execution environment, not evidence that the endpoint requires auth.

## G. Fixture Files Saved

- `openapi-excerpts.json`
- `search_literature.sample.json`
- `C0-contract-report.md`

No git commit was made. No adapter was implemented. No npm or vitest command was run.
