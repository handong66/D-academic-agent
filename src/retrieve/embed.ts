import { createHash } from "node:crypto";
import type { Embedder } from "./types.js";

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const bucket = (t: string, dim: number) => parseInt(createHash("sha1").update(t).digest("hex").slice(0, 8), 16) % dim;

// Deterministic, offline, feature-hashing embedder for tests + reproducible seed eval.
export class HashEmbedder implements Embedder {
  readonly model: string;
  constructor(readonly dim = 256) {
    this.model = `hash-${dim}`;
  }
  async embed(texts: string[], role?: "query" | "document"): Promise<number[][]> {
    void role;
    return texts.map((t) => {
      const v = new Array<number>(this.dim).fill(0);
      for (const tok of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        const b = bucket(tok, this.dim);
        v[b] = (v[b] ?? 0) + 1; // noUncheckedIndexedAccess-safe
      }
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}

// Real provider-agnostic embedder (OpenAIEmbedder) lives in retrieve/openai-embedder.ts (Task 16); never unit-tested.
