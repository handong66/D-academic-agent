import { describe, it, expect } from "vitest";
import { runLint } from "../src/lint/invariants.js";

describe("runLint", () => {
  it("passes on the frozen corpus + gold (no errors)", () => {
    const issues = runLint("fixtures/corpus", "fixtures/gold_claims.jsonl");
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});
