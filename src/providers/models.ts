import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { AutoModelForSequenceClassification, AutoTokenizer, env, pipeline } from "@huggingface/transformers";
import { getLocalModel, MODEL_REGISTRY, NLI_MODEL_REGISTRY, type LocalModel, type NliModelEntry } from "./model-registry.js";

env.allowRemoteModels = false;

type DownloadableModel =
  | { kind: "embedder"; meta: LocalModel }
  | { kind: "nli"; meta: NliModelEntry };

export { getLocalModel, MODEL_REGISTRY, NLI_MODEL_REGISTRY, type LocalModel, type NliModelEntry };

export async function modelStatus(id: string, cacheDir = env.cacheDir ?? undefined): Promise<"present" | "absent"> {
  const model = resolveDownloadableModel(id);
  if (!model || !cacheDir) return "absent";

  const modelDir = join(cacheDir, model.meta.hfId);
  if (!existsSync(modelDir)) return "absent";
  return statSync(modelDir).isDirectory() ? "present" : "absent";
}

export async function downloadModel(id: string, onProgress?: (info: unknown) => void): Promise<void> {
  const model = resolveDownloadableModel(id);
  if (!model) {
    throw new Error(`Unknown local model: ${id}`);
  }

  try {
    env.allowRemoteModels = true;
    if (model.kind === "embedder") {
      await pipeline("feature-extraction", model.meta.hfId, { progress_callback: onProgress });
      return;
    }

    await Promise.all([
      AutoTokenizer.from_pretrained(model.meta.hfId, { progress_callback: onProgress }),
      AutoModelForSequenceClassification.from_pretrained(model.meta.hfId, { progress_callback: onProgress }),
    ]);
  } finally {
    env.allowRemoteModels = false;
  }
}

function resolveDownloadableModel(id: string): DownloadableModel | undefined {
  const model = getLocalModel(id);
  if (model) return { kind: "embedder", meta: model };

  const nliModel = NLI_MODEL_REGISTRY.find((entry) => entry.id === id);
  return nliModel ? { kind: "nli", meta: nliModel } : undefined;
}
