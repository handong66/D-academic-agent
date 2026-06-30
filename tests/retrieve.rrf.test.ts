import { describe, it, expect } from "vitest";
import { rrfFuse } from "../src/retrieve/rrf.js";

describe("rrfFuse", () => {
  it("fuses by reciprocal rank, not raw-score addition", () => {
    const f = rrfFuse([["a", "b", "c"], ["b", "a"]], 60);
    expect(f[0]?.id).toBe("a");
    expect(f.find((x) => x.id === "c")!.rrf_score).toBeLessThan(f.find((x) => x.id === "a")!.rrf_score);
  });
});
