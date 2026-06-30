import { describe, expect, it } from "vitest";
import {
  modelChoiceHelpKey,
  modelChoiceLabelKey,
  providerChoiceHelpKey,
  providerChoiceLabelKey,
  type ModelChoiceKind,
  type ProviderChoiceKind,
} from "../electron/renderer/lib.js";
import { dict } from "../electron/renderer/i18n.dict.js";

const providerChoices: Array<[ProviderChoiceKind, string]> = [
  ["embedder", "hash"],
  ["embedder", "transformers-local"],
  ["embedder", "openai-compatible"],
  ["judge", "mock"],
  ["judge", "transformers-nli"],
  ["judge", "openai-compatible"],
  ["pdf", "unpdf"],
  ["pdf", "grobid"],
];

const modelChoices: Array<[ModelChoiceKind, string]> = [
  ["embedder", "all-MiniLM-L6-v2"],
  ["embedder", "bge-small-en-v1.5"],
  ["embedder", "nomic-embed-text-v1.5"],
  ["judge", "nli-deberta-v3-xsmall"],
];

function expectTranslation(key: string): void {
  const entry = dict[key];
  expect(entry, key).toBeDefined();
  if (!entry) return;
  expect(entry.en.trim().length, key).toBeGreaterThan(0);
  expect(entry.zh.trim().length, key).toBeGreaterThan(0);
}

describe("renderer i18n dictionary", () => {
  it("has translations for user-facing hardening messages", () => {
    for (const key of [
      "common.sourceKey",
      "error.checkerStopped",
      "error.connectionFailed",
      "error.localModelUnknown",
      "error.unexpectedPrefix",
      "settings.advancedSampleSources",
      "settings.localPrivacy",
      "library.choosePdfButton",
      "library.untitledSource",
      "eval.trace.retrieveCited",
      "eval.trace.checkCited",
      "eval.trace.retrieveCounter",
      "eval.trace.checkCounter",
    ]) {
      expectTranslation(key);
    }
  });

  it("has translations for every user-facing provider choice", () => {
    expectTranslation("settings.choice.unknown.help");
    for (const [kind, id] of providerChoices) {
      expectTranslation(providerChoiceLabelKey(kind, id));
      expectTranslation(providerChoiceHelpKey(kind, id));
    }
  });

  it("has translations for every user-facing local model choice", () => {
    expectTranslation("settings.model.unknown.help");
    for (const [kind, id] of modelChoices) {
      expectTranslation(modelChoiceLabelKey(kind, id));
      expectTranslation(modelChoiceHelpKey(kind, id));
    }
  });
});
