import { readFileSync } from "node:fs";
import { z } from "zod";
import { VERDICTS } from "../types.js";

export const Locator = z.object({
  source_id: z.string(),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  char_start: z.number().int().nonnegative(),
  char_end: z.number().int().positive(),
  section: z.string().optional(),
});

export const OVERCLAIM_DIMS = ["causality", "scope", "sample", "mentions_only"] as const;
export type OverclaimDim = (typeof OVERCLAIM_DIMS)[number];

export const GoldLabel = z.object({
  claim_text: z.string().min(1),
  cited_source: z.string().min(1),
  raw_citation: z.string().min(1),
  snippet: z.string().min(1),
  locator: Locator,
  label: z.enum(VERDICTS), // single source of verdict labels (doc-sync with src/types.ts)
  rationale: z.string().min(1),
  annotator: z.string().min(1),
  label_schema_version: z.string(),
  overclaim: z.enum(OVERCLAIM_DIMS).optional(),
});
export type GoldLabel = z.infer<typeof GoldLabel>;

export function loadGoldClaims(path: string): GoldLabel[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => GoldLabel.parse(JSON.parse(l)));
}
