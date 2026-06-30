import { describe, it, expect } from "vitest";
import { resolveProjectLocal } from "../src/tools/projectlocal.js";

describe("resolveProjectLocal", () => {
  it("allows paths under the project root and rejects traversal", () => {
    expect(resolveProjectLocal("out/run1")).toContain("out/run1");
    expect(() => resolveProjectLocal("/etc/passwd")).toThrow(/project-local/);
    expect(() => resolveProjectLocal("../../escape")).toThrow(/project-local/);
  });
});
