import { describe, it, expect } from "vitest";
import { synthesizeThesisVerdict } from "../src/plan/synthesize.js";
import type { PlanFinding } from "../src/plan/orchestrate.js";

function finding(source_id: string, relation: PlanFinding["relation"]): PlanFinding {
  return {
    source_id,
    subquery: "q",
    snippet: "snippet",
    locator: {
      source_id,
      source_hash: `${source_id}-hash`,
      char_start: 0,
      char_end: 7,
      section: "body",
      chunker_version: "test",
    },
    relation,
    reason: "test",
  };
}

describe("synthesizeThesisVerdict", () => {
  it("returns supported for all supporting sources", () => {
    expect(synthesizeThesisVerdict([
      finding("s1", "supports"),
      finding("s2", "supports"),
      finding("s3", "supports"),
    ])).toEqual({
      verdict: "supported",
      consensus: 1.0,
      decisiveness: 1.0,
      supporting: 3,
      contradicting: 0,
      mixed: 0,
    });
  });

  it("returns refuted for all contradicting sources", () => {
    expect(synthesizeThesisVerdict([
      finding("s1", "contradicts"),
      finding("s2", "contradicts"),
    ])).toEqual({
      verdict: "refuted",
      consensus: 0.0,
      decisiveness: 1.0,
      supporting: 0,
      contradicting: 2,
      mixed: 0,
    });
  });

  it("returns contested for a three-to-two source split", () => {
    expect(synthesizeThesisVerdict([
      finding("s1", "supports"),
      finding("s2", "supports"),
      finding("s3", "supports"),
      finding("s4", "contradicts"),
      finding("s5", "contradicts"),
    ])).toEqual({
      verdict: "contested",
      consensus: 0.6,
      decisiveness: 0.2,
      supporting: 3,
      contradicting: 2,
      mixed: 0,
    });
  });

  it("counts equal support and contradiction from one source as mixed", () => {
    expect(synthesizeThesisVerdict([
      finding("s1", "supports"),
      finding("s1", "contradicts"),
    ])).toEqual({
      verdict: "contested",
      consensus: 0.5,
      decisiveness: 0,
      supporting: 0,
      contradicting: 0,
      mixed: 1,
    });
  });

  it("returns insufficient for empty findings or unrelated-only findings", () => {
    expect(synthesizeThesisVerdict([])).toEqual({
      verdict: "insufficient",
      consensus: 0,
      decisiveness: 0,
      supporting: 0,
      contradicting: 0,
      mixed: 0,
    });
    expect(synthesizeThesisVerdict([
      finding("s1", "unrelated"),
      finding("s2", "unrelated"),
    ])).toEqual({
      verdict: "insufficient",
      consensus: 0,
      decisiveness: 0,
      supporting: 0,
      contradicting: 0,
      mixed: 0,
    });
  });
});
