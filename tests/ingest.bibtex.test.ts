import { describe, it, expect } from "vitest";
import { parseBibtex } from "../src/ingest/bibtex.js";

const RAW = `@article{smith2021, author={Smith, John and Jones, Amy}, year={2021}, title={Access in {Urban} schools}}
@article{lee2020, author={Lee, Kim}, year={2020}, title={Sleep}}`;

describe("parseBibtex", () => {
  it("parses keys, surnames, year, title (brace-balanced)", () => {
    const es = parseBibtex(RAW);
    expect(es.map((e) => e.key)).toEqual(["smith2021", "lee2020"]);
    expect(es[0]?.authors).toEqual(["Smith", "Jones"]);
    expect(es[0]?.year).toBe("2021");
    expect(es[0]?.title).toContain("Urban");
  });
});
