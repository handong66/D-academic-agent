import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LlmJudge } from "../check/llm-judge.js";
import { MockJudge, type Judge } from "../check/judge.js";
import { NliJudge } from "../check/nli-judge.js";
import { assembleSources } from "../corpus/assemble.js";
import { HashEmbedder } from "../retrieve/embed.js";
import { buildIndex } from "../retrieve/index.js";
import { OpenAIEmbedder } from "../retrieve/openai-embedder.js";
import type { Embedder } from "../retrieve/types.js";
import { makeToolContext, type ToolContext } from "../tools/tools.js";
import { AppConfigSchema, type AppConfig, type EmbedderConfig, type JudgeConfig } from "./config.js";
import { getNliModel } from "./model-registry.js";
import { getLocalModel } from "./models.js";
import { TransformersEmbedder } from "./transformers-embedder.js";

// secrets carry ONLY the API key (by provider id / keyRef). Non-secret params (model/baseURL/dim)
// come from the persisted config, never from secrets.
const apiKey = (secrets: Record<string, string>): string | undefined => secrets["openai-compatible"] ?? secrets.apiKey;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function resolveEmbedder(cfg: EmbedderConfig, secrets: Record<string, string>): Embedder {
  switch (cfg.provider) {
    case "hash":
      return new HashEmbedder(cfg.dim ?? 256);
    case "openai-compatible":
      return new OpenAIEmbedder({ baseURL: cfg.baseURL ?? DEFAULT_BASE_URL, apiKey: apiKey(secrets), model: cfg.model ?? "text-embedding-3-small", dim: cfg.dim ?? 1536 });
    case "transformers-local": {
      const modelId = cfg.model ?? "all-MiniLM-L6-v2";
      const meta = getLocalModel(modelId);
      if (!meta) throw new Error(`Unknown local model: ${modelId}`);
      return new TransformersEmbedder({
        model: meta.hfId,
        dim: meta.dim, // the model's dim is authoritative for local models — config can't override it
        pooling: meta.pooling,
        queryPrefix: meta.queryPrefix,
        docPrefix: meta.docPrefix,
      });
    }
    default:
      throw new Error(`Unknown embedder provider: ${(cfg as { provider: string }).provider}`);
  }
}

export function resolveJudge(cfg: JudgeConfig, secrets: Record<string, string>): Judge {
  switch (cfg.provider) {
    case "mock":
      return new MockJudge();
    case "openai-compatible":
      return new LlmJudge({ baseURL: cfg.baseURL ?? DEFAULT_BASE_URL, apiKey: apiKey(secrets), model: cfg.model ?? "gpt-4o-mini" });
    case "transformers-nli": {
      const modelId = cfg.model ?? "nli-deberta-v3-xsmall";
      const meta = getNliModel(modelId);
      return new NliJudge({ hfId: meta.hfId, id: meta.id });
    }
    default:
      throw new Error(`Unknown judge provider: ${(cfg as { provider: string }).provider}`);
  }
}

// Config-driven generalization of buildMockContext (which stays for tests). Switching the embedder ⇒ re-index (§5).
export async function buildContext(config: AppConfig, corpusDir: string, secrets: Record<string, string>): Promise<ToolContext> {
  const parsed = AppConfigSchema.parse(config);
  const embedder = resolveEmbedder(parsed.embedder, secrets);
  const judge = resolveJudge(parsed.judge, secrets);
  const { sources } = assembleSources(corpusDir);
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join(corpusDir, `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  const retriever = await buildIndex(sources, texts, embedder);
  return makeToolContext(sources, texts, retriever, judge, embedder);
}
