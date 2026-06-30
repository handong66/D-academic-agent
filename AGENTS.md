# AGENTS.md — D-academic-agent Router

> Minimal cold-start contract. Read in under 90 seconds and still do safe work. Operational detail lives in `constitutions/` and in executable lint (`src/lint/invariants.ts`).

## Red Lines — follow these even if you haven't read anything else
1. **The checker only sees the retrieved snippet.** Never let `check_claim` judge from model priors or surface similarity. (spec §6)
2. **Tools are pure; the runner persists.** `check_claim` / `search_*` return TraceEvents as values; only the run loop / CLI / eval runner writes JSONL to disk. (spec §10/§11)
3. **Gold is human-labeled; never self-graded.** The model under test must not produce its own gold labels. (spec §9)
4. **Eval is seed / reporting-only.** Never present M0/M1 metrics as an authoritative benchmark; no pass/fail threshold gates M0/M1. (spec §9/§15)
5. **Invariants are gates, not memory.** Run `npm run lint` (HARNESS-§ rules); a `ClaimCitationPair` is only ever formed via `makeClaimCitationPair()`.

## Constitution Router
| Domain | Open first |
|---|---|
| claim / citation verification | `constitutions/CLAIM_CHECK_CONSTITUTION.md` |
| invariant / lint rules | `src/lint/invariants.ts` + this file |

## Doc-sync consistency set — update together, never one alone
- `Verdict` enum (`src/types.ts`) ↔ gold `label` enum (`src/eval/gold.ts`) ↔ `fixtures/ANNOTATION_RUBRIC.md`.
- spec (`docs/2026-06-22-litreview-harness-spec.md`) ↔ plan (`docs/plans/…`) ↔ code.
- Corpus text changed? Regenerate **both** `fixtures/sources.lock.json` (`npm run freeze`) and `fixtures/gold_claims.jsonl` (`npx tsx scripts/build_gold.ts`), then `npm run lint` to gate the result.

## Canonical commands
- `npm test` — vitest · `npm run typecheck` — tsc · `npm run lint` — HARNESS-§ invariants · `npm run freeze` — regenerate sources.lock.json.

## What this file is not
Not the spec, not the rule book, not the change log. Detail belongs in the spec, the constitution, or the executable lint.
