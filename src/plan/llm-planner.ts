import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { Plan, Planner } from "./planner.js";

// Real, provider-agnostic planner. Never unit-tested (needs a live key/endpoint).
const Schema = z.object({ subqueries: z.array(z.string()).min(2).max(6) });

export class LlmPlanner implements Planner {
  readonly model: string;
  private readonly chat;
  constructor(o: { baseURL: string; apiKey?: string; model: string }) {
    this.chat = createOpenAICompatible({ name: "agent", baseURL: o.baseURL, apiKey: o.apiKey })(o.model);
    this.model = o.model;
  }
  async plan(question: string): Promise<Plan> {
    const { object } = await generateObject({
      model: this.chat,
      schema: Schema,
      system: "Decompose a research question into 2-5 focused retrieval sub-queries (mechanisms, evidence types, counter-evidence, limitations).",
      prompt: question,
    });
    return { question, subqueries: object.subqueries };
  }
}
