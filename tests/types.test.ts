import { describe, it, expect } from "vitest";
import { VERDICTS, isVerdict, makeClaimCitationPair } from "../src/types.js";
import type { CitationMention } from "../src/types.js";

const resolved: CitationMention = {
  draft_sentence_id: "s1",
  char_start: 0,
  char_end: 5,
  raw_citation: "(Smith, 2021)",
  resolved_source_id: "smith2021",
  resolution_status: "resolved",
};
const unresolved: CitationMention = { ...resolved, resolved_source_id: undefined, resolution_status: "unresolved" };

describe("types", () => {
  it("verdict enum + guard", () => {
    expect(VERDICTS).toEqual(["supports", "weakly_supports", "unsupported", "contradicts", "unclear"]);
    expect(isVerdict("supports")).toBe(true);
    expect(isVerdict("nope")).toBe(false);
  });
  it("makeClaimCitationPair enforces the §4 invariant", () => {
    const pair = makeClaimCitationPair("c1", "m1", resolved);
    expect(pair.source_id).toBe("smith2021");
    expect(() => makeClaimCitationPair("c1", "m1", unresolved)).toThrow(/resolved/i);
  });
});
