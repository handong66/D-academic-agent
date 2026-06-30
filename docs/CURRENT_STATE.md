# Current State Snapshot

Last updated: 2026-06-30

This document is the short, code-backed status snapshot for the repository. Historical design docs and plans are
kept for traceability, but the top-level `README.md` and this file describe the current system.

## Product Shape

D-academic-agent is a local-first evidence-checking harness for academic literature workflows. It has:

- A pure TypeScript headless core in `src/`.
- An Electron desktop adapter in `electron/`.
- An MCP stdio adapter in `src/mcp/`.
- A seed corpus, frozen source lock, and human-labeled gold claims in `fixtures/`.

The main user-facing workspace is Reading Room, with tabs for draft citation audit, claim checking, writing-desk claim
analysis, checking scope, library import/search, evidence tables, quality checks, and settings.

## Implemented Capabilities

- Citation audit over draft prose with resolved citations, structured locators, quotes, verdicts, confidence,
  suggested rewrites, and separate corpus counter-evidence.
- Thesis/claim review through plan -> retrieve -> judge -> report.
- Writing Desk local claim splitting, claim typing, missing-citation and overclaim flags, safer wording, and
  per-claim external evidence search when enabled.
- Hybrid retrieval with lexical and dense search fused by reciprocal-rank fusion.
- Local persistent library with PDF import, DOI capture, source/chunk persistence, and re-indexing.
- PDF parsing through `unpdf` by default and optional GROBID for section/reference extraction.
- Providerized embedders, judges, PDF parsers, external scholarly search, and key-reference based configuration.
- External research adapters for scite, Consensus REST, and OAuth-gated Consensus MCP.
- scite reference-health checks for external search results, imported papers, and GROBID-parsed bibliographies.
- MCP tools for search, fulltext, citation extraction, claim checking, matrix building, and seed eval.
- Evaluation reports with per-class metrics, macro-F1, confusion matrices, groundedness/policy signals, failures,
  and replayable trace events.

## Entrypoints

```sh
npm start
npm run harness -- eval --mock --out out/eval-mock
npm run harness -- replay --trace out/eval-mock/trace.jsonl
npm run harness -- plan --mock --q "social media and adolescent depression"
npm run harness -- drill --out out/drill
npm run harness -- coevo --mock --out out/coevo
npm run harness -- mcp
```

## Verification Gates

Use these before merging or publishing documentation that claims the current implementation state:

```sh
npm test
npm run typecheck
npm run lint
```

For app-facing smoke:

```sh
npm run acceptance
```

For packaging:

```sh
npm run package
```

Live scite, Consensus REST, Consensus MCP, OAuth browser, and remote model checks are intentionally gated by user
credentials and environment. Do not present them as verified unless those live credentials were supplied for the
specific run.

## Non-Goals

The project does not implement one-click paper generation, AI-detection evasion, LMS/teacher workflows, Zotero
sync, or authoritative benchmark claims from the seed eval. External search results are candidate evidence, not
the app's verdict.

## Drift Rules

- If `Verdict` changes, update `src/types.ts`, `src/eval/gold.ts`, and `fixtures/ANNOTATION_RUBRIC.md` together.
- If corpus text changes, regenerate both `fixtures/sources.lock.json` and `fixtures/gold_claims.jsonl`, then run
  `npm run lint`.
- If a capability moves from plan to implementation, update `README.md`, this file, and the relevant plan index
  together.
