# Plans — the per-milestone design + review record

**These are point-in-time documents, not current-state docs.** For what the system does *now*, see the
top-level [`README.md`](../../README.md) and the short implementation snapshot in
[`docs/CURRENT_STATE.md`](../CURRENT_STATE.md). Each file here is the plan that was authored, **reviewed by Codex
in a fresh thread, iterated to GO, then implemented and gated** before merge — the executable trace of this
project's Claude↔Codex collaboration (plan → review → implement → verify → milestone-gate → merge). They are
kept as a record; they describe intent at the time, and later milestones sometimes supersede earlier scope.

## The arc

**Core harness**
- `2026-06-22-M0-corpus-and-resolver` · `M1-retrieval-checker-eval` · `M2-mcp-planner-dx` · `M3-electron-hero-app`
- `2026-06-23-M4-coevolution-pdf-tabs`
- `2026-06-23-M5-providerization-self-use` (+ `M5c-persistent-library-pdf`, `M5d-judges-ablation-packaging`)
- `2026-06-23-M6a…M6e` — eval depth · agent-loop checker · plan→check map · policy_compliance · thesis consensus
- `2026-06-23-M7-ui-revamp` — the "Reading Room" UI

**Writing Desk + external research** (parent: `2026-06-26-writing-desk-and-external-research-integrations`)
- `2026-06-27-M-A-writing-desk-local-mvp` — local claim analysis + safer-wording
- `2026-06-27-M-B-external-provider-foundation` — types · KeyRef config · registry · MCP client wrapper
- `2026-06-27-M-C-scite-adapter` · `M-D-consensus-adapter` — the REST/MCP adapters (capture-first, fixture-tested)
- `2026-06-27-M-wire-external-search` — surface external search in-app (provider factory + worker + Settings + Library)
- `2026-06-27-M-E-reference-health` — scite reference health on **search results**
- `2026-06-27-M-F-library-reference-health` — DOI capture + check **imported papers** vs scite
- `2026-06-27-M-G-bibliography-reference-health` — check a paper's **cited references** vs scite
- `2026-06-27-M-H-mcp-oauth-pkce` — reusable OAuth 2.1 PKCE + DCR sign-in for OAuth-gated MCPs
- `2026-06-27-M-I-writing-desk-external-evidence` — per-claim "find external evidence" in the Writing Desk

Each plan's `## Resolutions` / milestone-review section records the Codex findings folded in before GO.
