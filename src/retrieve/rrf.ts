export interface FusedHit {
  id: string;
  rrf_score: number;
  bm25_rank: number;
  vector_rank: number;
  final_rank: number;
}

// Reciprocal Rank Fusion: score = sum_lists 1/(k + rank). Never add raw scores across spaces.
export function rrfFuse(rankings: string[][], k = 60): FusedHit[] {
  const ranks = rankings.map((r) => new Map(r.map((id, i) => [id, i + 1])));
  const out: FusedHit[] = [];
  for (const id of new Set(rankings.flat())) {
    let score = 0;
    for (const r of ranks) { const rank = r.get(id); if (rank) score += 1 / (k + rank); }
    out.push({ id, rrf_score: score, bm25_rank: ranks[0]?.get(id) ?? 0, vector_rank: ranks[1]?.get(id) ?? 0, final_rank: 0 });
  }
  out.sort((a, b) => b.rrf_score - a.rrf_score);
  out.forEach((h, i) => (h.final_rank = i + 1));
  return out;
}
