import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLiteratureMatrix } from "../src/tools/matrix.js";

describe("buildLiteratureMatrix", () => {
  it("writes under a project-local dir and rejects traversal", () => {
    const dir = buildLiteratureMatrix([{ source_id: "twenge2018", claim: "X assoc Y", verdict: "supports", quote: "report more", locator: "twenge2018:0-10" }], "out/mtx-test");
    expect(existsSync(join(dir, "matrix.md"))).toBe(true);
    expect(readFileSync(join(dir, "matrix.md"), "utf8")).toContain("twenge2018");
    expect(() => buildLiteratureMatrix([], "/tmp/escape")).toThrow(/project-local/);
  });
});
