import { afterEach, describe, expect, it, vi } from "vitest";

describe("TransformersEmbedder", () => {
  afterEach(() => {
    vi.doUnmock("@huggingface/transformers");
    vi.resetModules();
  });

  it("sets model and dim without creating a pipeline", async () => {
    const pipeline = vi.fn();
    vi.doMock("@huggingface/transformers", () => ({ pipeline, env: {} }));
    const { TransformersEmbedder } = await import("../src/providers/transformers-embedder.js");

    const embedder = new TransformersEmbedder({ model: "mock-model", dim: 384 });

    expect(embedder.model).toBe("mock-model");
    expect(embedder.dim).toBe(384);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("loads the pipeline lazily, prefixes documents, normalizes, and reuses the pipe", async () => {
    const tolist = vi.fn(() => [[1, 0], [0, 1]]);
    const pipe = vi.fn(async () => ({ tolist }));
    const pipeline = vi.fn(async () => pipe);
    vi.doMock("@huggingface/transformers", () => ({ pipeline, env: {} }));
    const { TransformersEmbedder } = await import("../src/providers/transformers-embedder.js");

    const embedder = new TransformersEmbedder({ model: "mock-model", dim: 2, pooling: "cls", docPrefix: "passage: " });

    expect(pipeline).not.toHaveBeenCalled();
    const vectors = await embedder.embed(["alpha", "beta"]);
    const second = await embedder.embed(["gamma"]);

    expect(vectors).toEqual([[1, 0], [0, 1]]);
    expect(second).toEqual([[1, 0], [0, 1]]);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledWith("feature-extraction", "mock-model", { progress_callback: undefined });
    expect(pipe).toHaveBeenNthCalledWith(1, ["passage: alpha", "passage: beta"], { pooling: "cls", normalize: true });
    expect(pipe).toHaveBeenNthCalledWith(2, ["passage: gamma"], { pooling: "cls", normalize: true });
  });

  it("applies query prefix when embedding queries", async () => {
    const tolist = vi.fn(() => [[1, 0], [0, 1]]);
    const pipe = vi.fn(async () => ({ tolist }));
    const pipeline = vi.fn(async () => pipe);
    vi.doMock("@huggingface/transformers", () => ({ pipeline, env: {} }));
    const { TransformersEmbedder } = await import("../src/providers/transformers-embedder.js");

    const embedder = new TransformersEmbedder({
      model: "mock-model",
      dim: 2,
      queryPrefix: "query: ",
      docPrefix: "passage: ",
    });

    const vectors = await embedder.embed(["alpha", "beta"], "query");

    expect(vectors).toEqual([[1, 0], [0, 1]]);
    expect(pipe).toHaveBeenCalledWith(["query: alpha", "query: beta"], { pooling: "mean", normalize: true });
  });

  it.skipIf(!process.env.M5_LIVE_EMBED)("live embed", async () => {
    vi.doUnmock("@huggingface/transformers");
    vi.resetModules();
    const { TransformersEmbedder } = await import("../src/providers/transformers-embedder.js");
    const embedder = new TransformersEmbedder({ model: "Xenova/all-MiniLM-L6-v2", dim: 384 });

    const vectors = await embedder.embed(["x"]);

    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(384);
    expect(vectors[0]!.every((value) => Number.isFinite(value))).toBe(true);
  });
});
