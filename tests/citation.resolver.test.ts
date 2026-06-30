import { describe, it, expect } from "vitest";
import { CitationResolver } from "../src/citation/resolver.js";
import type { Source } from "../src/types.js";

const mk = (id: string, authors: string[], year: string): Source => ({
  id,
  title: "",
  authors,
  year,
  type: "scholarly_article",
  path_or_url: "",
  source_hash: "h",
  citation_metadata: { bibtex_key: id },
  fulltext_status: "extracted",
});
const sources = [mk("smith2021a", ["Smith", "Lee"], "2021"), mk("smith2021b", ["Smith", "Wong"], "2021"), mk("jones2020", ["Jones", "Park"], "2020")];
const r = new CitationResolver(sources, { smith2021a: "smith2021a", smith2021b: "smith2021b", jones2020: "jones2020" });

describe("CitationResolver", () => {
  it("bibtex key (incl multi-key picks first resolvable)", () => {
    expect(r.resolve("\\cite{jones2020}").source_id).toBe("jones2020");
    expect(r.resolve("\\cite{missing,jones2020}").source_id).toBe("jones2020");
  });
  it("author-year ignores leading capitalized words (no false positive)", () => {
    expect(r.resolve("Jones et al. (2020)")).toEqual({ source_id: "jones2020", status: "resolved" });
  });
  it("ambiguous when two same-first-author+year and no coauthor cue", () => {
    expect(r.resolve("(Smith, 2021)").status).toBe("ambiguous");
  });
  it("disambiguates by coauthor surname", () => {
    expect(r.resolve("(Smith & Wong, 2021)")).toEqual({ source_id: "smith2021b", status: "resolved" });
  });
  it("unresolved on no match", () => {
    expect(r.resolve("(Brown, 1999)")).toEqual({ source_id: undefined, status: "unresolved" });
  });
  it("multi-citation group is ambiguous, not silently mis-bound (Codex review)", () => {
    expect(r.resolve("(Smith 2021; Wong 2021)").status).toBe("ambiguous");
  });
});
