import { describe, it, expect } from "vitest";
import { MockJudge } from "../src/check/judge.js";

describe("MockJudge", () => {
  it("returns a snippet-only verdict + suggested_rewrite (deterministic)", async () => {
    const r = await new MockJudge().judge({ claim: "X causes Y", snippet: "the study does not establish that X causes Y" });
    expect(["supports", "weakly_supports", "unsupported", "contradicts", "unclear"]).toContain(r.verdict);
    expect(typeof r.suggested_rewrite).toBe("string");
  });
});
