import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleWorkerMessage } from "../src/app/protocol.js";
import { buildMockContext } from "../src/cli-ctx.js";
import { MockJudge, type Judge } from "../src/check/judge.js";
import { assembleSources } from "../src/corpus/assemble.js";
import { MockPlanner } from "../src/plan/planner.js";
import { runPlanAndCheck, type PlanFinding } from "../src/plan/orchestrate.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { buildIndex } from "../src/retrieve/index.js";

const thesis = "social media use is associated with adolescent depression";

function expectedThesisVerdict(findings: PlanFinding[]) {
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
  const verdict =
    total === 0 ? "insufficient" :
    consensus >= 0.67 ? "supported" :
    consensus <= 0.33 ? "refuted" :
    "contested";

  return { verdict, consensus, decisiveness, supporting, contradicting, mixed };
}

async function seedRetriever() {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  return buildIndex(sources, texts, new HashEmbedder(256));
}

const scriptedJudge: Judge = {
  model: "scripted-semantic-split",
  async judge({ snippet }) {
    const s = snippet.toLowerCase();
    if (s.includes("weak and inconsistent") || s.includes("very small")) {
      return { verdict: "contradicts", reason: "scripted corpus disagreement", confidence: 1, suggested_rewrite: "" };
    }
    if (s.includes("depressive symptoms")) {
      return { verdict: "supports", reason: "scripted twenge support", confidence: 1, suggested_rewrite: "" };
    }
    return { verdict: "unclear", reason: "scripted no relation", confidence: 0, suggested_rewrite: "" };
  },
};

describe("runPlanAndCheck", () => {
  it("captures semantic support/contradiction split with a contradiction-capable scripted judge", async () => {
    const result = await runPlanAndCheck(await seedRetriever(), new MockPlanner(), scriptedJudge, thesis, { budget: 36, judgeBudget: 36 });

    expect(result.thesis).toBe(thesis);
    expect(result.subqueries).toHaveLength(3);
    expect(result.summary.supporting_sources).toContain("twenge2018");
    expect(result.summary.contradicting_sources).toContain("odgers2020");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_id: "twenge2018", relation: "supports" }),
        expect.objectContaining({ source_id: "odgers2020", relation: "contradicts" }),
      ]),
    );
    expect(result.thesis_verdict).toEqual(expectedThesisVerdict(result.findings));
  });

  it("returns a structured evidence map with MockJudge and respects judgeBudget", async () => {
    const judgeBudget = 4;
    const result = await runPlanAndCheck(await seedRetriever(), new MockPlanner(), new MockJudge(), thesis, { budget: 18, judgeBudget });
    const planJudgeEvents = result.traces.filter((t) => t.event_type === "plan_judge");

    expect(new Set(result.findings.map((f) => f.source_id)).size).toBeGreaterThan(1);
    expect(result.traces.map((t) => t.event_type)).toContain("planner_plan");
    expect(result.traces.map((t) => t.event_type)).toContain("plan_retrieve");
    expect(planJudgeEvents.length).toBe(result.findings.length);
    expect(result.findings.length).toBeLessThanOrEqual(judgeBudget);
    expect(result.summary.supporting_sources).toEqual(expect.any(Array));
    expect(result.summary.contradicting_sources).toEqual(expect.any(Array));
    for (const finding of result.findings) {
      expect(Object.keys(finding).sort()).toEqual(["locator", "reason", "relation", "snippet", "source_id", "subquery"]);
      expect(finding).toEqual({
        source_id: expect.any(String),
        subquery: expect.any(String),
        snippet: expect.any(String),
        locator: expect.objectContaining({
          source_id: expect.any(String),
          source_hash: expect.any(String),
          char_start: expect.any(Number),
          char_end: expect.any(Number),
          section: expect.any(String),
          chunker_version: expect.any(String),
        }),
        relation: expect.stringMatching(/^(contradicts|supports|unrelated)$/),
        reason: expect.any(String),
      });
    }
  });

  it("emits additive stage events when onStage is provided", async () => {
    const events: Array<{ stage: string; detail: string }> = [];
    await runPlanAndCheck(await seedRetriever(), new MockPlanner(), new MockJudge(), thesis, {
      budget: 18,
      judgeBudget: 3,
      onStage: (stage, detail) => events.push({ stage, detail }),
    });

    expect(events.map((event) => event.stage)).toEqual(["plan", "retrieve", "judge", "judge", "judge", "report"]);
    expect(events[0]?.detail).toBe("3 subqueries");
    expect(events[1]?.detail).toMatch(/^\d+ evidence$/);
    expect(events.filter((event) => event.stage === "judge").map((event) => event.detail)).toEqual(["1/3 judged", "2/3 judged", "3/3 judged"]);
    expect(events.at(-1)).toEqual(expect.objectContaining({ stage: "report", detail: expect.any(String) }));
  });

  it("worker protocol returns a structured map without echoing unrelated secret-like input", async () => {
    const { ctx } = await buildMockContext();
    const secret = "sk-plan-check-secret";
    const res = await handleWorkerMessage({ id: "req-plan", type: "plan_and_check", thesis, judgeBudget: 3, secret }, ctx);

    expect(res.id).toBe("req-plan");
    expect(res.type).toBe("plan_check_result");
    if (res.type !== "plan_check_result") throw new Error("expected plan_check_result response");
    expect(res.thesis).toBe(thesis);
    expect(res.subqueries).toHaveLength(3);
    expect(res.findings.length).toBeLessThanOrEqual(3);
    expect(res.summary.supporting_sources).toEqual(expect.any(Array));
    expect(res.summary.contradicting_sources).toEqual(expect.any(Array));
    expect(res).toHaveProperty("thesis_verdict");
    expect(JSON.stringify(res)).not.toContain(secret);
  });

  it("worker protocol rejects a missing thesis with a sanitized error", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "req-bad-plan", type: "plan_and_check" }, ctx);

    expect(res).toEqual({
      id: "req-bad-plan",
      type: "error",
      message: "thesis must be a string",
    });
  });
});
