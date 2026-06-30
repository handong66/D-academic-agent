import { describe, it, expect } from "vitest";
import { extractMentions } from "../src/draft/mentions.js";
import type { Mention } from "../src/draft/mentions.js";

function expectExactSlices(draft: string, mentions: Mention[]): void {
  expect(mentions.map((x) => draft.slice(x.char_start, x.char_end))).toEqual(mentions.map((x) => x.raw_citation));
}

describe("extractMentions", () => {
  it("reconstructs raw_citation exactly via slice at offset 0", () => {
    const text = "X is linked to Y (Twenge, 2018) per \\cite{orben2019}.";
    const m = extractMentions(text, 0);
    expectExactSlices(text, m);
    expect(m.map((x) => x.raw_citation)).toEqual(["(Twenge, 2018)", "\\cite{orben2019}"]);
  });

  it("shifts spans by the given offset", () => {
    const text = "Linked (Twenge, 2018).";
    const m = extractMentions(text, 100);
    expect(m[0]!.char_start).toBe(100 + text.indexOf("(Twenge"));
    expect(m[0]!.char_end).toBe(m[0]!.char_start + "(Twenge, 2018)".length);
  });

  it("extracts multiple citations in the same sentence", () => {
    const draft = "Prior work reports mixed effects [1] and [2].";
    const mentions = extractMentions(draft, 0);
    expect(mentions.map((x) => x.raw_citation)).toEqual(["[1]", "[2]"]);
    expectExactSlices(draft, mentions);
  });

  it("extracts adjacent citations as separate mentions", () => {
    const draft = "Intro. Prior studies [1][2] align.";
    const sentenceStart = draft.indexOf("Prior");
    const mentions = extractMentions(draft.slice(sentenceStart), sentenceStart);
    expect(mentions.map((x) => x.raw_citation)).toEqual(["[1]", "[2]"]);
    expectExactSlices(draft, mentions);
  });
});
