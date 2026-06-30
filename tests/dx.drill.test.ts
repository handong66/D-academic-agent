import { describe, it, expect } from "vitest";
import { drillFailures } from "../src/dx/drill.js";
import type { GoldLabel } from "../src/eval/gold.js";

const gold = [{ claim_text: "X causes Y", cited_source: "s1", snippet: "does not establish X causes Y", rationale: "correlation not causation" }] as GoldLabel[];

describe("drillFailures", () => {
  it("matches failures by (claim, cited_source) pair", () => {
    const out = drillFailures([{ claim: "X causes Y", gold: "unsupported", pred: "supports", cited_source: "s1" }], gold);
    expect(out[0]!.snippet).toContain("does not establish");
    expect(out[0]!.rationale).toContain("correlation");
  });
  it("does not mis-match a same-claim different-source pair", () => {
    const out = drillFailures([{ claim: "X causes Y", gold: "unsupported", pred: "supports", cited_source: "OTHER" }], gold);
    expect(out[0]!.snippet).toBe("");
  });
});
