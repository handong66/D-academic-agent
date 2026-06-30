import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGoldClaims } from "../src/eval/gold.js";
import { canonicalize, sourceHash } from "../src/ingest/hash.js";

interface LockedSource {
  id: string;
  path_or_url?: string;
  source_hash: string;
}

describe("gold claim integrity", () => {
  it("keeps gold locators aligned with the locked corpus sources", () => {
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    const lock = JSON.parse(readFileSync("fixtures/sources.lock.json", "utf8")) as LockedSource[];
    const lockById = new Map(lock.map((source) => [source.id, source]));

    for (const claim of gold) {
      const locked = lockById.get(claim.cited_source);
      expect(locked, `${claim.cited_source} missing from sources.lock.json`).toBeDefined();
      if (!locked) continue;

      const fallbackPath = join("fixtures", "corpus", `${claim.cited_source}.txt`);
      const corpusPath = locked.path_or_url && existsSync(locked.path_or_url) ? locked.path_or_url : fallbackPath;
      const text = canonicalize(readFileSync(corpusPath, "utf8"));

      expect(claim.locator.source_hash).toBe(locked.source_hash);
      expect(locked.source_hash).toBe(sourceHash(canonicalize(text)));
      expect(claim.locator.char_start).toBeGreaterThanOrEqual(0);
      expect(claim.locator.char_start).toBeLessThan(claim.locator.char_end);
      expect(claim.locator.char_end).toBeLessThanOrEqual(text.length);
      // The snippet must sit at the DECLARED span, not merely somewhere in the document (Codex W1):
      // an in-range but wrong offset would otherwise pass.
      expect(text.slice(claim.locator.char_start, claim.locator.char_end)).toBe(claim.snippet);
    }
  });
});
