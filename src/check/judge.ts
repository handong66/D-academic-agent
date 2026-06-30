import type { Verdict } from "../types.js";

export interface JudgeInput {
  claim: string;
  snippet: string;
}
export interface JudgeOutput {
  verdict: Verdict;
  reason: string;
  confidence: number;
  suggested_rewrite: string;
}
export interface Judge {
  readonly model: string;
  judge(input: JudgeInput): Promise<JudgeOutput>;
}

// Deterministic, offline, for tests + pipeline smoke. Rule-of-thumb only; NOT a quality model.
export class MockJudge implements Judge {
  readonly model = "mock-judge";
  async judge({ claim, snippet }: JudgeInput): Promise<JudgeOutput> {
    const s = snippet.toLowerCase();
    if (s.includes("does not") || s.includes("cannot")) {
      return { verdict: "unsupported", reason: "snippet negates/limits the claim", confidence: 0.5, suggested_rewrite: `Soften: the source does not establish "${claim}".` };
    }
    const overlap = (claim.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => s.includes(w)).length;
    return overlap >= 3
      ? { verdict: "supports", reason: "snippet overlaps the claim", confidence: 0.6, suggested_rewrite: "" }
      : { verdict: "unclear", reason: "insufficient overlap", confidence: 0.3, suggested_rewrite: `Retrieve stronger evidence for "${claim}".` };
  }
}

// Real judge: src/check/llm-judge.ts (Task 16). Vercel AI SDK generateObject, zod schema,
// SNIPPET-ONLY system prompt (constitutions/CLAIM_CHECK_CONSTITUTION.md). Never unit-tested.
