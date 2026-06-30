# Writing Desk and External Research Integrations

> Status: product and engineering development document.
> Scope: next-stage academic-writing features for the Electron app, plus app-level integration with scite and Consensus.
> Date: 2026-06-26.

## 1. Decision Summary

The next product step should not be "a smaller scite" or "a smaller Consensus." The app should become a local-first academic writing desk: it helps a researcher turn a draft, claim, or literature question into a stricter paragraph with traceable evidence.

The app can support scite and Consensus integration, but only through an explicit external research provider layer. The Electron renderer cannot directly reuse Codex or Claude Code's in-session tool handles. We need either:

1. A direct API adapter, when the provider has official endpoint documentation and the user has credentials.
2. A remote MCP client adapter, when the provider exposes an MCP endpoint and the app owns the authentication flow.
3. A manual import fallback, if the provider only exposes data through hosted UI or closed partner APIs.

Recommended path:

1. Build the writing desk with local-library-only features first.
2. Add an `ExternalResearchProvider` abstraction.
3. Implement the generic MCP client and auth layer once.
4. Implement scite first through its confirmed REST/OpenAPI and MCP surfaces.
5. Implement Consensus through the confirmed remote MCP endpoint `https://mcp.consensus.app/mcp`.
6. Add Consensus direct REST support for the confirmed `GET /v1/quick_search` endpoint when the user has API-key access.
7. Add any broader Consensus REST API only after official endpoint schemas and terms are confirmed.

## 2. Integration Investigation Findings

Sources checked on 2026-06-26:

- scite official API docs: `https://api.scite.ai/docs`.
- scite official OpenAPI JSON: `https://api.scite.ai/openapi.json`.
- scite official MCP page: `https://scite.ai/mcp`.
- scite MCP info and health endpoints: `https://api.scite.ai/mcp/info`, `https://api.scite.ai/mcp/health`.
- Consensus public candidates: `https://api.consensus.app/openapi.json`, `https://api.consensus.app/docs`, `https://api.consensus.app/redoc`, `https://api.consensus.app/mcp`, `https://api.consensus.app/health`, `https://consensus.app/api`, `https://consensus.app/api/docs`, public help article URLs, and `https://mcp.consensus.app/mcp`.
- Consensus official MCP page: `https://consensus.app/home/mcp/`.
- Consensus docs index and markdown docs: `https://docs.consensus.app/llms.txt`, `https://docs.consensus.app/docs/mcp.md`, and `https://docs.consensus.app/reference/v1_quick_search.md`.
- Consensus MCP OAuth discovery: `https://mcp.consensus.app/.well-known/oauth-protected-resource`, `https://mcp.consensus.app/.well-known/oauth-authorization-server`, and `https://mcp.consensus.app/health`.
- Current Codex Agent tool metadata for `mcp__codex_apps__scite._search_literature` and `mcp__consensus.search`.

### 2.1 scite: confirmed integration surface

scite has both an official REST API and an official MCP endpoint. This is materially different from merely having a Scite connector inside Codex or Claude Code.

Confirmed facts:

- `https://api.scite.ai/docs` returns the official "Scite API Docs" page and references `/openapi.json`.
- `https://api.scite.ai/openapi.json` is OpenAPI `3.1.0`, title `Scite API`, with `BearerAuth` JWT security.
- The API description says the scite API gives access to citation data, scite tallies, related paper metadata, reference check, and search.
- The docs say scite endpoints require tokens except some tally and paper endpoints.
- The docs say default unauthenticated rate limit is up to 10 requests per second and up to 40 requests per minute.
- The docs say `/tallies/{doi}`, `/tallies/aggregate`, and `/papers/{doi}` are uncapped.
- The docs include official MCP API instructions for `POST https://api.scite.ai/mcp`.
- `GET https://api.scite.ai/mcp/info` returns public server metadata: name `scite-api-mcp`, protocol `MCP`, protocol version `2025-03-26`, and one tool: `search_literature`.
- `GET https://api.scite.ai/mcp/health` returns `healthy`, `tools: ["search_literature"]`, and `readOnlyTools: ["search_literature"]`.
- An unauthenticated `tools/list` request to `POST https://api.scite.ai/mcp` returns `401` with a `mcp/www_authenticate` challenge, so the app must implement real authentication before using the tool.

Important scite authentication details:

- Interactive MCP clients can use OAuth 2.1 with PKCE and Dynamic Client Registration. The docs say a scite premium subscription is required.
- Programmatic integrations can use API-key style client credentials. The documented flow exchanges `client_id` and `client_secret` at `POST https://api.scite.ai/auth_token_users/token` and receives a bearer access token.
- The documented access token expires after 2 hours.
- The app should not store access tokens as long-lived secrets. It should store `client_id` and `client_secret` in Electron safe storage, fetch a bearer token in the worker, keep the token in memory with its expiry, and refresh it before expiry.

Relevant scite REST endpoints from OpenAPI:

- `GET /api_partner/search`: search scite publication metadata and citation data. Supports `term`, `mode`, `limit`, `offset`, `sort`, `title`, `abstract`, date filters, editorial filters, citation count filters, author, journal, publisher, section, paper type, affiliation, topic, and aggregation options.
- `GET /papers/{doi}`: get paper metadata for a DOI.
- `GET /tallies/{doi}`: get Smart Citation tally for one DOI.
- `POST /tallies/aggregate`: get aggregate tallies for up to 100 DOIs.
- `GET /api_partner/citations/citing/{doi}`: receive citations with the DOI as target paper. The docs state this requires special API token access.
- `GET /api_partner/citations/cited_by/{doi}`: receive citations with the DOI as source paper. The docs state this requires special API token access.
- `GET /api_partner/references/references_to/{doi}` and `GET /api_partner/references/references_from/{doi}`: retrieve distinct reference relationships. The docs state these require API token usage.
- `POST /reference_check`: schedule a document reference check using uploaded PDF/docx or URL.
- `GET /reference_check/tasks/{task_id}` and `GET /reference_check/tasks/{task_id}/result_url`: poll and retrieve reference-check results.
- `POST /api_partner/assistant/poll` and `GET /api_partner/assistant/tasks/{task_id}`: partner assistant task API, including an optional structured table mode.

Relevant scite MCP behavior:

- MCP endpoint: `POST https://api.scite.ai/mcp`.
- Methods documented: `initialize`, `tools/list`, `tools/call`, and `ping`.
- Tool documented and observed in Agent metadata: `search_literature`.
- `search_literature` supports broad search, DOI lookup, title lookup, Boolean syntax, phrase search, date filters, author/journal/topic filters, editorial filters, citation filters, and DOI/title-targeted full-text excerpt search.
- `search_literature` returns normalized paper metadata, abstracts, citation tallies, full-text excerpts where indexed, access links, Smart Citation snippets, citation polarity, sections, source/target DOI pairs, and editorial notices.

Product implication:

scite should be the first live external provider because we can implement it from official documentation without guessing. The best scite adapter is hybrid:

1. Use direct REST for DOI metadata, tallies, aggregate tallies, and reference-health checks.
2. Use remote MCP `search_literature` for broad literature search, DOI-targeted excerpts, Smart Citation snippets, and AI-agent-friendly search behavior.
3. Gate advanced endpoints such as citation statement retrieval, reference check, and assistant/table mode behind feature flags until the user's scite plan and token scopes are confirmed.

### 2.2 Consensus: remote MCP and quick-search REST API confirmed

Consensus should be treated differently from scite's broad REST API, but the old "no public direct API" conclusion is not accurate. The current Codex setup confirms a real remote MCP endpoint, and the official Consensus docs include an endpoint-level OpenAPI definition for `GET /v1/quick_search`.

Confirmed facts from this investigation:

- `https://api.consensus.app/openapi.json`, `/docs`, `/redoc`, `/mcp`, and `/health` returned `404 {"detail":"Not Found"}`.
- `https://consensus.app`, `https://consensus.app/api`, `https://consensus.app/api/docs`, `https://www.consensus.app/mcp`, and checked Consensus public help article URLs returned Cloudflare challenge pages from the terminal environment.
- `https://consensus.app/home/mcp/` is the official MCP landing page. It states the MCP server URL is `https://mcp.consensus.app/mcp`, and that the `/mcp` path is required.
- `https://docs.consensus.app/llms.txt` lists the MCP guide and the API reference.
- `https://docs.consensus.app/docs/mcp.md` is the markdown version of the MCP guide. It includes setup commands for Claude Code and Codex:
  - Claude Code: `claude mcp add --transport http consensus https://mcp.consensus.app/mcp`
  - Codex: `codex mcp add consensus --url https://mcp.consensus.app/mcp` and `codex mcp login consensus`
- The local Codex config has `[mcp_servers.consensus]` enabled with `url = "https://mcp.consensus.app/mcp"`.
- `GET https://mcp.consensus.app/mcp` returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.consensus.app/.well-known/oauth-protected-resource", scope="search"`.
- `GET https://mcp.consensus.app/.well-known/oauth-protected-resource` returns `resource: "https://mcp.consensus.app"`, `authorization_servers: ["https://consensus.app"]`, bearer method `header`, and supported scopes `search` and `profile`.
- `GET https://mcp.consensus.app/.well-known/oauth-authorization-server` returns OAuth endpoints:
  - authorization endpoint: `https://consensus.app/oauth/authorize/`
  - token endpoint: `https://consensus.app/oauth/token/`
  - revocation endpoint: `https://consensus.app/oauth/revoke/`
  - dynamic client registration endpoint: `https://consensus.app/oauth/register/`
  - grant types: `authorization_code`, `refresh_token`
  - PKCE method: `S256`
  - token endpoint auth method: `none`
- `GET https://mcp.consensus.app/health` returns `{"status":"healthy"}`.
- The current Codex environment exposes an Agent tool named `mcp__consensus.search`. This proves the remote MCP server is usable from Codex after Codex supplies the needed authentication context. It does not mean our packaged Electron app can reuse Codex's in-session token.
- `https://docs.consensus.app/reference/v1_quick_search.md` contains an OpenAPI `3.1.0` definition for `GET /v1/quick_search`.
- The REST API server is `https://api.consensus.app`.
- REST auth for `GET /v1/quick_search` is `x-api-key` header, according to the endpoint OpenAPI definition.
- An unauthenticated request to `https://api.consensus.app/v1/quick_search` returns `403 {"detail":"Not authenticated"}`, confirming the endpoint exists and requires authentication.

Observed Consensus Agent tool surface:

- Tool: `search`.
- Description: search over 200 million peer-reviewed academic papers.
- Required input: `query`.
- Optional filters: `year_min`, `year_max`, `study_types`, `human`, `sample_size_min`, `duration_min`, `duration_max`, `journal_name`, `publisher_name`, `exclude_preprints`, `include_full_text_chunks`, `medical_mode`, `domain`, and `sjr_max`.
- Study type filter values include `rct`, `systematic review`, `meta-analysis`, `literature review`, `non-rct observational study`, `non-rct experimental`, `non-rct in vitro`, `animal`, and `case report`.
- Tool result description says it returns paper titles, authors, abstracts, citation counts, journal quality scores, and direct URLs.

Product implication:

Consensus should be integrated as a remote MCP provider first, with direct REST `quick_search` as a second adapter when API-key access is available. The MCP endpoint is known:

```txt
https://mcp.consensus.app/mcp
```

The app still needs its own authentication flow. Supported implementation routes:

1. OAuth 2.1 / PKCE with Dynamic Client Registration, discovered from the Consensus MCP well-known endpoints.
2. User-provided bearer token for MCP enterprise access, if Consensus provides one through an account/API-key workflow.
3. Direct REST `GET https://api.consensus.app/v1/quick_search` using `x-api-key`, if the user has API-key access.
4. User-provided stdio MCP command, only as an advanced fallback.
5. Broader direct REST APIs, if Consensus provides additional official endpoint documentation later.

Broader direct Consensus REST API work should remain blocked by a concrete access requirement:

```txt
Need from user/vendor:
- additional official endpoint paths beyond /v1/quick_search
- rate limit and usage terms
- result schemas for those additional endpoints
- whether full-text chunks may be stored locally
- whether result snippets may be exported in reports
```

MCP work is not blocked by endpoint discovery anymore; it is blocked by implementing the OAuth/bearer auth flow and confirming account/license terms for desktop-app use. REST quick-search work is not blocked by endpoint discovery either; it is blocked by obtaining API-key access and confirming usage terms.

### 2.3 What this means for our APP

The app can connect to Scite and Consensus, but it must do so as an external-research client. Codex/Claude Code tool handles are not available inside the packaged Electron app.

The correct product boundary is:

- Our app remains the local citation-audit and writing desk.
- Scite contributes citation-network health, Smart Citation context, DOI-level metadata, editorial notices, and external full-text excerpts where available.
- Consensus contributes discovery and high-level evidence search for research questions, especially filters like study type, human studies, preprint exclusion, year range, and medical-mode search.
- External output never becomes gold data for our verifier. It is user-facing evidence context and import candidates.

### 2.4 Source-backed capability map

| Need in our APP | scite path | Consensus path | Product wording |
|---|---|---|---|
| "Is this cited paper safe to use?" | `/papers/{doi}`, `/tallies/{doi}`, `/tallies/aggregate`, editorial notices | Not the primary source | "Check this source's health" |
| "Do later papers support or push back?" | Smart Citation tallies and snippets through REST/MCP | Search results may show relevant papers but not citation polarity in observed schema | "Later papers support / push back / only mention it" |
| "Find papers outside my library" | `search_literature` MCP or `/api_partner/search` | `search` MCP tool or `GET /v1/quick_search` REST | "Search beyond my library" |
| "Read the paper enough to judge a claim" | DOI-targeted full-text excerpts through `search_literature` | `include_full_text_chunks` if available through MCP; REST quick search returns abstracts/takeaways | "Show relevant passages" |
| "Which studies are strongest?" | scite citation signals, paper type, journal metadata | study-type filters, human/sample/preprint filters, SJR/journal filters, citation counts | "Prefer stronger study types" |
| "Build a consensus-style answer" | possible through scite Assistant API, but should be gated | primary fit, based on observed Consensus search/filter surface | "Summarize what the literature says" |
| "Check my whole bibliography before submission" | scite Reference Check API or our own DOI/tally scan | secondary discovery for newer reviews/meta-analyses | "Pre-submission reference check" |

### 2.5 What Codex's current integration teaches us

The current Codex setup uses two different integration shapes:

1. Consensus is configured as a normal remote MCP server.
2. Scite is configured as a Codex App/plugin connector, and Codex Apps exposes the connector's tool schema into the model session.

Consensus evidence from local Codex config:

```toml
[mcp_servers.consensus]
enabled = true
url = "https://mcp.consensus.app/mcp"
```

Consensus lesson for our APP:

- This is directly useful. Our Electron worker can use the same `StreamableHTTPClientTransport` class already available in `@modelcontextprotocol/sdk`.
- The URL is known, so the hard problem is not endpoint discovery. The hard problem is OAuth/bearer credential handling, token refresh, and product UX for "connect Consensus."
- We should implement the MCP client generically, then ship Consensus as a prefilled provider:

```ts
const consensusDefaultRemoteMcp = {
  id: "consensus",
  label: "Consensus",
  transport: {
    kind: "streamable-http",
    url: "https://mcp.consensus.app/mcp",
    auth: {
      type: "oauth-pkce",
      resource: "https://mcp.consensus.app",
      scopes: ["search"],
    },
  },
  allowedTools: ["search"],
} satisfies ExternalMcpProviderConfig;
```

Scite evidence from local Codex plugin cache:

```json
{
  "apps": {
    "scite": {
      "id": "asdk_app_6952b3a3f1e881918951582d59483c78"
    }
  }
}
```

Scite tool schema evidence from Codex Apps cache:

- Tool name appears as `scite.search_literature` or `scite_search_literature` depending on the Codex tool surface.
- The tool is marked read-only.
- Tool metadata includes Codex Apps connector identifiers such as `connector_id`, `connector_name`, and `link_id`.
- Input keys include `term`, `dois`, `titles`, `limit`, `offset`, `title`, `abstract`, `author`, `journal`, `publisher`, `year`, `date_from`, `date_to`, `paper_type`, `affiliation`, `topic`, `has_tally`, `has_retraction`, `has_concern`, `has_correction`, `has_erratum`, and citation-count filters.

Scite lesson for our APP:

- Codex's Scite connection itself is not a reusable local MCP server. It is a Codex App connector bound to Codex's app/connector runtime.
- Our app should not attempt to call Codex Apps internals or depend on Codex Apps connector IDs.
- It is still useful as a product contract: the exact `search_literature` input model is a strong template for our own `SciteMcpAdapter`.
- For real runtime access outside Codex, prefer Scite's official endpoints already confirmed above:
  - REST/OpenAPI: `https://api.scite.ai/openapi.json`
  - MCP: `https://api.scite.ai/mcp`
  - MCP info: `https://api.scite.ai/mcp/info`
  - MCP health: `https://api.scite.ai/mcp/health`

Architecture implication:

Do not build "Consensus integration" and "Scite integration" as special one-off features. Build one `ExternalMcpClient` with:

- Streamable HTTP transport.
- OAuth PKCE + Dynamic Client Registration.
- Bearer token mode.
- Stdio transport for advanced local servers.
- Tool allowlists per provider.
- Provider-specific argument builders and result mappers.

Then configure:

- Consensus as `streamable-http` + `oauth-pkce` + `https://mcp.consensus.app/mcp` + allowed tool `search`.
- Consensus REST quick search as `https://api.consensus.app/v1/quick_search` + `x-api-key`, for enterprise/API-key users who want a simpler non-MCP integration path.
- Scite as either `streamable-http` + `scite-client-credentials` + `https://api.scite.ai/mcp` + allowed tool `search_literature`, or REST for DOI/tally/reference-health calls.

## 3. Current App Baseline

The current app already has the right foundation:

- `Check Draft`: paste a draft and audit citation-bearing sentences.
- `Check Claim`: enter one thesis and get a support / contradiction / insufficiency split.
- `My Library`: import local PDFs into a persistent SQLite library.
- `Checking Scope`: show sources currently used for checking.
- `Evidence Table`: export a matrix-like evidence view.
- `Quality Check`: run seed-set diagnostics and setup comparisons.
- Settings: local / cloud / Ollama provider choices, local model downloads, API keys in Electron safe storage.
- Headless core: `src/` remains Electron-free.
- MCP face: `src/mcp/server.ts` exposes the core through MCP tools.

Current limitation:

The app checks whether a claim is grounded in the current library. It does not yet help enough with reading, synthesis, paragraph construction, reference health, or discovering missing evidence outside the imported PDFs.

## 4. What To Borrow From scite And Consensus

### 4.1 From scite

Borrow the idea, not the whole product.

Useful scite-inspired capabilities:

- Citation context: show how later papers discuss a paper.
- Citation polarity: classify citation contexts as supporting, contrasting, or mentioning.
- Reference health: warn when a cited paper is retracted, corrected, under concern, heavily contradicted, or mostly only mentioned.
- DOI-first lookup: enrich local papers with external citation metadata.
- Access status: show whether full text is open, institutional, publisher-only, or paid.

How this should appear in our app:

- A paper card should include "How this paper is treated by later literature."
- A reference should get a risk label: "safe to cite," "needs careful wording," "contested," "retracted/corrected," or "not enough external signal."
- A draft sentence should show whether the source supports the user's sentence and whether the broader citation network pushes back.

### 4.2 From Consensus

Useful Consensus-inspired capabilities:

- Research-question search across a large paper corpus.
- Study Snapshot: structured summary of a paper's question, method, sample, findings, and limitations.
- Consensus Meter: high-level support / no / mixed distribution for a research question.
- Pro-style analysis: grouped evidence, key takeaways, and gaps.
- Document chat: ask questions over uploaded or selected papers.

How this should appear in our app:

- A research question should produce a local-library consensus report first.
- If external providers are enabled, the app can expand beyond the local library and suggest missing papers.
- Each imported paper should get a local Paper Snapshot.
- A literature-review paragraph should be checked for: missing citation, overclaim, weak evidence, unsupported causal wording, and contradicted claim.

## 5. Product Direction: Writing Desk

### 5.1 User Story

As a researcher writing a literature review, I want to paste a paragraph or ask a research question, and I want the app to tell me:

- Which claims are safe.
- Which claims need softer wording.
- Which claims need stronger or newer citations.
- Which papers in my library support or push back.
- Which external papers I should consider adding.
- How to rewrite the paragraph without making claims stronger than the evidence.

### 5.2 Main UI

Add a new first-class tab:

`Writing Desk`

Layout:

- Left: draft paragraph / research question input.
- Center: claim map.
- Right: evidence cards and rewrite suggestions.

Primary actions:

- `Analyze paragraph`
- `Find supporting evidence`
- `Find pushback`
- `Suggest safer rewrite`
- `Search external literature` (only visible when scite or Consensus is configured)
- `Add selected papers to library`

### 5.3 Output Model

For each paragraph, return:

```ts
interface WritingDeskReport {
  input: string;
  claims: WritingClaim[];
  paragraphSummary: {
    supported: number;
    needsCitation: number;
    overclaimed: number;
    contradicted: number;
    unclear: number;
  };
  suggestedParagraph?: string;
  externalSearches?: ExternalSearchRun[];
}

interface WritingClaim {
  id: string;
  text: string;
  sentenceIndex: number;
  claimType: "background" | "association" | "causal" | "comparison" | "method" | "limitation" | "definition";
  status: "supported" | "weakly_supported" | "needs_citation" | "overclaimed" | "contradicted" | "unclear";
  citedSources: string[];
  localEvidence: EvidenceCard[];
  externalEvidence: ExternalEvidenceCard[];
  riskNotes: string[];
  suggestedRewrite?: string;
}
```

## 6. Feature Roadmap

### Phase 1: Local Writing Desk MVP

Goal:

Make the current app materially more helpful for writing without needing any external provider.

Features:

- Paragraph analyzer: split paragraph into claims, not only citation mentions.
- Claim type detection: association vs causal vs descriptive vs limitation.
- Missing citation detection: flag uncited factual claims.
- Evidence map: group evidence by claim, not only by sentence.
- Safer rewrite: change wording only when the local evidence supports the change.
- Paper Snapshot: local PDF summary with method, sample, findings, limitations, and "best used to cite."

Files likely involved:

- `src/writing/claims.ts`
- `src/writing/report.ts`
- `src/writing/rewrite.ts`
- `src/writing/paper-snapshot.ts`
- `src/app/protocol.ts`
- `src/app/worker-runtime.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `electron/renderer/api.d.ts`
- `electron/renderer/tabs/WritingDesk.tsx`
- `electron/renderer/i18n.dict.ts`
- `tests/writing.*.test.ts`
- `tests/app.protocol.test.ts`

Acceptance criteria:

- User can paste a paragraph with mixed cited and uncited claims.
- App returns a claim map with at least: supported, needs citation, overclaimed, unclear.
- Suggested rewrite is always linked to evidence quotes.
- The feature works fully offline.
- No external API call is made unless an online provider is explicitly enabled.

### Phase 2: External Research Provider Abstraction

Goal:

Create one app-level contract that can support scite, Consensus, and future literature providers.

New core interface:

```ts
export interface ExternalResearchProvider {
  id: "scite" | "consensus" | string;
  label: string;
  capabilities: ExternalResearchCapability[];
  status(): Promise<ExternalProviderStatus>;
  searchPapers(input: ExternalPaperSearchInput): Promise<ExternalPaperSearchResult>;
  readPaper?(input: ExternalPaperReadInput): Promise<ExternalPaperReadResult>;
  getCitationContexts?(input: CitationContextInput): Promise<CitationContextResult>;
  getStudySnapshot?(input: StudySnapshotInput): Promise<StudySnapshotResult>;
}

export type ExternalResearchCapability =
  | "paper_search"
  | "paper_metadata"
  | "full_text_excerpts"
  | "citation_contexts"
  | "citation_polarity"
  | "editorial_notices"
  | "study_snapshot"
  | "consensus_meter";
```

Normalize provider output:

```ts
export interface ExternalPaper {
  provider: string;
  providerPaperId?: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  abstract?: string;
  url?: string;
  citationCount?: number;
  qualitySignals?: Record<string, unknown>;
}

export interface ExternalEvidenceCard {
  provider: string;
  paper: ExternalPaper;
  quote?: string;
  relation?: "supports" | "contradicts" | "mentions" | "unclear";
  section?: string;
  sourceDoi?: string;
  targetDoi?: string;
  editorialNotices?: EditorialNotice[];
  access?: ExternalAccessInfo;
}
```

Files likely involved:

- `src/external/types.ts`
- `src/external/provider-registry.ts`
- `src/external/cache.ts`
- `src/external/mcp-client.ts`
- `src/external/providers/scite.ts`
- `src/external/providers/consensus.ts`
- `src/providers/config.ts`
- `src/providers/keystore.ts`
- `electron/renderer/tabs/Settings.tsx`

Acceptance criteria:

- Settings can enable or disable each external provider.
- Provider credentials are stored using the same secret policy as current API keys.
- External results are cached with provider, query, timestamp, and provenance.
- A failed external provider call never blocks local-only analysis.

### Phase 3: scite Integration

Preferred adapter:

MCP client adapter, if the user has a scite MCP server configuration available outside Codex / Claude Code.

Reason:

The scite tool surface exposed in Agent environments already maps well to the app's needs: literature search, DOI/title lookup, full-text excerpts for open-access papers, Smart Citation snippets, supporting / contrasting / mentioning tallies, editorial notices, and access info.

Required app capabilities:

- Search by claim keywords.
- Search by DOI for an imported paper.
- Read full-text excerpts for a known DOI where available.
- Get Smart Citation contexts.
- Convert supporting / contrasting / mentioning into app evidence cards.
- Surface retractions, corrections, concerns, and access status.

Initial UI:

- `External signals` section on Paper Snapshot.
- `Citation network warning` section in Writing Desk.
- `Find pushback with scite` action.

Key limitation:

If scite's MCP server is only bundled inside a host Agent plugin and cannot be launched independently, the Electron app cannot call it directly. In that case, we need official API access or a user-provided MCP server command / URL.

### Phase 4: Consensus Integration

Preferred adapter:

Remote MCP client adapter against `https://mcp.consensus.app/mcp`, with OAuth PKCE or user-provided bearer-token authentication. Add direct REST `quick_search` adapter when API-key access is available.

Required app capabilities:

- Search external literature for a research question.
- Return ranked paper candidates.
- Pull structured study snapshots when available.
- Build an external consensus-style evidence distribution.
- Suggest missing papers for the user's local library.

Initial UI:

- `Search beyond my library` action in Writing Desk.
- `External literature candidates` panel.
- `Add to reading list` / `Import PDF manually` / `Open source page` actions.
- `External consensus` section that is visually separate from local-library consensus.

Key limitation:

Consensus results must be treated as external discovery and synthesis, not as ground truth for our local citation audit. The app should clearly label which conclusions come from the user's local library and which come from Consensus. Broader direct REST integration beyond `GET /v1/quick_search` remains unconfirmed; do not build additional REST endpoints without official documentation and terms.

### Phase 5: Reference Health

Goal:

Use local evidence and external provider signals to help users decide whether their bibliography is safe.

Checks:

- Source cited but claim not supported by its text.
- Source has external contrasting signals.
- Source has retraction / correction / concern notice.
- Source is old while newer systematic reviews or meta-analyses exist.
- Claim relies on one paper only.
- Causal language appears where evidence only supports association.
- The paragraph cites reviews where primary evidence is needed, or primary studies where synthesis is expected.

Output:

```ts
interface ReferenceHealthReport {
  sourceId: string;
  doi?: string;
  status: "ok" | "needs_care" | "risky" | "blocked";
  reasons: string[];
  localFindings: EvidenceCard[];
  externalSignals: ExternalEvidenceCard[];
  recommendedAction:
    | "keep"
    | "soften_wording"
    | "add_supporting_source"
    | "add_pushback_source"
    | "replace_source"
    | "do_not_cite";
}
```

## 7. How The App Should Connect To scite And Consensus

### 7.1 What We Should Not Do

Do not make the renderer call scite or Consensus directly.

Reasons:

- API keys would be too close to browser-facing code.
- Network errors and rate limits belong in the worker layer.
- The existing architecture keeps `src/` headless and Electron adapters thin.
- External calls must be traceable and redacted.

Do not assume Codex's current scite / Consensus tools are available to the Electron app.

Reasons:

- Codex and Claude Code own their MCP client session.
- Their plugin tools are not process-global services.
- Our Electron app must run its own MCP client or direct HTTP adapter.

### 7.2 Preferred Integration: App As MCP Client

Add a Node-side MCP client in the worker process.

Current repo support:

- `package.json` already depends on `@modelcontextprotocol/sdk`.
- `src/mcp/server.ts` proves the project can expose MCP tools to host agents.
- `tests/mcp.server.test.ts` already uses `Client` and `InMemoryTransport`, so the test stack can validate MCP protocol behavior without live external services.
- The SDK provides `Client` from `@modelcontextprotocol/sdk/client/index.js`.
- The SDK provides `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`; it spawns a server process using `command`, `args`, `env`, and `cwd`.
- The SDK provides `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`; it accepts a `URL`, optional `requestInit`, optional OAuth `authProvider`, optional custom `fetch`, and optional `sessionId`.
- `Client` supports `connect()`, `listTools()`, `callTool()`, and `ping()`.

Configuration:

```ts
export type ExternalMcpTransportConfig =
  | {
      kind: "stdio";
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      secretEnv?: Record<string, string>;
    }
  | {
      kind: "streamable-http";
      url: string;
      auth:
        | { type: "none" }
        | { type: "bearer"; tokenKeyRef: string }
        | { type: "oauth-pkce"; resource?: string; scopes: string[]; tokenKeyRef: string }
        | { type: "scite-client-credentials"; clientIdKeyRef: string; clientSecretKeyRef: string };
      headers?: Record<string, string>;
    };

export interface ExternalMcpProviderConfig {
  id: "scite" | "consensus";
  label: string;
  enabled: boolean;
  transport: ExternalMcpTransportConfig;
  allowedTools: string[];
}
```

Default scite MCP config shape:

```ts
const sciteMcpConfig: ExternalMcpProviderConfig = {
  id: "scite",
  label: "scite",
  enabled: true,
  transport: {
    kind: "streamable-http",
    url: "https://api.scite.ai/mcp",
    auth: {
      type: "scite-client-credentials",
      clientIdKeyRef: "external.scite.clientId",
      clientSecretKeyRef: "external.scite.clientSecret",
    },
  },
  allowedTools: ["search_literature"],
};
```

Default Consensus MCP config shape:

```ts
const consensusMcpConfig: ExternalMcpProviderConfig = {
  id: "consensus",
  label: "Consensus",
  enabled: true,
  transport: {
    kind: "streamable-http",
    url: "https://mcp.consensus.app/mcp",
    auth: {
      type: "oauth-pkce",
      resource: "https://mcp.consensus.app",
      scopes: ["search"],
      tokenKeyRef: "external.consensus.oauth",
    },
  },
  allowedTools: ["search"],
};
```

The app may prefill the Consensus URL, but it must not attempt live calls until the user completes OAuth or stores a valid provider token.

User flow:

1. User opens Settings.
2. User adds scite / Consensus provider.
3. User chooses MCP transport:
   - Local command, for stdio MCP servers.
   - Remote URL, for streamable HTTP MCP servers.
4. User stores token or API key in safe storage.
5. App tests provider status by listing tools and running a small non-writing query.
6. Writing Desk shows external actions only when provider status is connected.

Security:

- External provider calls require explicit enablement.
- The app shows what text will be sent out.
- API keys never enter traces, config files, renderer state snapshots, or exported reports.
- External result cache stores metadata and excerpts, but never the provider token.
- Provider failures are shown as recoverable warnings.
- The worker rejects any tool call whose name is not in `allowedTools`.
- The renderer never receives full provider credentials, access tokens, or raw OAuth state.
- The worker passes only extracted claims or DOI/title identifiers by default, not the whole draft.
- Live-provider smoke tests are opt-in through environment variables and are not part of normal CI.
- OAuth tokens are stored under provider-scoped secret refs and refreshed in the worker, not in renderer state.

MCP client lifecycle:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function connectExternalMcpProvider(config: ExternalMcpProviderConfig, secrets: ExternalSecretResolver): Promise<ConnectedExternalMcpProvider> {
  const client = new Client({ name: "d-academic-agent-app", version: "0.1.0" });
  const transport = await createExternalTransport(config.transport, secrets);
  await client.connect(transport);
  const listed = await client.listTools();
  const listedToolNames = new Set(listed.tools.map((tool) => tool.name));
  for (const allowed of config.allowedTools) {
    if (!listedToolNames.has(allowed)) throw new Error(`External provider ${config.id} is missing required tool: ${allowed}`);
  }
  return { id: config.id, client, transport, allowedTools: new Set(config.allowedTools) };
}

export async function callAllowedExternalTool(provider: ConnectedExternalMcpProvider, name: string, arguments_: unknown): Promise<unknown> {
  if (!provider.allowedTools.has(name)) throw new Error(`External tool is not enabled for this provider: ${name}`);
  return provider.client.callTool({ name, arguments: arguments_ });
}
```

### 7.3 scite Direct REST Adapter

Direct API adapters are useful when official API contracts are confirmed. scite meets that bar for a first implementation.

Config shape:

```ts
interface ExternalHttpProviderConfig {
  id: "scite" | "consensus";
  baseURL: string;
  auth:
    | { type: "bearer"; keyRef: string }
    | { type: "api-key-header"; header: string; keyRef: string }
    | { type: "none" };
}
```

Direct API adapter responsibilities:

- Validate response schemas with zod.
- Normalize result shapes into `ExternalPaper` and `ExternalEvidenceCard`.
- Respect rate limits and retry-after headers.
- Cache query results.
- Preserve raw provider payload only in debug mode, redacted.

Recommended scite REST calls:

| App operation | Endpoint | Authentication | Notes |
|---|---|---|---|
| DOI metadata enrichment | `GET /papers/{doi}` | optional/beneficial bearer | Use immediately after PDF import when DOI is known. |
| Single-source citation health | `GET /tallies/{doi}` | optional/beneficial bearer | Maps to support/pushback/mention counts. |
| Batch bibliography health | `POST /tallies/aggregate` | optional/beneficial bearer | Use up to 100 DOIs per request. |
| External search | `GET /api_partner/search` | bearer recommended | Good direct fallback if MCP is unavailable. |
| Citation statements | `GET /api_partner/citations/citing/{doi}` | special token access | Gate behind capability check. |
| References to/from paper | `/api_partner/references/*` | token access | Useful for bibliography graph later. |
| Whole-document reference check | `POST /reference_check` then poll task | token access | Later milestone, not MVP. |

scite REST mapping:

```ts
interface SciteTally {
  total: number;
  supporting: number;
  contradicting: number;
  mentioning: number;
  unclassified: number;
  doi?: string | null;
  citingPublications?: number | null;
}

interface ReferenceExternalSignal {
  provider: "scite" | "consensus" | string;
  doi?: string;
  supportCount?: number;
  pushbackCount?: number;
  mentionCount?: number;
  unclassifiedCount?: number;
  citingPublicationCount?: number;
  risk: "ok" | "needs_care" | "risky" | "blocked" | "unknown";
}

function mapSciteTallyToReferenceSignal(tally: SciteTally): ReferenceExternalSignal {
  const totalClassified = tally.supporting + tally.contradicting + tally.mentioning;
  return {
    provider: "scite",
    doi: tally.doi ?? undefined,
    supportCount: tally.supporting,
    pushbackCount: tally.contradicting,
    mentionCount: tally.mentioning,
    unclassifiedCount: tally.unclassified,
    citingPublicationCount: tally.citingPublications ?? undefined,
    risk:
      tally.contradicting > 0 && tally.contradicting / Math.max(totalClassified, 1) >= 0.2
        ? "needs_care"
        : "ok",
  };
}
```

### 7.4 Consensus MCP And Quick-Search REST Adapters

Consensus has two confirmed implementation surfaces:

1. Remote MCP at `https://mcp.consensus.app/mcp`, best for Agent-style search and OAuth sign-in.
2. Direct REST quick search at `GET https://api.consensus.app/v1/quick_search`, best for API-key customers who want a simpler non-MCP integration path.

Broader direct REST work should not start until additional official endpoint contracts are supplied.

MCP authentication:

- The endpoint advertises OAuth through `WWW-Authenticate`.
- Protected resource metadata is available at `https://mcp.consensus.app/.well-known/oauth-protected-resource`.
- Authorization server metadata is available at `https://mcp.consensus.app/.well-known/oauth-authorization-server`.
- The app should support OAuth authorization code with PKCE `S256`, Dynamic Client Registration, refresh tokens, and scope `search`.
- As an advanced fallback, the app may support a user-provided bearer token.

MCP expected tool call:

```ts
interface ConsensusSearchArguments {
  query: string;
  year_min?: number;
  year_max?: number;
  study_types?: Array<
    | "case report"
    | "literature review"
    | "meta-analysis"
    | "non-rct in vitro"
    | "rct"
    | "systematic review"
    | "non-rct experimental"
    | "non-rct observational study"
    | "animal"
  >;
  human?: boolean;
  sample_size_min?: number;
  duration_min?: number;
  duration_max?: number;
  journal_name?: string;
  publisher_name?: string;
  exclude_preprints?: boolean;
  include_full_text_chunks?: boolean;
  medical_mode?: boolean;
  domain?: string;
  sjr_max?: 1 | 2 | 3 | 4;
}
```

REST expected request:

```ts
interface ConsensusQuickSearchRequest {
  query: string;
  year_min?: number;
  year_max?: number;
  study_types?: Array<
    | "case report"
    | "literature review"
    | "meta-analysis"
    | "non-rct experimental"
    | "non-rct in vitro"
    | "non-rct observational study"
    | "rct"
    | "systematic review"
    | "animal"
  >;
  human?: boolean;
  sample_size_min?: number;
  sjr_max?: 1 | 2 | 3 | 4;
  duration_min?: number;
  duration_max?: number;
  exclude_preprints?: boolean;
  publisher_name?: string;
  clinical_guideline?: boolean;
  medical_mode?: boolean;
}
```

REST authentication:

- Use `x-api-key` header.
- Store the API key through the same provider-scoped safe-storage path as other external secrets.
- Treat `403 {"detail":"Not authenticated"}` as a recoverable setup error, not as a provider outage.

Default app policy:

- For ordinary writing support, send `query` only unless the user asks for a constrained search.
- For medical or clinical writing, default to `medical_mode: true` and `exclude_preprints: true` only after the UI makes that choice visible.
- For "strongest evidence" searches, use study-type filters in this order: `systematic review`, `meta-analysis`, `rct`.
- Do not use `include_full_text_chunks` by default. Ask through Settings whether external full-text snippets may be cached.

Consensus result mapping:

```ts
interface ConsensusPaperLike {
  title: string;
  authors?: string[];
  abstract?: string;
  year?: number;
  journal?: string;
  citationCount?: number;
  journalQualityScore?: number;
  studyType?: string;
  takeaway?: string;
  url?: string;
}

function mapConsensusPaperToExternalPaper(input: ConsensusPaperLike): ExternalPaper {
  return {
    provider: "consensus",
    title: input.title,
    authors: input.authors ?? [],
    year: input.year,
    journal: input.journal,
    abstract: input.abstract,
    url: input.url,
    citationCount: input.citationCount,
    qualitySignals: {
      journalQualityScore: input.journalQualityScore,
      studyType: input.studyType,
      takeaway: input.takeaway,
    },
  };
}
```

### 7.5 Manual Import Fallback

If API / MCP access is unavailable:

- Allow users to paste DOI lists or BibTeX/RIS exports from scite / Consensus.
- Let users manually add external paper metadata to a reading list.
- Keep this separate from "audited local library" until the user imports full text or PDF.

## 8. UX Copy Rules

Use user-facing language:

- Say "Search beyond my library," not "external provider query."
- Say "Later papers push back," not "contrasting citation tally."
- Say "This source needs careful wording," not "citation polarity conflict."
- Say "This result came from Consensus/scite online," not "provider-derived external signal."
- Say "This is not in your local library yet," not "not indexed."

Always separate:

- Local library evidence.
- External discovery results.
- AI-generated rewrite suggestions.

## 9. Evaluation And Safety

Do not use scite or Consensus output as gold labels.

Allowed:

- External signals can inform user-facing warnings.
- External papers can become candidates for import.
- External snippets can be shown with provider provenance.
- External provider coverage can be measured as product telemetry in local eval fixtures.

Not allowed:

- Do not mark our verifier correct just because scite or Consensus agrees.
- Do not silently replace local evidence with external summaries.
- Do not send full draft text externally by default.
- Do not hide paywalled or institutional access constraints.

Test strategy:

- Unit-test provider mappers with recorded, redacted fixtures.
- Unit-test schema validation for malformed provider responses.
- Integration-test MCP client with an in-memory fake MCP server.
- End-to-end-test Writing Desk with external providers disabled.
- Add a manual smoke script for real provider calls, gated by environment variables.

Example gated commands:

```sh
SCITE_MCP_TEST=1 npm run test -- tests/external.scite-live.test.ts
CONSENSUS_MCP_TEST=1 npm run test -- tests/external.consensus-live.test.ts
```

## 10. Implementation Milestones

### Milestone A: Writing Desk local MVP

Deliverables:

- New Writing Desk tab.
- Paragraph-to-claim parser.
- Claim map.
- Local evidence cards.
- Evidence-grounded rewrite suggestions.
- Local Paper Snapshot.

Exit criteria:

- Works offline.
- No external provider required.
- Existing draft audit remains unchanged.

### Milestone B: External provider foundation

Deliverables:

- `ExternalResearchProvider` interfaces.
- Provider registry.
- MCP client transport.
- Safe-storage credential plumbing.
- Settings UI for external providers.
- Fake-provider tests.

Exit criteria:

- App can connect to a fake MCP server.
- App can list provider capabilities.
- App can run one search and normalize results.

### Milestone C: scite adapter

Deliverables:

- scite MCP adapter.
- DOI lookup for imported papers.
- Citation context normalization.
- Editorial notice and access status display.
- Reference Health warnings using scite signals.

Exit criteria:

- With scite configured, a known DOI can show external citation contexts.
- Without scite configured, the UI stays local-only and clean.

### Milestone D: Consensus adapter

Deliverables:

- Consensus MCP or API adapter.
- External literature search.
- Study snapshot normalization.
- Consensus-style distribution for research questions.
- Add-to-reading-list workflow.

Exit criteria:

- With Consensus configured, a research question returns external candidate papers.
- External results are clearly separate from local audited evidence.

### Milestone E: Submission-prep Reference Health

Deliverables:

- Full-bibliography scan.
- Risk labels.
- Missing-source recommendations.
- Exportable pre-submission report.

Exit criteria:

- User can paste a draft and get a checklist of reference risks before submission.

## 11. Open Questions

1. Are scite / Consensus credentials licensed for use inside a separate desktop app?
2. Should the app implement full OAuth PKCE sign-in for Consensus in MVP, or start with a user-provided bearer token for developer builds?
3. Should external providers receive full draft paragraphs, or only extracted claims?
4. Should the first MVP expose external search in the UI, or keep it behind an Advanced switch?
5. Should external results be importable into the local SQLite library, or live in a separate reading-list table until the user imports PDFs?
6. Does Consensus provide official REST endpoint contracts beyond the confirmed `GET /v1/quick_search` endpoint?

Recommended answers for now:

1. Build the adapter around MCP first for users who connect through OAuth-capable Agent-style flows.
2. Add direct Consensus REST quick search when the user provides an API key; treat broader REST APIs as optional until additional contracts are confirmed.
3. Implement Consensus as known remote MCP plus OAuth/bearer auth, plus `GET /v1/quick_search` with `x-api-key`.
4. Send extracted claims by default, not full drafts.
5. Keep external search behind an explicit online-provider switch.
6. Keep external papers in a separate reading list until full text is imported.

## 12. Concrete Next Task

Start with Milestone A and B together only at the interface boundary:

1. Implement local Writing Desk using existing local library and checker.
2. Add `ExternalResearchProvider` types and fake provider tests, but do not ship live scite / Consensus calls in the first PR.
3. Add Settings copy that explains external providers are optional online research sources.
4. Implement one live provider adapter at a time: scite first through confirmed REST/MCP credentials, then Consensus through the confirmed remote MCP endpoint and REST quick-search API.

This keeps the product useful immediately and prevents the release from depending on external accounts, rate limits, or undocumented schemas.

## 13. Detailed External Integration Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add app-level external research integration so the packaged Electron app can call scite and Consensus providers from the worker process, while keeping local citation checking usable offline.

**Architecture:** Add an `src/external/` module that owns provider types, provider registry, MCP client lifecycle, direct scite REST calls, Consensus quick-search REST calls, response mapping, and cache policy. Electron renderer only configures providers and requests actions through existing app protocol boundaries; it never receives external credentials.

**Tech Stack:** TypeScript, zod, `@modelcontextprotocol/sdk`, Electron `safeStorage` through the existing keystore pattern, Vitest, in-memory MCP test transport, optional live smoke tests gated by environment variables.

### 13.1 File Structure

- Create `src/external/types.ts`: shared external provider types, normalized paper/result/evidence types, capability enum, and safe outbound request shape.
- Create `src/external/provider-registry.ts`: enabled-provider registry and capability lookup.
- Create `src/external/mcp-client.ts`: MCP client construction for stdio and streamable HTTP transports, `listTools`, `ping`, and allowed-tool call wrapper.
- Create `src/external/oauth.ts`: OAuth PKCE, Dynamic Client Registration, refresh-token storage, and browser redirect handling for remote MCP providers.
- Create `src/external/providers/scite-auth.ts`: scite client-credentials token exchange, in-memory token cache, and expiry handling.
- Create `src/external/providers/scite-rest.ts`: REST calls for `/papers/{doi}`, `/tallies/{doi}`, `/tallies/aggregate`, and `/api_partner/search`.
- Create `src/external/providers/scite-mcp.ts`: `search_literature` call builder and mapper.
- Create `src/external/providers/consensus-mcp.ts`: OAuth-aware `search` call builder and mapper for the confirmed Consensus remote MCP server.
- Create `src/external/providers/consensus-rest.ts`: `GET /v1/quick_search` call builder and mapper for the confirmed Consensus REST quick-search API.
- Create `src/external/cache.ts`: query cache keys, redacted cache record shape, TTL policy, and cache invalidation helpers.
- Modify `src/providers/config.ts`: add non-secret external provider config schema.
- Modify `src/providers/keystore.ts`: support named external secret refs if the current key-value interface is too narrow for `client_id` plus `client_secret`.
- Modify `src/app/protocol.ts`: add worker messages for provider status, provider test, external search, DOI enrichment, citation health, and reading-list import.
- Modify `src/app/worker-runtime.ts`: own provider lifecycle, secret resolution, redaction, and recoverable external-provider errors.
- Modify `electron/main.ts`: persist external provider config and save external provider secrets through the existing keystore path.
- Modify `electron/preload.ts` and `electron/renderer/api.d.ts`: expose typed external-provider calls without exposing credentials.
- Modify `electron/renderer/tabs/Settings.tsx`: add external research provider setup and connection test.
- Modify the new Writing Desk tab when it exists: show `Search beyond my library`, `Check source health`, and `Find pushback` only when provider capabilities are connected.
- Test `tests/external.types.test.ts`: config parsing and outbound request redaction.
- Test `tests/external.mcp-client.test.ts`: fake MCP server, tool allowlist, auth failure behavior, provider status mapping.
- Test `tests/external.scite-mappers.test.ts`: recorded scite REST/MCP fixtures map to normalized evidence cards.
- Test `tests/external.consensus-mappers.test.ts`: recorded Consensus MCP and REST quick-search fixtures map to normalized papers and quality signals.
- Test `tests/app.external-protocol.test.ts`: renderer-to-worker calls do not expose secrets and provider failures do not block local audit.

### 13.2 Task 1: External Types And Config

- [ ] Create `src/external/types.ts` with these core interfaces:

```ts
export type ExternalProviderId = "scite" | "consensus";

export type ExternalResearchCapability =
  | "paper_search"
  | "paper_metadata"
  | "full_text_excerpts"
  | "citation_contexts"
  | "citation_polarity"
  | "editorial_notices"
  | "study_snapshot"
  | "consensus_meter"
  | "reference_health";

export interface ExternalPaper {
  provider: ExternalProviderId;
  providerPaperId?: string;
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  abstract?: string;
  url?: string;
  citationCount?: number;
  qualitySignals?: Record<string, unknown>;
}

export interface ExternalEvidenceCard {
  provider: ExternalProviderId;
  paper: ExternalPaper;
  quote?: string;
  relation?: "supports" | "contradicts" | "mentions" | "unclear";
  section?: string;
  sourceDoi?: string;
  targetDoi?: string;
  editorialNotices?: Array<{ status?: string; date?: string; noticeDoi?: string; urls?: string[] }>;
  access?: { url?: string; source?: string; accessType?: string; contentType?: string; description?: string };
}

export interface ExternalProviderStatus {
  id: ExternalProviderId;
  enabled: boolean;
  connected: boolean;
  capabilities: ExternalResearchCapability[];
  message?: string;
}
```

- [ ] Modify `src/providers/config.ts` so `AppConfigSchema` adds an `externalResearch` field with a default empty provider list:

```ts
export const ExternalMcpProviderConfigSchema = z.object({
  id: z.enum(["scite", "consensus"]),
  label: z.string(),
  enabled: z.boolean(),
  allowedTools: z.array(z.string()).min(1),
  transport: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
      secretEnv: z.record(z.string()).optional(),
    }),
    z.object({
      kind: z.literal("streamable-http"),
      url: z.string().url(),
      auth: z.discriminatedUnion("type", [
        z.object({ type: z.literal("none") }),
        z.object({ type: z.literal("bearer"), tokenKeyRef: z.string().min(1) }),
        z.object({
          type: z.literal("oauth-pkce"),
          resource: z.string().url().optional(),
          scopes: z.array(z.string()).min(1),
          tokenKeyRef: z.string().min(1),
        }),
        z.object({
          type: z.literal("scite-client-credentials"),
          clientIdKeyRef: z.string().min(1),
          clientSecretKeyRef: z.string().min(1),
        }),
      ]),
      headers: z.record(z.string()).optional(),
    }),
  ]),
});

export const ExternalHttpProviderConfigSchema = z.object({
  id: z.enum(["scite", "consensus"]),
  label: z.string(),
  enabled: z.boolean(),
  baseURL: z.string().url(),
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), tokenKeyRef: z.string().min(1) }),
    z.object({
      type: z.literal("api-key-header"),
      header: z.string().min(1),
      keyRef: z.string().min(1),
    }),
  ]),
  capabilities: z.array(z.string()).default([]),
});

export const ExternalResearchConfigSchema = z.object({
  mcpProviders: z.array(ExternalMcpProviderConfigSchema).default([]),
  httpProviders: z.array(ExternalHttpProviderConfigSchema).default([]),
});
```

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test -- tests/providers.config.test.ts`.

### 13.3 Task 2: MCP Client Foundation

- [ ] Create `tests/external.mcp-client.test.ts` with a fake MCP server that exposes one read-only tool named `search`.
- [ ] Test that `connectExternalMcpProvider()` lists tools and marks the provider connected.
- [ ] Test that `callAllowedExternalTool()` rejects a tool not listed in `allowedTools`.
- [ ] Create `src/external/mcp-client.ts` using `Client`, `StdioClientTransport`, and `StreamableHTTPClientTransport`.
- [ ] Implement bearer auth by injecting `Authorization: Bearer <token>` in `requestInit.headers`.
- [ ] Implement OAuth PKCE auth by wiring `StreamableHTTPClientTransport` with an `OAuthClientProvider`.
- [ ] Persist OAuth client registration, access token, refresh token, and expiry under provider-scoped secret refs.
- [ ] Discover OAuth metadata from the MCP `WWW-Authenticate` resource metadata URL when not preconfigured.
- [ ] Implement scite client-credentials auth by calling `resolveSciteBearerToken()` before creating the HTTP transport.
- [ ] Run `npm test -- tests/external.mcp-client.test.ts`.
- [ ] Run `npm run typecheck`.

### 13.4 Task 3: scite REST Adapter

- [ ] Create recorded, redacted fixtures under `tests/fixtures/external/scite/`:
  - `paper.json`
  - `tally.json`
  - `aggregate-tally.json`
  - `search.json`
- [ ] Create `tests/external.scite-mappers.test.ts` to assert:
  - `contradicting` maps to `pushbackCount`.
  - `supporting` maps to `supportCount`.
  - editorial notice `status` maps into `ExternalEvidenceCard.editorialNotices`.
  - DOI/title/year/journal/authors survive normalization.
- [ ] Create `src/external/providers/scite-auth.ts` with:
  - `exchangeSciteClientCredentials(clientId, clientSecret)`.
  - `resolveSciteBearerToken(secretResolver)`.
  - token expiry handling that refreshes before the documented 2-hour expiry.
- [ ] Create `src/external/providers/scite-rest.ts` with:
  - `getScitePaper(doi)`.
  - `getSciteTally(doi)`.
  - `getSciteAggregateTallies(dois)`.
  - `searchScitePapers(input)`.
- [ ] Validate every response with zod before mapping.
- [ ] Run `npm test -- tests/external.scite-mappers.test.ts`.
- [ ] Run `npm run typecheck`.

### 13.5 Task 4: scite MCP Adapter

- [ ] Create fixture `tests/fixtures/external/scite/search-literature-result.json` using the observed shape: `hits`, `tally`, `fulltextExcerpts`, `access`, `citations`, and `editorialNotices`.
- [ ] Create mapper tests for:
  - Smart Citation `type: "supporting"` -> `relation: "supports"`.
  - Smart Citation `type: "contrasting"` or REST `contradicting` -> `relation: "contradicts"`.
  - `access.accessType` is preserved.
  - no full draft text appears in the outbound arguments fixture.
- [ ] Create `src/external/providers/scite-mcp.ts` with:
  - `buildSciteSearchLiteratureArgs(input)`.
  - `mapSciteSearchLiteratureResult(result)`.
  - `searchSciteLiterature(provider, input)`.
- [ ] Run `npm test -- tests/external.scite-mappers.test.ts tests/external.mcp-client.test.ts`.

### 13.6 Task 5: Consensus MCP And REST Quick-Search Adapters

- [ ] Create fixture `tests/fixtures/external/consensus/search-result.json` from live Consensus MCP output once OAuth or bearer access is available. Before live access, create a synthetic fixture that matches the observed tool description: title, authors, abstract, year, journal, citation count, journal quality score, and URL.
- [ ] Create fixture `tests/fixtures/external/consensus/quick-search-result.json` from the documented `QuickSearchResponse` shape: `results[]` with title, authors, abstract, DOI, journal name, publish year, URL, citation count, study type, and takeaway.
- [ ] Create `tests/external.consensus-mappers.test.ts` to assert:
  - `query` is the only default outbound field.
  - study-type filters are passed only when explicitly requested by the UI/action.
  - `exclude_preprints` is visible in the outbound arguments when medical mode is enabled.
  - citation count and journal quality are preserved as `qualitySignals`.
  - REST `study_type` and `takeaway` survive normalization.
  - REST auth errors are shown as setup errors and never include the user's API key.
- [ ] Create `src/external/providers/consensus-mcp.ts` with:
  - `buildConsensusSearchArgs(input)`.
  - `mapConsensusSearchResult(result)`.
  - `searchConsensus(provider, input)`.
- [ ] Create `src/external/providers/consensus-rest.ts` with:
  - `buildConsensusQuickSearchUrl(input)`.
  - `searchConsensusQuickSearch(input, apiKey)`.
  - `mapConsensusQuickSearchResult(result)`.
  - zod validation for `QuickSearchResponse`.
- [ ] Use `https://mcp.consensus.app/mcp` as the default remote MCP URL.
- [ ] Use `https://api.consensus.app/v1/quick_search` as the only confirmed direct Consensus REST URL.
- [ ] Use `x-api-key` for Consensus REST quick-search authentication.
- [ ] Do not add or infer broader Consensus REST endpoints until their official schemas and terms are documented.
- [ ] Run `npm test -- tests/external.consensus-mappers.test.ts`.

### 13.7 Task 6: Worker Protocol And Settings UI

- [ ] Add protocol requests in `src/app/protocol.ts`:
  - `external_provider_status`.
  - `external_provider_test`.
  - `external_search_papers`.
  - `external_enrich_doi`.
  - `external_reference_health`.
- [ ] Implement handlers in `src/app/worker-runtime.ts`.
- [ ] Ensure every handler returns `{ ok: false, error: string }` on provider failure and never throws past the worker boundary for recoverable external failures.
- [ ] Add Settings UI fields:
  - provider enable switch.
  - provider kind: scite or Consensus.
  - transport: remote MCP URL or local command.
  - auth mode: OAuth sign-in, scite client credentials, bearer token, or none.
  - connection test button.
  - short copy explaining that external providers send selected claims or DOI/title data online.
- [ ] Run `npm test -- tests/app.external-protocol.test.ts tests/i18n.dict.test.ts`.
- [ ] Run `npm run typecheck`.

### 13.8 Task 7: Live Smoke Tests

- [ ] Add `tests/external.scite-live.test.ts`, skipped unless all of these are present:
  - `SCITE_LIVE_TEST=1`
  - `SCITE_CLIENT_ID`
  - `SCITE_CLIENT_SECRET`
- [ ] Scite smoke assertions:
  - `GET /mcp/health` returns healthy before credentialed tool call.
  - token exchange succeeds.
  - `tools/list` includes `search_literature`.
  - a DOI metadata or tally call returns a DOI-matched response.
- [ ] Add `tests/external.consensus-live.test.ts`, skipped unless all of these are present:
  - `CONSENSUS_LIVE_TEST=1`
  - at least one of `CONSENSUS_MCP_BEARER_TOKEN`, a test OAuth fixture token set, or `CONSENSUS_API_KEY`
- [ ] Consensus smoke assertions:
  - MCP path, when token/OAuth fixture is present: `tools/list` includes `search`.
  - MCP path, when token/OAuth fixture is present: a minimal query returns at least one paper-like result.
  - REST path, when `CONSENSUS_API_KEY` is present: `GET /v1/quick_search` with `x-api-key` returns at least one result for a harmless query.
  - provider errors are redacted and do not include bearer tokens.
  - provider errors are redacted and do not include API keys.
- [ ] Live smoke command for scite:

```sh
SCITE_LIVE_TEST=1 npm test -- tests/external.scite-live.test.ts
```

- [ ] Live smoke command for Consensus:

```sh
CONSENSUS_LIVE_TEST=1 npm test -- tests/external.consensus-live.test.ts
```

### 13.9 Release Gate

Before packaging a build that exposes these integrations:

- [ ] `npm test`.
- [ ] `npm run typecheck`.
- [ ] `npm run lint`.
- [ ] Manual Settings smoke: add disabled provider, enable provider, run test connection, disable provider.
- [ ] Manual Writing Desk smoke with external providers disabled: local analysis still works.
- [ ] Manual Writing Desk smoke with scite enabled: "Search beyond my library" returns external results or a recoverable auth/rate-limit warning.
- [ ] Manual packaged-app smoke, not only dev mode.

The feature is not ready if any of these are true:

- A provider token appears in a trace, renderer state, exported report, cache file, or error message.
- Consensus is hard-coded to any REST URL other than the confirmed `GET /v1/quick_search` endpoint, or to any non-official MCP URL instead of `https://mcp.consensus.app/mcp`.
- External search is required for local Writing Desk analysis.
- External output is treated as gold for eval or citation-check correctness.
