import { describe, it, expect } from "vitest";
import { confusionMatrix, perClass, macroF1, recallAtK } from "../src/eval/metrics.js";

describe("metrics", () => {
  it("per-class over the fixed enum + macro-F1", () => {
    const g = ["supports", "unsupported", "supports", "contradicts"], p = ["supports", "unsupported", "unsupported", "contradicts"];
    expect(confusionMatrix(g, p).supports?.supports).toBe(1);
    expect(perClass(g, p).supports?.recall).toBeCloseTo(0.5);
    expect(perClass(g, p).weakly_supports).toBeDefined(); // zero row present (fixed enum)
    expect(macroF1(g, p)).toBeGreaterThan(0);
  });
  it("retrieval recall@k by span overlap", () => {
    expect(recallAtK([{ gold: [10, 20], retrieved: [[5, 15], [30, 40]] }], 2)).toBe(1);
    expect(recallAtK([{ gold: [10, 20], retrieved: [[30, 40]] }], 2)).toBe(0);
  });
});
