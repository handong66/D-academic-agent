import type { PlanFinding } from "./orchestrate.js"; // type-only, avoids runtime cycles

export const THESIS_VERDICTS = ["supported","contested","refuted","insufficient"] as const;
export type ThesisVerdictLabel = (typeof THESIS_VERDICTS)[number];
export interface ThesisVerdict { verdict: ThesisVerdictLabel; consensus: number; decisiveness: number; supporting: number; contradicting: number; mixed: number; }

export function synthesizeThesisVerdict(findings: PlanFinding[]): ThesisVerdict {
  const bySource = new Map<string, { supports: number; contradicts: number }>();

  for (const finding of findings) {
    if (finding.relation !== "supports" && finding.relation !== "contradicts") continue;
    const counts = bySource.get(finding.source_id) ?? { supports: 0, contradicts: 0 };
    if (finding.relation === "supports") counts.supports += 1;
    if (finding.relation === "contradicts") counts.contradicts += 1;
    bySource.set(finding.source_id, counts);
  }

  let supporting = 0;
  let contradicting = 0;
  let mixed = 0;

  for (const counts of bySource.values()) {
    if (counts.supports > counts.contradicts) supporting += 1;
    else if (counts.contradicts > counts.supports) contradicting += 1;
    else if (counts.supports > 0) mixed += 1;
  }

  const directional = supporting + contradicting;
  const total = directional + mixed;
  const consensus = directional > 0 ? supporting / directional : (mixed > 0 ? 0.5 : 0);
  const decisiveness = directional === 0 ? 0 : Number((Math.abs(consensus - 0.5) * 2).toFixed(12));
  const verdict: ThesisVerdictLabel =
    total === 0 ? "insufficient" :
    consensus >= 0.67 ? "supported" :
    consensus <= 0.33 ? "refuted" :
    "contested";

  return { verdict, consensus, decisiveness, supporting, contradicting, mixed };
}
