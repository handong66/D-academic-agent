import { describe, it, expect } from "vitest";
import { extractClaims } from "../src/writing/claims.js";

describe("extractClaims", () => {
  it("classifies causal, association, and comparison claims by deterministic cues", () => {
    const claims = extractClaims(
      "Protein exposure causes differentiation. Social media use is associated with sleep quality. Treatment scores were higher than control scores.",
    );

    expect(claims.map((claim) => claim.claimType)).toEqual(["causal", "association", "comparison"]);
  });

  it("keeps raw citation keys for cited sentences and an empty list for uncited sentences", () => {
    const claims = extractClaims("Social media use is associated with adolescent depression (Twenge, 2018). Sleep quality improved.");

    expect(claims).toHaveLength(2);
    expect(claims[0]!.citedKeys).toEqual(["(Twenge, 2018)"]);
    expect(claims[1]!.citedKeys).toEqual([]);
  });

  it("marks questions and pure transition sentences as non-factual", () => {
    const claims = extractClaims("Does the intervention improve sleep? However.");

    expect(claims.map((claim) => claim.isFactual)).toEqual([false, false]);
  });

  it("preserves the sentence index from draft segmentation", () => {
    const claims = extractClaims("First sentence. Second sentence. Third sentence.");

    expect(claims.map((claim) => claim.sentenceIndex)).toEqual([0, 1, 2]);
  });

  it("returns stable ids for the same paragraph and same sentence positions", () => {
    const paragraph = "We measured sleep using actigraphy. Lower stress predicted better sleep.";
    const firstRun = extractClaims(paragraph);
    const secondRun = extractClaims(paragraph);

    expect(secondRun.map((claim) => claim.id)).toEqual(firstRun.map((claim) => claim.id));
    expect(new Set(firstRun.map((claim) => claim.id)).size).toBe(firstRun.length);
  });
});
