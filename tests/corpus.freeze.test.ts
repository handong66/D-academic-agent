import { describe, it, expect } from "vitest";
import { assembleSources } from "../src/corpus/assemble.js";

describe("frozen corpus", () => {
  it("assembles 6 sources deterministically", () => {
    const a = assembleSources("fixtures/corpus");
    const b = assembleSources("fixtures/corpus");
    expect(a.sources).toHaveLength(6);
    expect(a).toEqual(b);
    for (const s of a.sources) expect(s.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
