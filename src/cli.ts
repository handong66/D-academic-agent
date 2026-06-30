import { fileURLToPath } from "node:url";
import { runEval } from "./eval/runner.js";
import { HashEmbedder } from "./retrieve/embed.js";
import { MockJudge } from "./check/judge.js";

export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "eval") {
    const out = flag("--out") ?? "out";
    const evalOpts = { corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: out };
    if (rest.includes("--mock")) {
      // offline, deterministic (CI + reproducible wiring)
      await runEval(evalOpts, new HashEmbedder(256), new MockJudge());
      return;
    }
    // real, provider-agnostic path: live numbers from an OpenAI-compatible endpoint
    const baseURL = process.env.AGENT_BASE_URL, model = process.env.AGENT_MODEL;
    if (!baseURL || !model) throw new Error("set AGENT_BASE_URL + AGENT_MODEL (optional AGENT_EMBED_MODEL/AGENT_EMBED_DIM/AGENT_API_KEY), or pass --mock for an offline run");
    const apiKey = process.env.AGENT_API_KEY;
    const embedModel = process.env.AGENT_EMBED_MODEL ?? model;
    const dim = Number(process.env.AGENT_EMBED_DIM ?? 1536);
    const { OpenAIEmbedder } = await import("./retrieve/openai-embedder.js");
    const { LlmJudge } = await import("./check/llm-judge.js");
    await runEval(evalOpts, new OpenAIEmbedder({ baseURL, apiKey, model: embedModel, dim }), new LlmJudge({ baseURL, apiKey, model }));
    return;
  }
  if (cmd === "replay") {
    const { loadTrace, summarizeTrace } = await import("./dx/replay.js");
    console.log(JSON.stringify(summarizeTrace(loadTrace(flag("--trace") ?? "out/trace.jsonl")), null, 2));
    return;
  }
  if (cmd === "plan") {
    if (!rest.includes("--mock")) throw new Error("plan: real planner needs AGENT_* env; pass --mock for an offline run");
    const { buildMockContext } = await import("./cli-ctx.js");
    const { MockPlanner } = await import("./plan/planner.js");
    const { runPlan } = await import("./plan/orchestrate.js");
    const c = await buildMockContext();
    const r = await runPlan(c.ctx.retriever, new MockPlanner(), flag("--q") ?? "", { k: 3 });
    console.log(JSON.stringify({ subqueries: r.plan.subqueries, evidence: r.evidence.map((e) => e.chunk_id) }, null, 2));
    return;
  }
  if (cmd === "drill") {
    const { drillFailures } = await import("./dx/drill.js");
    const { loadGoldClaims } = await import("./eval/gold.js");
    const { buildMockContext } = await import("./cli-ctx.js");
    const out = flag("--out") ?? "out";
    const c = await buildMockContext();
    const report = await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: out }, c.embedder, c.judge);
    console.log(JSON.stringify(drillFailures(report.failures, loadGoldClaims("fixtures/gold_claims.jsonl")), null, 2));
    return;
  }
  if (cmd === "coevo") {
    if (!rest.includes("--mock")) throw new Error("coevo: pass --mock for an offline run");
    const { runAblation } = await import("./coevo/ablation.js");
    const { writeFailureCases } = await import("./coevo/failure_cases.js");
    const { loadGoldClaims } = await import("./eval/gold.js");
    const { buildMockContext } = await import("./cli-ctx.js");
    const out = flag("--out") ?? "out";
    const c = await buildMockContext();
    const evalOpts = { corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: out };
    const report = await runEval(evalOpts, c.embedder, c.judge);
    const failure_cases = writeFailureCases(report.failures, loadGoldClaims(evalOpts.goldPath), {
      outDir: out,
      judge_model: c.judge.model,
      prompt_version: "check-1.0",
      run_id: "coevo-mock",
    });
    const ablation = await runAblation([
      { label: "k=1", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 1 },
      { label: "k=3", embedder: new HashEmbedder(256), judge: new MockJudge(), k: 3 },
    ], evalOpts);
    console.log(JSON.stringify({ failure_cases, ablation: ablation.variants }, null, 2));
    return;
  }
  if (cmd === "mcp") {
    const { startStdioServer } = await import("./mcp/stdio.js");
    await startStdioServer();
    return;
  }
  throw new Error(`unknown command: ${cmd ?? "(none)"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
