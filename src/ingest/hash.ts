import { createHash } from "node:crypto";

// Canonical form = the exact text M1 chunkers and gold locators index into.
// Only line endings are normalized so char offsets are stable across OS; internal whitespace is preserved.
export function canonicalize(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sourceHash(content: string): string {
  return createHash("sha256").update(canonicalize(content), "utf8").digest("hex");
}
