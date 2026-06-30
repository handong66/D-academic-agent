import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Judge } from "../check/judge.js";
import { runEval } from "../eval/runner.js";
import type { Embedder } from "../retrieve/types.js";

export interface AblationVariant {
  label: string;
  embedder: Embedder;
  judge: Judge;
  k?: number;
  maxCandidates?: number;
}

export interface AblationBase {
  corpusDir: string;
  goldPath: string;
  outDir: string;
}

export interface AblationVariantResult {
  label: string;
  macro_f1: number;
  answer_groundedness: number;
  overclaim_recall: number;
  retrieval_recall_at_k: number;
  outbound_chars: number;
}

export interface AblationResult {
  variants: AblationVariantResult[];
}

export async function runAblation(variants: AblationVariant[], base: AblationBase): Promise<AblationResult> {
  const results: AblationVariantResult[] = [];
  for (const variant of variants) {
    const report = await runEval(
      { corpusDir: base.corpusDir, goldPath: base.goldPath, outDir: join(base.outDir, variant.label), k: variant.k, maxCandidates: variant.maxCandidates },
      variant.embedder,
      variant.judge,
    );
    results.push({
      label: variant.label,
      macro_f1: report.macro_f1,
      answer_groundedness: report.answer_groundedness,
      overclaim_recall: report.overclaim_recall,
      retrieval_recall_at_k: report.retrieval_recall_at_k,
      outbound_chars: report.policy_compliance.outbound_chars,
    });
  }

  mkdirSync(base.outDir, { recursive: true });
  writeFileSync(join(base.outDir, "ablation.md"), renderAblation(results));
  return { variants: results };
}

function renderAblation(variants: AblationVariantResult[]): string {
  const rows = variants
    .map((v) => `| ${v.label} | ${v.macro_f1.toFixed(3)} | ${v.answer_groundedness.toFixed(3)} | ${v.overclaim_recall.toFixed(3)} | ${v.retrieval_recall_at_k.toFixed(3)} | ${v.outbound_chars} |`)
    .join("\n");
  return `# Ablation Report (seed, reporting-only)\n\n> Seed set — NOT an authoritative benchmark. No pass/fail threshold.\n> Agentic rows labelled diagnostic-probe are risk probes: iterating candidates can lower macro-F1 or answer groundedness, and is not a default gain.\n\n| variant | macro-F1 | answer groundedness | overclaim recall | retrieval recall@k | outbound chars |\n|---|---:|---:|---:|---:|---:|\n${rows}\n`;
}
