import { VERDICTS } from "../types.js";

export function confusionMatrix(gold: string[], pred: string[]): Record<string, Record<string, number>> {
  const cm: Record<string, Record<string, number>> = {};
  for (const v of VERDICTS) { cm[v] = {}; for (const w of VERDICTS) cm[v]![w] = 0; }
  gold.forEach((g, i) => {
    const p = pred[i] ?? "unclear";
    cm[g] = cm[g] ?? {};
    cm[g]![p] = (cm[g]![p] ?? 0) + 1;
  });
  return cm;
}

export function perClass(gold: string[], pred: string[]): Record<string, { precision: number; recall: number; f1: number }> {
  const out: Record<string, { precision: number; recall: number; f1: number }> = {};
  for (const L of VERDICTS) {
    let tp = 0, fp = 0, fn = 0;
    gold.forEach((g, i) => {
      const p = pred[i];
      if (p === L && g === L) tp++;
      else if (p === L && g !== L) fp++;
      else if (p !== L && g === L) fn++;
    });
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    out[L] = { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
  }
  return out;
}

export const macroF1 = (g: string[], p: string[]): number => {
  const v = Object.values(perClass(g, p));
  return v.length ? v.reduce((s, c) => s + c.f1, 0) / v.length : 0;
};

// Retrieval recall@k by half-open span overlap of the gold locator with retrieved chunk spans.
export function recallAtK(items: { gold: [number, number]; retrieved: [number, number][] }[], k: number): number {
  if (!items.length) return 0;
  const hit = items.filter((it) => it.retrieved.slice(0, k).some(([a, b]) => a < it.gold[1] && b > it.gold[0])).length;
  return hit / items.length;
}
