import { describe, expect, it } from "vitest";
import { extractDoiFromText } from "../src/library/doi.js";

describe("extractDoiFromText", () => {
  it("returns a clean DOI", () => {
    expect(extractDoiFromText("10.1016/j.x.2020.01.002")).toBe("10.1016/j.x.2020.01.002");
  });

  it("returns a DOI inside a URL", () => {
    expect(extractDoiFromText("https://doi.org/10.1000/xyz")).toBe("10.1000/xyz");
  });

  it("returns a DOI after a label", () => {
    expect(extractDoiFromText("DOI: 10.1234/abc")).toBe("10.1234/abc");
  });

  it("strips a trailing period", () => {
    expect(extractDoiFromText("see 10.1234/abc.")).toBe("10.1234/abc");
  });

  it("strips a trailing parenthesis", () => {
    expect(extractDoiFromText("(10.1234/abc)")).toBe("10.1234/abc");
  });

  it("returns undefined when no DOI is present", () => {
    expect(extractDoiFromText("not a persistent paper identifier")).toBeUndefined();
  });
});
