import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GoldLabel } from "../eval/gold.js";
import type { EvalReport } from "../eval/runner.js";

type EvalFailure = EvalReport["failures"][number];

export interface FailureCasesMeta {
  outDir: string;
  judge_model: string;
  prompt_version: string;
  run_id: string;
}

export function writeFailureCases(failures: EvalFailure[], gold: GoldLabel[], meta: FailureCasesMeta): string {
  const byPair = new Map(gold.map((g) => [JSON.stringify([g.claim_text, g.cited_source]), g]));
  const records = failures.map((f) => {
    const g = byPair.get(JSON.stringify([f.claim, f.cited_source]));
    return {
      claim: f.claim,
      cited_source: f.cited_source,
      gold_label: g?.label ?? f.gold,
      pred_label: f.pred,
      snippet: g?.snippet ?? "",
      rationale: g?.rationale ?? "",
      judge_model: meta.judge_model,
      prompt_version: meta.prompt_version,
      run_id: meta.run_id,
    };
  });
  mkdirSync(meta.outDir, { recursive: true });
  const path = join(meta.outDir, "failure_cases.jsonl");
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  return path;
}
