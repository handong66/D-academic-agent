# Claim-Check Constitution

> Scope: every operation that judges whether a citation supports a claim. AGENTS.md routes claim/citation work here.

## Step 1 — Proposition decomposition
Reduce the cited sentence to one checkable proposition: *"Does the cited source provide evidence for «X»?"* One claim ↔ one cited source per check.

## Step 2 — Snippet-only judgment
Judge **only** from the retrieved snippet of the cited source. Never use the model's background knowledge. (Enforced as a design red line in AGENTS.md.)

## Reasons that DO NOT justify a "supports" verdict
- "the citation already exists in the bibliography"
- "a nearby sentence cites it correctly"
- "the paper looks topically relevant"
- "it was verified in a previous session"
- "the snippet is semantically similar to the claim" — similarity ≠ support

## Overclaim taxonomy (→ weakly_supports / unsupported / contradicts)
1. **Causality** — correlation reported, causation claimed → `unsupported` (or `weakly_supports` if longitudinal + adjusted, residual confounding remains).
2. **Scope** — a narrow/local finding generalized → `unsupported` / `weakly_supports`.
3. **Sample / Strength** — a small or `<1%` effect stated as large / most → `contradicts`.
4. **Mentions-only / off-topic** — source only mentions the topic, gives no supporting evidence → `unsupported`.

## Two outputs, never collapsed
`cited_source_support` (does the cited source support the claim?) and `corpus_counterevidence` (does the rest of the corpus contradict it?) are distinct outputs. Keep them separate; do not merge into a single verdict.

## Multi-citation groups
The resolver handles a **single** in-text citation. Groups like `(Smith 2021; Wong 2021)` must be split before resolution (M1); for now they resolve as `ambiguous` rather than being silently mis-bound.
