import { describe, it, expect } from "vitest";
import { canonicalize, sourceHash } from "../src/ingest/hash.js";

describe("sourceHash", () => {
  it("normalizes only line endings (offset-stable), distinct text => distinct hash", () => {
    expect(canonicalize("a\r\nb")).toBe("a\nb"); // CRLF->LF only
    expect(canonicalize("a  b")).toBe("a  b"); // internal spaces preserved (locators stay valid)
    expect(sourceHash("Hello world")).not.toBe(sourceHash("Hello  world"));
    expect(sourceHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
