// Generates fixtures/gold_claims.jsonl from hand-authored specs below.
// The HUMAN judgement is in `specs` (claim / snippet / label / rationale / overclaim);
// char offsets and source_hash are computed mechanically from the frozen corpus
// so locators are always exact (avoids the manual-offset errors flagged in review).
// Re-run: `npx tsx scripts/build_gold.ts`. The lint (HARNESS-§9-*) gates the output.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalize } from "../src/ingest/hash.js";
import { assembleSources } from "../src/corpus/assemble.js";
import type { OverclaimDim } from "../src/eval/gold.js";

const CORPUS = "fixtures/corpus";
const { sources } = assembleSources(CORPUS);
const byId = new Map(sources.map((s) => [s.id, s]));

interface Spec {
  source: string;
  raw_citation: string;
  claim: string;
  snippet: string;
  label: "supports" | "weakly_supports" | "unsupported" | "contradicts" | "unclear";
  rationale: string;
  overclaim?: OverclaimDim;
}

const specs: Spec[] = [
  { source: "twenge2018", raw_citation: "(Twenge, 2018)", claim: "Heavier social media use is associated with more depressive symptoms among adolescents.", snippet: "report more depressive symptoms in large cross-sectional surveys", label: "supports", rationale: "source reports the association directly" },
  { source: "twenge2018", raw_citation: "(Twenge, 2018)", claim: "Social media use causes depression in adolescents.", snippet: "the study does not establish that social media use causes depression", label: "unsupported", rationale: "causal overclaim: source is correlational", overclaim: "causality" },
  { source: "twenge2018", raw_citation: "(Twenge, 2018)", claim: "Social media has a large effect on adolescent depression.", snippet: "Effects were small in absolute terms", label: "contradicts", rationale: "source reports small effects; claim says large", overclaim: "sample" },
  { source: "twenge2018", raw_citation: "(Twenge, 2018)", claim: "Associations were stronger for girls than for boys.", snippet: "stronger among girls than among boys", label: "supports", rationale: "directly stated" },
  { source: "orben2019", raw_citation: "(Orben, 2019)", claim: "Digital technology use is negatively associated with adolescent well-being.", snippet: "the association between digital technology use and adolescent well-being was negative but very small", label: "supports", rationale: "snippet directly states a negative association; claim asserts direction only, not magnitude (Codex final review)" },
  { source: "orben2019", raw_citation: "(Orben, 2019)", claim: "Social media use explains most of the variance in adolescent well-being.", snippet: "Social media use explained well under one percent of the variation in well-being", label: "contradicts", rationale: "source: <1%; claim: most", overclaim: "sample" },
  { source: "orben2019", raw_citation: "(Orben, 2019)", claim: "Digital technology use causes lower adolescent well-being.", snippet: "The authors caution against strong causal claims", label: "unsupported", rationale: "authors explicitly caution against causal claims", overclaim: "causality" },
  { source: "primack2017", raw_citation: "(Primack, 2017)", claim: "Higher social media use is associated with greater perceived social isolation in young adults.", snippet: "higher social media use was associated with greater perceived social isolation", label: "supports", rationale: "directly stated" },
  { source: "primack2017", raw_citation: "(Primack, 2017)", claim: "The use-isolation association was dose-dependent.", snippet: "The relationship was dose-dependent across quartiles of use", label: "supports", rationale: "directly stated" },
  { source: "primack2017", raw_citation: "(Primack, 2017)", claim: "Social media use leads to social isolation.", snippet: "cannot determine the direction of causation", label: "unsupported", rationale: "cross-sectional; causal direction not established", overclaim: "causality" },
  { source: "primack2017", raw_citation: "(Primack, 2017)", claim: "Isolation effects are identical across all age groups.", snippet: "national sample of young adults", label: "unsupported", rationale: "young adults only; no age-group comparison (out of scope)", overclaim: "scope" },
  { source: "riehm2019", raw_citation: "(Riehm, 2019)", claim: "More social media time predicted later internalizing problems in a longitudinal cohort.", snippet: "more time on social media predicted later internalizing problems", label: "supports", rationale: "directly stated, longitudinal" },
  { source: "riehm2019", raw_citation: "(Riehm, 2019)", claim: "Using social media more than three hours per day was linked to elevated internalizing symptom risk.", snippet: "more than three hours per day had elevated risk of internalizing symptoms", label: "supports", rationale: "directly stated" },
  { source: "riehm2019", raw_citation: "(Riehm, 2019)", claim: "Social media use causes internalizing problems.", snippet: "more time on social media predicted later internalizing problems", label: "weakly_supports", rationale: "snippet shows longitudinal temporal prediction (weak causal evidence); full causation not established (Codex final review: snippet-only)", overclaim: "causality" },
  { source: "odgers2020", raw_citation: "(Odgers, 2020)", claim: "There is strong, consistent evidence that social media harms adolescent mental health.", snippet: "the evidence linking adolescent social media use to mental health harm is weak and inconsistent", label: "contradicts", rationale: "source: weak & inconsistent; claim: strong & consistent", overclaim: "sample" },
  { source: "odgers2020", raw_citation: "(Odgers, 2020)", claim: "Most reported associations between social media use and adolescent mental health are small.", snippet: "Most reported associations are small", label: "supports", rationale: "directly stated" },
  { source: "odgers2020", raw_citation: "(Odgers, 2020)", claim: "Social media effects depend on the adolescent's personality.", snippet: "of unclear practical significance", label: "unclear", rationale: "snippet does not address personality moderation; insufficient to judge" },
  { source: "odgers2020", raw_citation: "(Odgers, 2020)", claim: "Social media use reduces adolescents' academic performance.", snippet: "public concern has outpaced the actual evidence", label: "unsupported", rationale: "source does not address academic performance (off-topic)", overclaim: "mentions_only" },
  { source: "keles2020", raw_citation: "(Keles, 2020)", claim: "Higher social media use was associated with depression, anxiety, and distress in adolescents.", snippet: "associated with each of the three outcomes across the included studies", label: "supports", rationale: "directly stated across outcomes" },
  { source: "keles2020", raw_citation: "(Keles, 2020)", claim: "A systematic review examined depression, anxiety, and distress in adolescents in relation to social media.", snippet: "This systematic review examined depression, anxiety, and psychological distress in adolescents", label: "supports", rationale: "descriptive claim, directly stated" },
  { source: "keles2020", raw_citation: "(Keles, 2020)", claim: "Social media use robustly causes adolescent depression.", snippet: "substantial methodological heterogeneity and heavy reliance on self-report measures", label: "unsupported", rationale: "review of associations with heavy caveats; no causal claim", overclaim: "causality" },
  { source: "keles2020", raw_citation: "(Keles, 2020)", claim: "Social media is the leading cause of adolescent anxiety.", snippet: "associated with each of the three outcomes across the included studies", label: "unsupported", rationale: "causal + ranking overclaim ('leading cause'); snippet shows association only (Codex final review)", overclaim: "causality" },
  { source: "primack2017", raw_citation: "(Primack, 2017)", claim: "Social media use markedly increases perceived social isolation in young adults.", snippet: "higher social media use was associated with greater perceived social isolation", label: "weakly_supports", rationale: "snippet supports an association only; 'markedly increases' overstates strength and implies causation", overclaim: "causality" },
];

const lines = specs.map((sp) => {
  const src = byId.get(sp.source);
  if (!src) throw new Error(`build_gold: unknown source ${sp.source}`);
  const text = canonicalize(readFileSync(join(CORPUS, `${src.citation_metadata.bibtex_key}.txt`), "utf8"));
  const char_start = text.indexOf(sp.snippet);
  if (char_start < 0) throw new Error(`build_gold: snippet not found in ${sp.source}: "${sp.snippet}"`);
  return JSON.stringify({
    claim_text: sp.claim,
    cited_source: sp.source,
    raw_citation: sp.raw_citation,
    snippet: sp.snippet,
    locator: { source_id: sp.source, source_hash: src.source_hash, char_start, char_end: char_start + sp.snippet.length },
    label: sp.label,
    rationale: sp.rationale,
    annotator: "han",
    label_schema_version: "1.0",
    ...(sp.overclaim ? { overclaim: sp.overclaim } : {}),
  });
});

writeFileSync("fixtures/gold_claims.jsonl", lines.join("\n") + "\n");
console.log(`wrote fixtures/gold_claims.jsonl (${lines.length} labels, ${specs.filter((s) => s.overclaim).length} overclaim-tagged)`);
