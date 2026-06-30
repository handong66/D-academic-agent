import type { GoldLabel } from "../eval/gold.js";

// DX drilldown: pair an eval failure to its gold snippet/rationale by the (claim, cited_source)
// pair — the spec's minimal unit. Tuple key avoids separator-less concatenation collisions.
export interface Failure { claim: string; gold: string; pred: string; cited_source: string; }
export interface Drilled extends Failure { snippet: string; rationale: string; }

export function drillFailures(failures: Failure[], gold: GoldLabel[]): Drilled[] {
  const byPair = new Map(gold.map((g) => [JSON.stringify([g.claim_text, g.cited_source]), g]));
  return failures.map((f) => {
    const g = byPair.get(JSON.stringify([f.claim, f.cited_source]));
    return { ...f, snippet: g?.snippet ?? "", rationale: g?.rationale ?? "" };
  });
}
