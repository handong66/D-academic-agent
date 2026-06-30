import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { env } from "@huggingface/transformers";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { runAblation } from "../src/coevo/ablation.js";
import { createWorkerRuntime } from "../src/app/worker-runtime.js";

function parseLine(line: string): any {
  return JSON.parse(line);
}

describe("runAblation", () => {
  it("runs the seed eval per variant and returns comparable metrics", async () => {
    const base = { corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: mkdtempSync(join(tmpdir(), "abl-")) };
    const r = await runAblation([
      { label: "k=1", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 1 },
      { label: "k=3", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 3 },
      { label: "k=3-agentic-diagnostic-probe", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 3, maxCandidates: 3 },
    ], base);
    expect(r.variants.map((v) => v.label)).toEqual(["k=1", "k=3", "k=3-agentic-diagnostic-probe"]);
    // reporting-only: each variant yields a complete, comparable metric set + the ablation.md artifact.
    // No recall monotonicity invariant is claimed — retrieve uses a k-dependent candidate window, so the
    // two variants are distinct retrieval runs and a fixed direction is not guaranteed by construction.
    for (const v of r.variants) {
      expect(Number.isFinite(v.macro_f1)).toBe(true);
      expect(v.retrieval_recall_at_k).toBeGreaterThanOrEqual(0);
      expect(v.retrieval_recall_at_k).toBeLessThanOrEqual(1);
      expect(v.overclaim_recall).toBeGreaterThanOrEqual(0);
      expect(v.overclaim_recall).toBeLessThanOrEqual(1);
      expect(v.answer_groundedness).toBeGreaterThanOrEqual(0);
      expect(v.answer_groundedness).toBeLessThanOrEqual(1);
      expect(Number.isFinite(v.outbound_chars)).toBe(true);
      expect(v.outbound_chars).toBeGreaterThanOrEqual(0);
    }
    // M6δ privacy cost: at the same k, the agentic variant judges extra candidates on unclear claims, so it
    // sends MORE snippets out than the single-shot variant — the agent loop's privacy cost, quantified (Codex 互评).
    const k3 = r.variants.find((v) => v.label === "k=3")!;
    const agentic = r.variants.find((v) => v.label === "k=3-agentic-diagnostic-probe")!;
    expect(agentic.outbound_chars).toBeGreaterThan(k3.outbound_chars);
    expect(existsSync(join(base.outDir, "ablation.md"))).toBe(true);
    const ablationMd = readFileSync(join(base.outDir, "ablation.md"), "utf8");
    expect(ablationMd).toContain("answer groundedness");
    expect(ablationMd).toContain("outbound chars");
    expect(ablationMd).toContain("diagnostic-probe");
    expect(ablationMd).toContain("can lower macro-F1 or answer groundedness");

    const repeatBase = { ...base, outDir: mkdtempSync(join(tmpdir(), "abl-repeat-")) };
    const repeat = await runAblation([
      { label: "k=1", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 1 },
      { label: "k=3", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 3 },
      { label: "k=3-agentic-diagnostic-probe", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 3, maxCandidates: 3 },
    ], repeatBase);
    expect(repeat.variants).toEqual(r.variants);
  });

  it("handles worker run_ablation offline and skips uncached local variants", async () => {
    const previousCacheDir = env.cacheDir;
    env.cacheDir = mkdtempSync(join(tmpdir(), "abl-empty-cache-"));

    try {
      const libraryDir = mkdtempSync(join(tmpdir(), "abl-worker-library-"));
      const rt = await createWorkerRuntime({ corpusDir: "fixtures/corpus", libraryPath: join(libraryDir, "library.db") });
      const first = parseLine(await rt.handleLine(JSON.stringify({ id: "abl-1", type: "run_ablation" })));
      const second = parseLine(await rt.handleLine(JSON.stringify({ id: "abl-2", type: "run_ablation" })));

      expect(first.id).toBe("abl-1");
      expect(first.type).toBe("ablation_result");
      expect(first.rows.map((row: { label: string }) => row.label)).toEqual(["hash+mock", "hash+mock+agentic-diagnostic-probe"]);
      expect(typeof first.rows[0].answer_groundedness).toBe("number");
      expect(typeof first.rows[1].answer_groundedness).toBe("number");
      expect(typeof first.rows[0].outbound_chars).toBe("number");
      expect(typeof first.rows[1].outbound_chars).toBe("number");
      expect(first.skipped).toEqual(["all-MiniLM+mock", "all-MiniLM+NLI"]);
      expect(first.mdPath.endsWith("ablation.md")).toBe(true);
      expect(existsSync(first.mdPath)).toBe(true);
      expect(second.rows).toEqual(first.rows);
      expect(second.skipped).toEqual(first.skipped);
    } finally {
      env.cacheDir = previousCacheDir;
    }
  });
});
