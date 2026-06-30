import { describe, it, expect } from "vitest";
import { loadGoldClaims, OVERCLAIM_DIMS } from "../src/eval/gold.js";

describe("loadGoldClaims", () => {
  it("loads >=20 labels with structured locator + raw_citation", () => {
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    expect(gold.length).toBeGreaterThanOrEqual(20);
    for (const g of gold) {
      expect(g.locator.source_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(g.locator.char_end).toBeGreaterThan(g.locator.char_start);
      expect(g.raw_citation.length).toBeGreaterThan(0);
    }
  });
  it("each label may carry an optional overclaim dimension", () => {
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    const withDim = gold.filter((g) => g.overclaim);
    expect(withDim.length).toBeGreaterThan(0);
    for (const g of withDim) expect(OVERCLAIM_DIMS).toContain(g.overclaim);
  });
});
