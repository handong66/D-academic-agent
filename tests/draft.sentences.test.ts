import { describe, it, expect } from "vitest";
import { splitSentences } from "../src/draft/sentences.js";

describe("splitSentences", () => {
  it("returns no sentences for an empty string", () => {
    expect(splitSentences("")).toEqual([]);
  });

  it("returns no sentences for whitespace-only input", () => {
    expect(splitSentences(" \n\t  ")).toEqual([]);
  });

  it("extracts a final sentence without trailing punctuation", () => {
    const text = "A claim without a final period";
    const s = splitSentences(text);
    expect(s).toEqual([{ index: 0, char_start: 0, char_end: text.length, text }]);
  });

  it("splits newline-separated sentences without requiring punctuation", () => {
    const text = "First claim\nSecond claim";
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual(["First claim", "Second claim"]);
    expect(s.map((x) => text.slice(x.char_start, x.char_end))).toEqual(s.map((x) => x.text));
  });

  it("splits sentences with offsets that exactly index the original text", () => {
    const text = "Social media is linked to depression (Twenge, 2018). It may cause anxiety (Orben, 2019).";
    const s = splitSentences(text);
    expect(s.length).toBe(2);
    expect(s.map((x) => text.slice(x.char_start, x.char_end))).toEqual(s.map((x) => x.text));
    expect(s[0]!.text).toContain("Twenge");
    expect(s[1]!.index).toBe(1);
    expect(s[0]!.char_end).toBeLessThanOrEqual(s[1]!.char_start);
  });
});
