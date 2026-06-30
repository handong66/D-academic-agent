import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleSources } from "../src/corpus/assemble.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "corpus-"));
  writeFileSync(join(dir, "refs.bib"), `@article{smith2021, author={Smith, John}, year={2021}, title={Access}}`);
  writeFileSync(join(dir, "smith2021.txt"), "Urban access improved.");
});

describe("assembleSources", () => {
  it("joins bib + txt into Source[] and a bibKey map", () => {
    const { sources, bibKeyToSourceId } = assembleSources(dir);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.id).toBe("smith2021");
    expect(sources[0]?.citation_metadata.bibtex_key).toBe("smith2021");
    expect(bibKeyToSourceId["smith2021"]).toBe("smith2021");
  });
  it("throws when a .bib entry has no matching .txt", () => {
    const d2 = mkdtempSync(join(tmpdir(), "corpus-"));
    writeFileSync(join(d2, "refs.bib"), `@article{ghost2000, author={Ghost, A}, year={2000}, title={X}}`);
    expect(() => assembleSources(d2)).toThrow(/ghost2000/);
  });
  it("throws on a stray .txt with no bib entry (Codex review)", () => {
    const d3 = mkdtempSync(join(tmpdir(), "corpus-"));
    writeFileSync(join(d3, "refs.bib"), `@article{a2021, author={A, B}, year={2021}, title={T}}`);
    writeFileSync(join(d3, "a2021.txt"), "x");
    writeFileSync(join(d3, "stray.txt"), "y");
    expect(() => assembleSources(d3)).toThrow(/stray/);
  });
});
