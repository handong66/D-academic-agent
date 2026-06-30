import { beforeAll, describe, expect, it } from "vitest";
import { mapNliToVerdict, NliJudge } from "../src/check/nli-judge.js";
import { downloadModel } from "../src/providers/models.js";

const NLI_MODEL_ID = "nli-deberta-v3-xsmall";

describe("mapNliToVerdict", () => {
  it("maps high-confidence entailment to supports", () => {
    expect(mapNliToVerdict({ entailment: 0.9, neutral: 0.08, contradiction: 0.02 })).toEqual({
      verdict: "supports",
      confidence: 0.9,
    });
  });

  it("maps mid-confidence entailment to weakly_supports", () => {
    expect(mapNliToVerdict({ entailment: 0.6, neutral: 0.25, contradiction: 0.15 })).toEqual({
      verdict: "weakly_supports",
      confidence: 0.6,
    });
  });

  it("maps contradiction to contradicts", () => {
    expect(mapNliToVerdict({ entailment: 0.1, neutral: 0.15, contradiction: 0.75 })).toEqual({
      verdict: "contradicts",
      confidence: 0.75,
    });
  });

  it("maps neutral to unclear", () => {
    expect(mapNliToVerdict({ entailment: 0.1, neutral: 0.6, contradiction: 0.3 })).toEqual({
      verdict: "unclear",
      confidence: 0.6,
    });
  });

  it("maps low-confidence scores to unclear", () => {
    expect(mapNliToVerdict({ entailment: 0.4, neutral: 0.35, contradiction: 0.25 })).toEqual({
      verdict: "unclear",
      confidence: 0.4,
    });
  });

  it("maps a top tie (entailment == contradiction) to unclear, not weakly_supports", () => {
    expect(mapNliToVerdict({ entailment: 0.5, neutral: 0, contradiction: 0.5 })).toEqual({
      verdict: "unclear",
      confidence: 0.5,
    });
  });
});

describe("NliJudge live model", () => {
  // Warm the cache first — NliJudge runs with allowRemoteModels=false, so a cold cache would throw (Codex W1).
  beforeAll(async () => {
    if (process.env.M5D_LIVE_NLI) await downloadModel(NLI_MODEL_ID);
  });

  it.skipIf(!process.env.M5D_LIVE_NLI)("supports an obvious entailment pair", async () => {
    const judge = new NliJudge({ hfId: "Xenova/nli-deberta-v3-xsmall" });

    const result = await judge.judge({
      claim: "Paris is the capital of France.",
      snippet: "France's capital city is Paris.",
    });

    expect(result.verdict).toBe("supports");
  });

  it.skipIf(!process.env.M5D_LIVE_NLI)("contradicts an obvious contradiction pair", async () => {
    const judge = new NliJudge({ hfId: "Xenova/nli-deberta-v3-xsmall" });

    const result = await judge.judge({
      claim: "Paris is the capital of Germany.",
      snippet: "France's capital city is Paris. Berlin is the capital of Germany.",
    });

    expect(result.verdict).toBe("contradicts");
  });
});
