import { AutoModelForSequenceClassification, AutoTokenizer, env, softmax } from "@huggingface/transformers";
import type { Verdict } from "../types.js";
import type { Judge, JudgeInput, JudgeOutput } from "./judge.js";

export type NliScores = {
  entailment: number;
  neutral: number;
  contradiction: number;
};

type NliVerdict = {
  verdict: Verdict;
  confidence: number;
};

type NliModel = {
  config?: {
    id2label?: Record<string, string>;
  };
  (inputs: unknown): Promise<{
    logits: {
      data: ArrayLike<number>;
    };
  }>;
};

type NliTokenizer = (text: string, options: { text_pair: string; padding: true; truncation: true }) => unknown;

export function mapNliToVerdict(scores: NliScores): NliVerdict {
  const entries = [
    ["entailment", scores.entailment],
    ["neutral", scores.neutral],
    ["contradiction", scores.contradiction],
  ] as const;
  const [label, confidence] = entries.reduce((best, current) => (current[1] > best[1] ? current : best));
  // A tie at the top (e.g. entailment == contradiction) is maximally ambiguous — stay conservative (Codex W2).
  const tiedAtTop = entries.filter(([, value]) => value === confidence).length > 1;

  if (confidence < 0.5 || tiedAtTop) return { verdict: "unclear", confidence };
  if (label === "entailment") {
    return { verdict: confidence >= 0.75 ? "supports" : "weakly_supports", confidence };
  }
  if (label === "contradiction") return { verdict: "contradicts", confidence };
  return { verdict: "unclear", confidence };
}

export class NliJudge implements Judge {
  readonly model: string;
  private readonly hfId: string;
  private loaded?: Promise<{ tokenizer: NliTokenizer; model: NliModel }>;

  constructor({ hfId, id }: { hfId: string; id?: string }) {
    this.hfId = hfId;
    this.model = id ?? hfId;
  }

  async judge({ claim, snippet }: JudgeInput): Promise<JudgeOutput> {
    env.allowRemoteModels = false;
    const { tokenizer, model } = await this.load();
    const inputs = tokenizer(snippet, { text_pair: claim, padding: true, truncation: true });
    const { logits } = await model(inputs);
    const scores = scoresFromLogits(logits.data, model.config?.id2label);
    const mapped = mapNliToVerdict(scores);

    return {
      ...mapped,
      reason: `NLI: entailment=${scores.entailment.toFixed(2)} neutral=${scores.neutral.toFixed(2)} contradiction=${scores.contradiction.toFixed(2)}`,
      suggested_rewrite: "",
    };
  }

  private load(): Promise<{ tokenizer: NliTokenizer; model: NliModel }> {
    env.allowRemoteModels = false;
    if (!this.loaded) {
      this.loaded = Promise.all([
        AutoTokenizer.from_pretrained(this.hfId),
        AutoModelForSequenceClassification.from_pretrained(this.hfId),
      ])
        .then(([tokenizer, model]) => ({
          tokenizer: tokenizer as NliTokenizer,
          model: model as NliModel,
        }))
        .catch((error: unknown) => {
          this.loaded = undefined;
          throw error;
        });
    }
    return this.loaded;
  }
}

function scoresFromLogits(logits: ArrayLike<number>, id2label: Record<string, string> | undefined): NliScores {
  const probabilities = Array.from(softmax(Array.from(logits)));
  const scores: Partial<NliScores> = {};

  for (const [index, rawLabel] of Object.entries(id2label ?? {})) {
    const probability = probabilities[Number(index)];
    if (probability === undefined) continue;

    const label = normalizeNliLabel(rawLabel);
    if (label) scores[label] = probability;
  }

  if (scores.entailment === undefined || scores.neutral === undefined || scores.contradiction === undefined) {
    throw new Error(
      `NLI model config id2label must include entailment, neutral, and contradiction labels (got: ${JSON.stringify(id2label ?? {})})`,
    );
  }

  return {
    entailment: scores.entailment,
    neutral: scores.neutral,
    contradiction: scores.contradiction,
  };
}

function normalizeNliLabel(label: string): keyof NliScores | undefined {
  const normalized = label.toLowerCase();
  if (normalized.includes("entail")) return "entailment";
  if (normalized.includes("neutral")) return "neutral";
  if (normalized.includes("contrad")) return "contradiction";
  return undefined;
}
