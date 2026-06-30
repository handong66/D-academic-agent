import type { TraceEvent } from "../trace/trace.js";
import type { Verdict } from "../types.js";

// Generous single-snippet guard: larger than toy chunks, small enough to catch whole-document leakage.
export const POLICY_MAX_SNIPPET_CHARS = 2000;

export interface PolicyCompliance {
  grounded_locator_rate: number;
  snippet_only_rate: number;
  outbound_chars: number;
}

export function policyCompliance(results: { verdict: Verdict; source_hash: string }[], traces: TraceEvent[]): PolicyCompliance {
  const decisive = results.filter((result) => result.verdict !== "unclear");
  const outbound = traces.flatMap((trace) => trace.outbound_snippets);

  // Vacuous-truth convention: with no decisive verdicts (or no outbound snippets) nothing can violate the
  // policy, so the rate is 1 (compliant) rather than 0/NaN. (Codex 互评 NIT — rationale documented.)
  return {
    grounded_locator_rate: decisive.length
      ? decisive.filter((result) => result.source_hash.length > 0).length / decisive.length
      : 1,
    snippet_only_rate: outbound.length
      ? outbound.filter((snippet) => snippet.length <= POLICY_MAX_SNIPPET_CHARS).length / outbound.length
      : 1,
    outbound_chars: outbound.reduce((sum, snippet) => sum + snippet.length, 0),
  };
}
