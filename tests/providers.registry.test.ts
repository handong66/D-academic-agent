import { describe, expect, it } from "vitest";
import { PROVIDERS, embedderProviders, getProvider, judgeProviders, pdfProviders } from "../src/providers/registry.js";

describe("provider registry", () => {
  it("exports the exact M5a provider descriptors", () => {
    expect(PROVIDERS).toEqual([
      { id: "hash", kind: "embedder", location: "builtin", needsKey: false },
      { id: "openai-compatible", kind: "embedder", location: "remote", needsKey: true },
      { id: "transformers-local", kind: "embedder", location: "local-download", needsKey: false },
      { id: "mock", kind: "judge", location: "builtin", needsKey: false },
      { id: "openai-compatible", kind: "judge", location: "remote", needsKey: true },
      { id: "transformers-nli", kind: "judge", location: "local-download", needsKey: false },
      { id: "unpdf", kind: "pdf", location: "builtin", needsKey: false },
      { id: "grobid", kind: "pdf", location: "local-download", needsKey: false },
    ]);
  });

  it("filters providers by kind", () => {
    expect(embedderProviders().map((p) => p.id)).toEqual(["hash", "openai-compatible", "transformers-local"]);
    expect(judgeProviders().map((p) => p.id)).toEqual(["mock", "openai-compatible", "transformers-nli"]);
    expect(pdfProviders().map((p) => p.id)).toEqual(["unpdf", "grobid"]);
  });

  it("looks up providers by kind and id", () => {
    expect(getProvider("embedder", "openai-compatible")).toEqual({ id: "openai-compatible", kind: "embedder", location: "remote", needsKey: true });
    expect(getProvider("judge", "openai-compatible")).toEqual({ id: "openai-compatible", kind: "judge", location: "remote", needsKey: true });
    expect(getProvider("pdf", "openai-compatible")).toBeUndefined();
  });
});
