import { pipeline } from "@huggingface/transformers";
import type { Embedder } from "../retrieve/types.js";

type Pooling = "mean" | "cls";

type FeatureExtractionOutput = {
  tolist(): number[][];
};

type FeatureExtractionPipe = (
  texts: string[],
  opts: { pooling: Pooling; normalize: true },
) => Promise<FeatureExtractionOutput>;

export class TransformersEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;
  private readonly pooling: Pooling;
  private readonly queryPrefix?: string;
  private readonly docPrefix?: string;
  private pipe?: Promise<FeatureExtractionPipe>;

  constructor(opts: { model: string; dim: number; pooling?: Pooling; queryPrefix?: string; docPrefix?: string }) {
    this.model = opts.model;
    this.dim = opts.dim;
    this.pooling = opts.pooling ?? "mean";
    this.queryPrefix = opts.queryPrefix;
    this.docPrefix = opts.docPrefix;
  }

  async embed(texts: string[], role: "query" | "document" = "document"): Promise<number[][]> {
    const pipe = await this.getPipe();
    const prefix = role === "query" ? (this.queryPrefix ?? "") : (this.docPrefix ?? "");
    const prefixed = prefix ? texts.map((text) => `${prefix}${text}`) : texts;
    const out = await pipe(prefixed, { pooling: this.pooling, normalize: true });
    return out.tolist();
  }

  private getPipe(): Promise<FeatureExtractionPipe> {
    if (!this.pipe) {
      this.pipe = pipeline("feature-extraction", this.model, { progress_callback: undefined }) as Promise<FeatureExtractionPipe>;
    }
    return this.pipe;
  }
}
