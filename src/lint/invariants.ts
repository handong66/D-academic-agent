import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../ingest/hash.js";
import { assembleSources } from "../corpus/assemble.js";
import { loadGoldClaims } from "../eval/gold.js";
import { VERDICTS } from "../types.js";

export interface LintIssue {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
}

// Gates-over-memory: spec invariants enforced executably (rule IDs map to spec sections).
export function runLint(corpusDir: string, goldPath: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const { sources } = assembleSources(corpusDir);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const gold = loadGoldClaims(goldPath);

  // HARNESS-§4-*-UNIQUE: source id / bibtex key uniqueness (Codex review)
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const seenAuthorYear = new Set<string>();
  for (const s of sources) {
    if (seenIds.has(s.id)) issues.push({ ruleId: "HARNESS-§4-SOURCE-ID-UNIQUE", severity: "error", message: `duplicate source id ${s.id}` });
    seenIds.add(s.id);
    const k = s.citation_metadata.bibtex_key;
    if (seenKeys.has(k)) issues.push({ ruleId: "HARNESS-§4-BIBKEY-UNIQUE", severity: "error", message: `duplicate bibtex key ${k}` });
    seenKeys.add(k);
    // author-year uniqueness: non-unique pairs make author-year citations ambiguous (Codex review)
    const ay = `${(s.authors[0] ?? "").toLowerCase()}|${s.year}`;
    if (seenAuthorYear.has(ay)) issues.push({ ruleId: "HARNESS-§4-AUTHOR-YEAR-UNIQUE", severity: "warning", message: `non-unique first-author+year (${ay}); author-year citations to it will be ambiguous` });
    seenAuthorYear.add(ay);
  }

  for (const g of gold) {
    const src = byId.get(g.cited_source);
    if (!src) {
      issues.push({ ruleId: "HARNESS-§9-GOLD-SOURCE-EXISTS", severity: "error", message: `gold cites unknown source ${g.cited_source}` });
      continue;
    }
    // locator.source_id must match cited_source (catches mis-bound locators) (Codex review)
    if (g.locator.source_id !== g.cited_source) {
      issues.push({ ruleId: "HARNESS-§9-LOCATOR-SOURCE-MATCH", severity: "error", message: `gold locator.source_id (${g.locator.source_id}) != cited_source (${g.cited_source})` });
    }
    const text = canonicalize(readFileSync(join(corpusDir, `${src.citation_metadata.bibtex_key}.txt`), "utf8"));
    if (!text.includes(g.snippet)) {
      issues.push({ ruleId: "HARNESS-§9-SNIPPET-CONTAINED", severity: "error", message: `snippet not found in ${g.cited_source}: "${g.snippet.slice(0, 40)}…"` });
    }
    if (text.slice(g.locator.char_start, g.locator.char_end) !== g.snippet) {
      issues.push({ ruleId: "HARNESS-§9-LOCATOR-SLICE", severity: "error", message: `locator offsets do not slice to the snippet for ${g.cited_source}` });
    }
    if (src.source_hash !== g.locator.source_hash) {
      issues.push({ ruleId: "HARNESS-§9-LOCATOR-HASH", severity: "error", message: `gold locator source_hash mismatch for ${g.cited_source} (stale fixture?)` });
    }
  }

  // HARNESS-§9-LABEL-COVERAGE: seed set should exercise every verdict (warning, not blocking)
  const seen = new Set(gold.map((g) => g.label));
  for (const v of VERDICTS) {
    if (!seen.has(v)) issues.push({ ruleId: "HARNESS-§9-LABEL-COVERAGE", severity: "warning", message: `seed gold has no "${v}" example` });
  }

  return issues;
}

// CLI (npm run lint): exit non-zero on any error.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const issues = runLint("fixtures/corpus", "fixtures/gold_claims.jsonl");
  for (const i of issues) console.log(`[${i.severity}] ${i.ruleId}: ${i.message}`);
  if (issues.some((i) => i.severity === "error")) process.exit(1);
  console.log(`lint ok (${issues.length} warning(s))`);
}
