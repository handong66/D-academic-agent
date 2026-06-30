import { describe, it, expect } from "vitest";
import { chunkSource } from "../src/retrieve/chunk.js";

const text = "  First about media. Second about sleep. Third one.";

describe("chunkSource", () => {
  it("sentence chunks; slice equals text for every chunk (incl. leading whitespace)", () => {
    const cs = chunkSource("s1", "h1", text, "hash-256", 256);
    expect(cs.length).toBe(3);
    for (const c of cs) expect(text.slice(c.char_start, c.char_end)).toBe(c.text);
    expect(cs[0]!.id).toBe("s1#0");
    expect(cs[0]!.embedding_model).toBe("hash-256");
  });
});
