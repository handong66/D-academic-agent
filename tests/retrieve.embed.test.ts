import { describe, it, expect } from "vitest";
import { HashEmbedder, cosine } from "../src/retrieve/embed.js";

describe("HashEmbedder", () => {
  it("is deterministic and reflects token overlap", async () => {
    const e = new HashEmbedder(64);
    const [a, b, c] = await e.embed(["social media depression", "social media depression", "unrelated cooking recipe"]);
    expect(a).toEqual(b);
    expect(cosine(a!, b!)).toBeCloseTo(1, 5);
    expect(cosine(a!, c!)).toBeLessThan(cosine(a!, b!));
  });
});
