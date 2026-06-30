import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Embedder } from "../retrieve/types.js";
import type { Judge } from "../check/judge.js";
import { assembleSources } from "../corpus/assemble.js";
import { loadGoldClaims } from "./gold.js";
import { buildIndex } from "../retrieve/index.js";
import { checkClaim } from "../check/check.js";
import { confusionMatrix, perClass, macroF1, recallAtK } from "./metrics.js";
import type { TraceEvent } from "../trace/trace.js";
import { policyCompliance, type PolicyCompliance } from "./policy.js";
import type { Verdict } from "../types.js";

const POSITIVE_SUPPORT = new Set<string>(["supports", "weakly_supports"]);

export interface EvalReport {
  n: number;
  macro_f1: number;
  retrieval_recall_at_k: number;
  overclaim_recall: number;
  answer_groundedness: number;
  policy_compliance: PolicyCompliance;
  confusion: Record<string, Record<string, number>>;
  per_class: Record<string, { precision: number; recall: number; f1: number }>;
  failures: { claim: string; gold: string; pred: string; cited_source: string }[];
}

export async function runEval(opts: { corpusDir: string; goldPath: string; outDir: string; k?: number; maxCandidates?: number }, embedder: Embedder, judge: Judge): Promise<EvalReport> {
  const k = opts.k ?? 3;
  const { sources } = assembleSources(opts.corpusDir);
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join(opts.corpusDir, `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  const retriever = await buildIndex(sources, texts, embedder);
  const gold = loadGoldClaims(opts.goldPath);

  const goldL: string[] = [], predL: string[] = [], traces: TraceEvent[] = [];
  const policyResults: { verdict: Verdict; source_hash: string }[] = [];
  const recallItems: { gold: [number, number]; retrieved: [number, number][] }[] = [];
  const failures: { claim: string; gold: string; pred: string; cited_source: string }[] = [];
  for (const g of gold) {
    const r = await checkClaim({ claim: g.claim_text, cited_source: g.cited_source }, retriever, judge, k, { maxCandidates: opts.maxCandidates });
    goldL.push(g.label);
    predL.push(r.cited_source_support.verdict);
    policyResults.push({
      verdict: r.cited_source_support.verdict,
      source_hash: r.cited_source_support.locator.source_hash,
    });
    if (g.label !== r.cited_source_support.verdict) failures.push({ claim: g.claim_text, gold: g.label, pred: r.cited_source_support.verdict, cited_source: g.cited_source });
    const hits = await retriever.retrieve(g.claim_text, { k, sourceId: g.cited_source });
    recallItems.push({ gold: [g.locator.char_start, g.locator.char_end], retrieved: hits.map((h) => [h.chunk.char_start, h.chunk.char_end] as [number, number]) });
    traces.push(...r.traces);
  }
  // overclaim DETECTION recall: of overclaim-tagged gold, the fraction the checker did NOT endorse as
  // "supports" (i.e. correctly declined to back the overclaim). A detector metric, not severity-correct (Codex review).
  const overclaimGold = gold.map((g, i) => ({ g, pred: predL[i]! })).filter((x) => x.g.overclaim);
  const overclaim_recall = overclaimGold.length ? overclaimGold.filter((x) => x.pred !== "supports").length / overclaimGold.length : 0;
  const predPos = predL.map((pred, i) => ({ pred, i })).filter(({ pred }) => POSITIVE_SUPPORT.has(pred));
  const answer_groundedness = predPos.length ? predPos.filter(({ i }) => POSITIVE_SUPPORT.has(goldL[i] ?? "")).length / predPos.length : 0;
  const policy_compliance = policyCompliance(policyResults, traces);

  const report: EvalReport = {
    n: gold.length,
    macro_f1: macroF1(goldL, predL),
    retrieval_recall_at_k: recallAtK(recallItems, k),
    overclaim_recall,
    answer_groundedness,
    policy_compliance,
    confusion: confusionMatrix(goldL, predL),
    per_class: perClass(goldL, predL),
    failures,
  };

  // RUNNER persists (tools stayed pure). Reporting-only: no pass/fail threshold.
  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(join(opts.outDir, "trace.jsonl"), traces.map((t) => JSON.stringify(t)).join("\n") + "\n");
  writeFileSync(join(opts.outDir, "report.md"), render(report, judge.model, embedder.model, k));
  return report;
}

function render(r: EvalReport, judge: string, embedder: string, k: number): string {
  const labels = Object.keys(r.per_class);
  const head = `| gold\\pred | ${labels.join(" | ")} |\n|${"---|".repeat(labels.length + 1)}`;
  const conf = labels.map((g) => `| ${g} | ${labels.map((p) => r.confusion[g]?.[p] ?? 0).join(" | ")} |`).join("\n");
  const pc = labels.map((L) => `| ${L} | ${r.per_class[L]!.precision.toFixed(2)} | ${r.per_class[L]!.recall.toFixed(2)} | ${r.per_class[L]!.f1.toFixed(2)} |`).join("\n");
  const fail = r.failures.map((f) => `- [${f.gold}→${f.pred}] ${f.claim}`).join("\n") || "- (none)";
  return `# Eval Report (seed, reporting-only)\n\njudge=${judge} · embedder=${embedder} · n=${r.n} · macro-F1=${r.macro_f1.toFixed(3)} · retrieval recall@${k}=${r.retrieval_recall_at_k.toFixed(3)} · overclaim recall=${r.overclaim_recall.toFixed(3)} · answer groundedness=${r.answer_groundedness.toFixed(3)} · policy grounded locators=${r.policy_compliance.grounded_locator_rate.toFixed(3)} · snippet-only=${r.policy_compliance.snippet_only_rate.toFixed(3)} · outbound chars=${r.policy_compliance.outbound_chars}\n\n> Seed set — NOT an authoritative benchmark. No pass/fail threshold.\n\n## Per-class\n| label | P | R | F1 |\n|---|---|---|---|\n${pc}\n\n## Confusion\n${head}\n${conf}\n\n## Failures\n${fail}\n`;
}
