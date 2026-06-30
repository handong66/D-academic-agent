import { embedMany } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Embedder } from "./types.js";

// Real, provider-agnostic embedder for an OpenAI-compatible endpoint.
// Never unit-tested (needs a live key/endpoint); selected by the CLI non-mock path.
export class OpenAIEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;
  private readonly embeddingModel;
  constructor(opts: { baseURL: string; apiKey?: string; model: string; dim: number }) {
    const provider = createOpenAICompatible({ name: "agent", baseURL: opts.baseURL, apiKey: opts.apiKey });
    this.embeddingModel = provider.textEmbeddingModel(opts.model);
    this.model = opts.model;
    this.dim = opts.dim;
  }
  async embed(texts: string[], role?: "query" | "document"): Promise<number[][]> {
    void role;
    const { embeddings } = await embedMany({ model: this.embeddingModel, values: texts });
    return embeddings;
  }
}
