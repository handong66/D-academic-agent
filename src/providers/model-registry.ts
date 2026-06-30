export type LocalModel = {
  id: string;
  hfId: string;
  dim: number;
  pooling: "mean" | "cls";
  queryPrefix?: string;
  docPrefix?: string;
  license: string;
  sizeLabel: string;
};

export type NliModelEntry = {
  id: string;
  hfId: string;
  license: string;
  sizeLabel: string;
};

// NOTE: local embedding is role-aware: Embedder.embed(texts, "query") applies query prefixes,
// while document embedding uses the default document role.
export const MODEL_REGISTRY: LocalModel[] = [
  { id: "all-MiniLM-L6-v2", hfId: "Xenova/all-MiniLM-L6-v2", dim: 384, pooling: "mean", license: "Apache-2.0", sizeLabel: "~23MB" },
  { id: "bge-small-en-v1.5", hfId: "Xenova/bge-small-en-v1.5", dim: 384, pooling: "cls", queryPrefix: "Represent this sentence for searching relevant passages: ", license: "MIT", sizeLabel: "~23MB" },
  { id: "nomic-embed-text-v1.5", hfId: "nomic-ai/nomic-embed-text-v1.5", dim: 768, pooling: "mean", queryPrefix: "search_query: ", docPrefix: "search_document: ", license: "Apache-2.0", sizeLabel: "~274MB" },
];

export const NLI_MODEL_REGISTRY: NliModelEntry[] = [
  { id: "nli-deberta-v3-xsmall", hfId: "Xenova/nli-deberta-v3-xsmall", license: "MIT", sizeLabel: "~70MB" },
];

export function getLocalModel(id: string): LocalModel | undefined {
  return MODEL_REGISTRY.find((model) => model.id === id);
}

export function getNliModel(id: string): NliModelEntry {
  const model = NLI_MODEL_REGISTRY.find((entry) => entry.id === id);
  if (!model) throw new Error(`Unknown NLI model: ${id}`);
  return model;
}
