import { describe, it, expect } from "vitest";
import { CHUNKER_VERSION } from "../src/retrieve/types.js";

describe("retrieve types", () => {
  it("exposes a chunker version for provenance", () => {
    expect(CHUNKER_VERSION).toMatch(/^\d+\.\d+$/);
  });
});
