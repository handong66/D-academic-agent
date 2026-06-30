import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MODEL_REGISTRY, NLI_MODEL_REGISTRY, downloadModel, getLocalModel, modelStatus } from "../src/providers/models.js";
import { getNliModel } from "../src/providers/model-registry.js";

describe("local model registry", () => {
  it("exports exactly the M5b local models", () => {
    expect(MODEL_REGISTRY).toEqual([
      { id: "all-MiniLM-L6-v2", hfId: "Xenova/all-MiniLM-L6-v2", dim: 384, pooling: "mean", license: "Apache-2.0", sizeLabel: "~23MB" },
      {
        id: "bge-small-en-v1.5",
        hfId: "Xenova/bge-small-en-v1.5",
        dim: 384,
        pooling: "cls",
        queryPrefix: "Represent this sentence for searching relevant passages: ",
        license: "MIT",
        sizeLabel: "~23MB",
      },
      {
        id: "nomic-embed-text-v1.5",
        hfId: "nomic-ai/nomic-embed-text-v1.5",
        dim: 768,
        pooling: "mean",
        queryPrefix: "search_query: ",
        docPrefix: "search_document: ",
        license: "Apache-2.0",
        sizeLabel: "~274MB",
      },
    ]);
  });

  it("defines required fields for each local model", () => {
    for (const model of MODEL_REGISTRY) {
      expect(model.id).toEqual(expect.any(String));
      expect(model.hfId).toEqual(expect.any(String));
      expect(model.dim).toEqual(expect.any(Number));
      expect(["mean", "cls"]).toContain(model.pooling);
      expect(model.license).toEqual(expect.any(String));
      expect(model.sizeLabel).toEqual(expect.any(String));
    }
  });

  it("looks up local models by id", () => {
    expect(getLocalModel("all-MiniLM-L6-v2")).toEqual({
      id: "all-MiniLM-L6-v2",
      hfId: "Xenova/all-MiniLM-L6-v2",
      dim: 384,
      pooling: "mean",
      license: "Apache-2.0",
      sizeLabel: "~23MB",
    });
    expect(getLocalModel("nonexistent")).toBeUndefined();
  });

  it("exports the separate default NLI model registry", () => {
    expect(NLI_MODEL_REGISTRY).toEqual([
      { id: "nli-deberta-v3-xsmall", hfId: "Xenova/nli-deberta-v3-xsmall", license: "MIT", sizeLabel: "~70MB" },
    ]);
    expect(getNliModel("nli-deberta-v3-xsmall")).toEqual({
      id: "nli-deberta-v3-xsmall",
      hfId: "Xenova/nli-deberta-v3-xsmall",
      license: "MIT",
      sizeLabel: "~70MB",
    });
    expect(() => getNliModel("nonexistent")).toThrow(/Unknown NLI model/);
  });

  it("reports absent for an empty cache directory without network access", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "d-academic-agent-empty-cache-"));

    await expect(modelStatus("all-MiniLM-L6-v2", cacheDir)).resolves.toBe("absent");
    await expect(modelStatus("nli-deberta-v3-xsmall", cacheDir)).resolves.toBe("absent");
  });

  it.skipIf(!process.env.M5_LIVE_EMBED)("downloads a gated live model", async () => {
    const onProgress = vi.fn();

    await expect(downloadModel("all-MiniLM-L6-v2", onProgress)).resolves.toBeUndefined();
  });
});
