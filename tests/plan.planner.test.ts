import { describe, it, expect } from "vitest";
import { MockPlanner } from "../src/plan/planner.js";

describe("MockPlanner", () => {
  it("turns a question into >=2 deterministic sub-queries", async () => {
    const a = await new MockPlanner().plan("How does social media affect adolescent depression?");
    const b = await new MockPlanner().plan("How does social media affect adolescent depression?");
    expect(a.subqueries.length).toBeGreaterThanOrEqual(2);
    expect(a.subqueries).toEqual(b.subqueries);
  });
});
