import { describe, expect, it, vi } from "vitest";
import { buildIndexFromStored } from "../src/retrieve/index.js";
import type { Chunk, Embedder } from "../src/retrieve/types.js";

const hash = "b".repeat(64);

function storedChunk(id: string, sourceId: string, text: string, ordinal: number): Chunk {
  return {
    id,
    source_id: sourceId,
    source_hash: hash,
    ordinal,
    section: "body",
    char_start: 0,
    char_end: text.length,
    text,
    chunker_version: "1.0",
    embedding_model: "stored-2",
    embedding_dim: 2,
  };
}

function queryEmbedder() {
  const embed = vi.fn(async (texts: string[], _role?: "query" | "document"): Promise<number[][]> => texts.map(() => [1, 0]));
  const embedder: Embedder = { model: "stored-2", dim: 2, embed };
  return { embedder, embed };
}

describe("buildIndexFromStored", () => {
  it("retrieves against stored vectors without embedding documents during build", async () => {
    const target = storedChunk("s1#0", "s1", "alpha body text", 0);
    const miss = storedChunk("s2#0", "s2", "beta body text", 0);
    const vectors = new Map([
      [target.id, [1, 0]],
      [miss.id, [0, 1]],
    ]);
    const { embedder, embed } = queryEmbedder();

    const retriever = buildIndexFromStored([target, miss], vectors, embedder);
    const hits = await retriever.retrieve("zqxj unseen", { k: 1 });

    expect(hits[0]?.chunk.id).toBe(target.id);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(["zqxj unseen"], "query");
  });

  it("throws when a stored vector is missing or has the wrong dimension", () => {
    const chunk = storedChunk("s1#0", "s1", "alpha body text", 0);
    const { embedder } = queryEmbedder();

    expect(() => buildIndexFromStored([chunk], new Map(), embedder)).toThrow(/missing vector/i);
    expect(() => buildIndexFromStored([chunk], new Map([[chunk.id, [1]]]), embedder)).toThrow(/dimension/i);
  });
});
