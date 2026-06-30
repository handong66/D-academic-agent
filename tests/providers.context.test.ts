import { describe, expect, it, vi } from "vitest";
import { LlmJudge } from "../src/check/llm-judge.js";
import { MockJudge } from "../src/check/judge.js";
import { NliJudge } from "../src/check/nli-judge.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { OpenAIEmbedder } from "../src/retrieve/openai-embedder.js";
import { checkClaimTool } from "../src/tools/tools.js";
import { defaultConfig } from "../src/providers/config.js";
import { buildContext, resolveEmbedder, resolveJudge } from "../src/providers/context.js";
import { TransformersEmbedder } from "../src/providers/transformers-embedder.js";

describe("provider context factories", () => {
  it("resolves built-in providers without secrets", () => {
    const embedder = resolveEmbedder({ provider: "hash", dim: 256 }, {});
    const judge = resolveJudge({ provider: "mock" }, {});
    expect(embedder).toBeInstanceOf(HashEmbedder);
    expect(embedder.dim).toBe(256);
    expect(judge).toBeInstanceOf(MockJudge);
    expect(judge.model).toBe("mock-judge");
  });

  it("constructs OpenAI-compatible providers from config + injected key, with no network call", () => {
    const embedSpy = vi.spyOn(OpenAIEmbedder.prototype, "embed");
    const judgeSpy = vi.spyOn(LlmJudge.prototype, "judge");
    const embedder = resolveEmbedder({ provider: "openai-compatible", model: "nomic-embed-text", baseURL: "http://localhost:11434/v1/", dim: 768 }, { "openai-compatible": "sk-test" });
    const judge = resolveJudge({ provider: "openai-compatible", model: "llama3.1", baseURL: "http://localhost:11434/v1/" }, { "openai-compatible": "sk-test" });
    expect(embedder).toBeInstanceOf(OpenAIEmbedder);
    expect(embedder.model).toBe("nomic-embed-text");
    expect(embedder.dim).toBe(768);
    expect(judge).toBeInstanceOf(LlmJudge);
    expect(judge.model).toBe("llama3.1");
    expect(embedSpy).not.toHaveBeenCalled();
    expect(judgeSpy).not.toHaveBeenCalled();
  });

  it("constructs a local transformers embedder from registry metadata without embedding", () => {
    const embedSpy = vi.spyOn(TransformersEmbedder.prototype, "embed");
    const embedder = resolveEmbedder({ provider: "transformers-local", model: "all-MiniLM-L6-v2" }, {});
    expect(embedder).toBeInstanceOf(TransformersEmbedder);
    expect(embedder.dim).toBe(384);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it("constructs a local transformers NLI judge from registry metadata without judging", () => {
    const judgeSpy = vi.spyOn(NliJudge.prototype, "judge");
    const judge = resolveJudge({ provider: "transformers-nli", model: "nli-deberta-v3-xsmall" }, {});
    expect(judge).toBeInstanceOf(NliJudge);
    expect(judge.model).toBe("nli-deberta-v3-xsmall");
    expect(judgeSpy).not.toHaveBeenCalled();
  });

  it("throws for unknown provider ids", () => {
    expect(() => resolveEmbedder({ provider: "missing" } as never, {})).toThrow(/Unknown embedder provider/);
    expect(() => resolveJudge({ provider: "missing" } as never, {})).toThrow(/Unknown judge provider/);
  });
});

describe("buildContext", () => {
  it("builds an offline ToolContext from hash + mock providers", async () => {
    const ctx = await buildContext(defaultConfig, "fixtures/corpus", {});
    const result = await checkClaimTool(ctx, { claim: "Social media use causes depression", cited_source: "twenge2018" });
    expect(ctx.sources).toHaveLength(6);
    expect(ctx.judge.model).toBe("mock-judge");
    expect(ctx.embedder).toBeInstanceOf(HashEmbedder); // active embedder on ctx → run_eval reflects the selected provider
    expect(result.cited_source_support.locator.source_id).toBe("twenge2018");
    expect(result.traces.some((trace) => trace.event_type === "judge_cited")).toBe(true);
  });
});
