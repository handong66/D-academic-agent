# Gold Annotation Rubric — claim-citation verdicts

> A verdict judges whether the **cited source's snippet** supports a **specific claim**. Judge from the snippet only — never from background knowledge.

## Verdicts
- **supports** — the snippet directly establishes the claim.
- **weakly_supports** — the snippet supports a weaker/narrower version; the claim slightly overreaches (small effect, residual confounding, hedged causation).
- **unsupported** — the snippet does not establish the claim (causal overclaim of a correlational finding, out-of-scope, or mentions-only).
- **contradicts** — the snippet asserts the opposite (e.g. "small" vs claim "large"; "<1%" vs "most"; "weak & inconsistent" vs "strong").
- **unclear** — the snippet is insufficient to judge (neither supports nor contradicts).

## Four overclaim dimensions (drive weak / unsupported / contradicts)
1. **Causality** — correlation stated as causation → `unsupported` (or `weakly_supports` if longitudinal + adjusted but residual confounding remains).
2. **Scope** — a narrow finding generalized (e.g. "young adults" → "all age groups"; "urban schools" → "educational equality") → `unsupported` / `weakly_supports`.
3. **Sample / Strength** — a small or `<1%` effect stated as "large" / "most" → `contradicts`.
4. **Mentions-only / off-topic** — the source only mentions the topic, or is unrelated, and gives no supporting evidence → `unsupported`.

## Process integrity
- Each snippet must be an exact substring of the source's canonical text (enforced by lint `HARNESS-§9-SNIPPET-CONTAINED`).
- Gold is human-authored; the model under test never produces its own gold (no self-grading).
- Single in-text citation per gold entry (the resolver handles one citation; multi-citation groups are out of scope for M0).
- Seed set (~22 labels) for harness wiring + seed eval only — **not** an authoritative benchmark.
