import { describe, it, expect } from "vitest";
import type { AnalyzedClaim, EvidenceCard, WritingClaimStatus } from "../src/writing/report.js";
import { suggestRewrite } from "../src/writing/rewrite.js";
import type { WritingClaimType } from "../src/writing/claims.js";

function claimFixture(
  text: string,
  status: WritingClaimStatus,
  claimType: WritingClaimType = "background",
  localEvidence: EvidenceCard[] = [],
): AnalyzedClaim {
  return {
    id: "claim-fixture",
    text,
    sentenceIndex: 0,
    claimType,
    citedKeys: [],
    isFactual: true,
    status,
    localEvidence,
    riskNotes: [],
  };
}

function assertNoStrongerCausalLanguage(original: string, suggestedRewrite: string): void {
  const addedBareCausalCue =
    (!/\bcauses?\b/i.test(original) && /\bcauses?\b/i.test(suggestedRewrite)) ||
    (!/\bleads to\b/i.test(original) && /\bleads to\b/i.test(suggestedRewrite)) ||
    (!/\bresults in\b/i.test(original) && /\bresults in\b/i.test(suggestedRewrite));

  expect(addedBareCausalCue).toBe(false);
}

function assertNoBareOverclaimedCausalAssertion(suggestedRewrite: string): void {
  expect(suggestedRewrite).not.toMatch(/^[^:]+?\b(causes?|leads to|results in)\b/i);
  expect(suggestedRewrite).not.toMatch(/^Some evidence suggests that .*\b(causes?|leads to|results in)\b/i);
}

describe("suggestRewrite", () => {
  it("marks uncited claims without duplicating trailing punctuation", () => {
    const suggestion = suggestRewrite(claimFixture("Exercise improves memory.", "needs_citation"));

    expect(suggestion).toEqual({ suggestedRewrite: "Exercise improves memory (citation needed)." });
    assertNoStrongerCausalLanguage("Exercise improves memory.", suggestion.suggestedRewrite!);
  });

  it("wraps weakly supported claims with a non-destructive hedge", () => {
    const original = "Exercise improves memory.";
    const suggestion = suggestRewrite(claimFixture(original, "weakly_supported"));

    expect(suggestion).toEqual({ suggestedRewrite: "Some evidence suggests that exercise improves memory." });
    assertNoStrongerCausalLanguage(original, suggestion.suggestedRewrite!);
  });

  it("preserves a leading acronym when hedging (does not lowercase COVID)", () => {
    const suggestion = suggestRewrite(claimFixture("COVID disrupts sleep patterns.", "weakly_supported"));

    expect(suggestion).toEqual({ suggestedRewrite: "Some evidence suggests that COVID disrupts sleep patterns." });
  });

  it("replaces a safe top-level causal predicate with an association cue", () => {
    const original = "Screen time causes anxiety.";
    const suggestion = suggestRewrite(claimFixture(original, "overclaimed", "causal"));

    expect(suggestion).toEqual({ suggestedRewrite: "Screen time is associated with anxiety." });
    expect(suggestion.suggestedRewrite).not.toMatch(/\bcauses?\b/i);
    assertNoBareOverclaimedCausalAssertion(suggestion.suggestedRewrite!);
    assertNoStrongerCausalLanguage(original, suggestion.suggestedRewrite!);
  });

  it("uses a conservative wrapper when the causal cue is negated", () => {
    const original = "Screen time does not cause anxiety.";
    const suggestion = suggestRewrite(claimFixture(original, "overclaimed", "causal"));

    expect(suggestion.suggestedRewrite).toBe(
      "Some evidence suggests an association rather than a causal effect: Screen time does not cause anxiety.",
    );
    expect(suggestion.riskNote).toMatch(/conservative wrapper/i);
    expect(suggestion.suggestedRewrite).not.toMatch(/\bdoes not is associated with\b/i);
    assertNoBareOverclaimedCausalAssertion(suggestion.suggestedRewrite!);
    assertNoStrongerCausalLanguage(original, suggestion.suggestedRewrite!);
  });

  it("uses a conservative wrapper when the causal cue is quoted", () => {
    const original = 'Participants said "exercise causes clarity" after the intervention.';
    const suggestion = suggestRewrite(claimFixture(original, "overclaimed", "causal"));

    expect(suggestion.suggestedRewrite).toBe(
      'Some evidence suggests an association rather than a causal effect: Participants said "exercise causes clarity" after the intervention.',
    );
    expect(suggestion.riskNote).toMatch(/conservative wrapper/i);
    assertNoBareOverclaimedCausalAssertion(suggestion.suggestedRewrite!);
    assertNoStrongerCausalLanguage(original, suggestion.suggestedRewrite!);
  });

  it("uses a conservative wrapper when the causal cue is subordinate", () => {
    const original = "Although exercise causes fatigue, adherence improved.";
    const suggestion = suggestRewrite(claimFixture(original, "overclaimed", "causal"));

    expect(suggestion.suggestedRewrite).toBe(
      "Some evidence suggests an association rather than a causal effect: Although exercise causes fatigue, adherence improved.",
    );
    expect(suggestion.riskNote).toMatch(/conservative wrapper/i);
    assertNoBareOverclaimedCausalAssertion(suggestion.suggestedRewrite!);
    assertNoStrongerCausalLanguage(original, suggestion.suggestedRewrite!);
  });

  it("returns status-specific notes for contradicted and unclear claims", () => {
    expect(suggestRewrite(claimFixture("Sleep loss improves attention.", "contradicted"))).toEqual({
      riskNote: "A cited source contradicts this claim — reconsider or remove it.",
    });
    expect(suggestRewrite(claimFixture("The evidence is mixed.", "unclear"))).toEqual({
      riskNote: "Evidence is unclear — consider softening the claim or adding support.",
    });
  });

  it("leaves supported claims unchanged", () => {
    expect(suggestRewrite(claimFixture("Therapy improves sleep quality.", "supported"))).toEqual({});
  });
});
