// Planner subagent (spec §7): decompose a question into focused retrieval sub-queries.
export interface Plan { question: string; subqueries: string[]; }
export interface Planner {
  readonly model: string;
  plan(question: string): Promise<Plan>;
}

// Deterministic, offline planner for CI.
export class MockPlanner implements Planner {
  readonly model = "mock-planner";
  async plan(question: string): Promise<Plan> {
    const base = question.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    return { question, subqueries: [base, `${base} correlation evidence`, `${base} limitations`] };
  }
}
