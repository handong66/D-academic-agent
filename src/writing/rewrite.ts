import type { AnalyzedClaim } from "./report.js";

export interface RewriteSuggestion {
  suggestedRewrite?: string;
  riskNote?: string;
}

const TOP_LEVEL_CAUSAL_PREDICATE =
  /^(?<subject>[\s\S]*?\S)\s+(?<cue>causes?|leads to|results in)\s+(?<object>\S[\s\S]*)$/i;
const CAUSAL_CUE = /\b(causes?|leads to|results in)\b/gi;
const SUBORDINATE_INTRODUCER = /\b(because|although|while|if|that)\b/i;
const CONSERVATIVE_OVERCLAIM_NOTE = "Using a conservative wrapper because a safe in-place causal-cue edit wasn't possible.";

function appendCitationNeeded(text: string): string {
  const trimmed = text.trim();
  const punctuation = /([.!?])$/.exec(trimmed);
  if (!punctuation) return `${trimmed} (citation needed)`;
  return `${trimmed.slice(0, -1)} (citation needed)${punctuation[1]}`;
}

function lowerFirstLetter(text: string): string {
  const trimmed = text.trim();
  // Only lowercase a normal Capitalized word (e.g. "Screen" → "screen"); leave a leading
  // acronym ("COVID") or already-lowercase-leading token ("iPhone") untouched.
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : trimmed;
}

function replacementForCue(cue: string): string {
  const normalized = cue.toLowerCase();
  if (normalized === "cause") return "are associated with";
  return "is associated with";
}

function isWordApostrophe(text: string, index: number): boolean {
  return text[index] === "'" && /[A-Za-z]/.test(text[index - 1] ?? "") && /[A-Za-z]/.test(text[index + 1] ?? "");
}

function isInsideQuotation(text: string, index: number): boolean {
  let insideDouble = false;
  let insideSingle = false;

  for (let i = 0; i < index; i++) {
    const char = text[i];
    if (char === '"') {
      insideDouble = !insideDouble;
    } else if (char === "“") {
      insideDouble = true;
    } else if (char === "”") {
      insideDouble = false;
    } else if (char === "'") {
      if (!isWordApostrophe(text, i)) insideSingle = !insideSingle;
    } else if (char === "‘") {
      insideSingle = true;
    } else if (char === "’") {
      insideSingle = false;
    }
  }

  return insideDouble || insideSingle;
}

function clausePrefixBeforeCue(text: string, cueIndex: number): string {
  const prefix = text.slice(0, cueIndex);
  const boundary = Math.max(
    prefix.lastIndexOf("."),
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf(":"),
    prefix.lastIndexOf(","),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf("!"),
  );
  return prefix.slice(boundary + 1);
}

function isNegated(text: string, cueIndex: number, cueEnd: number): boolean {
  const beforeCue = text.slice(Math.max(0, cueIndex - 48), cueIndex).toLowerCase();
  const aroundCue = text.slice(Math.max(0, cueIndex - 48), Math.min(text.length, cueEnd + 24)).toLowerCase();

  return (
    /\b(?:do|does|did|can|could|should|would|may|might|will|is|are|was|were)?\s*not\s+$/i.test(beforeCue) ||
    /\b(?:doesn't|don't|didn't|cannot|can't|won't|isn't|aren't|wasn't|weren't|never)\s+$/i.test(beforeCue) ||
    /\bno\s+causal\b/i.test(aroundCue)
  );
}

function hasTopLevelPredicateShape(text: string, cueIndex: number, cue: string): boolean {
  const leadingWhitespace = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const match = TOP_LEVEL_CAUSAL_PREDICATE.exec(trimmed);
  if (!match?.groups) return false;
  const matchedCue = match.groups.cue;
  const matchedSubject = match.groups.subject;
  if (!matchedCue || !matchedSubject) return false;
  if (matchedCue.toLowerCase() !== cue.toLowerCase()) return false;

  const cueIndexInTrimmed = trimmed.toLowerCase().indexOf(matchedCue.toLowerCase(), matchedSubject.length);
  return cueIndexInTrimmed >= 0 && leadingWhitespace + cueIndexInTrimmed === cueIndex;
}

function canReplaceCausalCue(text: string, cueIndex: number, cue: string): boolean {
  if (!hasTopLevelPredicateShape(text, cueIndex, cue)) return false;
  if (isInsideQuotation(text, cueIndex)) return false;
  if (isNegated(text, cueIndex, cueIndex + cue.length)) return false;
  if (SUBORDINATE_INTRODUCER.test(clausePrefixBeforeCue(text, cueIndex))) return false;
  return true;
}

function replaceSafeCausalCue(text: string): string | undefined {
  for (const match of text.matchAll(CAUSAL_CUE)) {
    const cue = match[0];
    const cueIndex = match.index;
    if (cueIndex === undefined) continue;
    if (!canReplaceCausalCue(text, cueIndex, cue)) continue;
    return `${text.slice(0, cueIndex)}${replacementForCue(cue)}${text.slice(cueIndex + cue.length)}`;
  }
  return undefined;
}

export function suggestRewrite(claim: AnalyzedClaim): RewriteSuggestion {
  if (!claim.isFactual) return {};

  switch (claim.status) {
    case "needs_citation":
      return { suggestedRewrite: appendCitationNeeded(claim.text) };
    case "weakly_supported":
      return { suggestedRewrite: `Some evidence suggests that ${lowerFirstLetter(claim.text)}` };
    case "overclaimed": {
      const safeRewrite = replaceSafeCausalCue(claim.text);
      if (safeRewrite) return { suggestedRewrite: safeRewrite };
      return {
        suggestedRewrite: `Some evidence suggests an association rather than a causal effect: ${claim.text}`,
        riskNote: CONSERVATIVE_OVERCLAIM_NOTE,
      };
    }
    case "contradicted":
      return { riskNote: "A cited source contradicts this claim — reconsider or remove it." };
    case "unclear":
      return { riskNote: "Evidence is unclear — consider softening the claim or adding support." };
    case "supported":
      return {};
  }
}
