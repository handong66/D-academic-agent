import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { VERDICTS } from "../types.js";
import type { Judge, JudgeInput, JudgeOutput } from "./judge.js";

const JudgeSchema = z.object({
  verdict: z.enum(VERDICTS),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  suggested_rewrite: z.string(),
});

// SNIPPET-ONLY judging contract (constitutions/CLAIM_CHECK_CONSTITUTION.md).
const SYSTEM =
  "You judge whether a CITED SOURCE SNIPPET supports a CLAIM. Judge ONLY from the snippet; never use outside knowledge. " +
  "Verdicts: supports, weakly_supports, unsupported, contradicts, unclear. " +
  "Correlation stated as causation, a narrow finding generalized, a small effect stated as large, and mention-only are NOT supports. " +
  "Set suggested_rewrite to a corrected claim when it overreaches, otherwise an empty string.";

// Real, provider-agnostic LLM judge. Never unit-tested (needs a live key/endpoint).
export class LlmJudge implements Judge {
  readonly model: string;
  private readonly chatModel;
  constructor(opts: { baseURL: string; apiKey?: string; model: string }) {
    const provider = createOpenAICompatible({ name: "agent", baseURL: opts.baseURL, apiKey: opts.apiKey });
    this.chatModel = provider(opts.model);
    this.model = opts.model;
  }
  async judge({ claim, snippet }: JudgeInput): Promise<JudgeOutput> {
    const { object } = await generateObject({
      model: this.chatModel,
      schema: JudgeSchema,
      system: SYSTEM,
      prompt: `CLAIM: ${claim}\nSNIPPET: ${snippet}`,
    });
    return object;
  }
}
