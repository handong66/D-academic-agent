import { extractMentions } from "../draft/mentions.js";
import { splitSentences } from "../draft/sentences.js";

export type WritingClaimType =
  | "background"
  | "association"
  | "causal"
  | "comparison"
  | "method"
  | "limitation"
  | "definition";

export interface WritingClaim {
  id: string;
  text: string;
  sentenceIndex: number;
  claimType: WritingClaimType;
  citedKeys: string[];
  isFactual: boolean;
}

interface ClaimTypeRule {
  claimType: WritingClaimType;
  patterns: readonly RegExp[];
}

// Priority order is intentional: more specific claim relations win before
// broader background/definition cues when a sentence contains multiple cues.
const CLAIM_TYPE_RULES: readonly ClaimTypeRule[] = [
  {
    claimType: "causal",
    patterns: [/\bcauses?\b/i, /\bleads to\b/i, /\bresults in\b/i, /\bbecause\b/i, /\bdue to\b/i, /\beffect of\b/i],
  },
  {
    claimType: "comparison",
    patterns: [/\bmore\b/i, /\bless\b/i, /\bgreater\b/i, /\bhigher\b/i, /\blower\b/i, /\bthan\b/i, /\bcompared\b/i],
  },
  {
    claimType: "association",
    patterns: [/\bassociated\b/i, /\blinked\b/i, /\bcorrelated\b/i, /\brelated\b/i, /\bpredicts\b/i],
  },
  {
    claimType: "method",
    patterns: [/\bwe measured\b/i, /\busing\b/i, /\bmethod\b/i, /\bprocedure\b/i, /\bsampled\b/i],
  },
  {
    claimType: "limitation",
    patterns: [/\bhowever\b/i, /\blimitation\b/i, /\bcaveat\b/i, /\bmay not\b/i],
  },
  {
    claimType: "definition",
    patterns: [/\bis defined as\b/i, /\brefers to\b/i, /\bis a\b/i],
  },
];

const PURE_TRANSITIONS = new Set([
  "however",
  "therefore",
  "moreover",
  "furthermore",
  "additionally",
  "meanwhile",
  "consequently",
  "thus",
  "nevertheless",
  "nonetheless",
  "in contrast",
  "on the other hand",
  "for example",
  "in conclusion",
]);

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function claimId(paragraph: string, sentenceIndex: number): string {
  return `claim-${sentenceIndex}-${stableHash(`${paragraph}\0${sentenceIndex}`)}`;
}

function classifyClaim(text: string): WritingClaimType {
  for (const rule of CLAIM_TYPE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.claimType;
  }
  return "background";
}

export function classifyClaimText(text: string): WritingClaimType {
  return classifyClaim(text);
}

function withoutCitationMarkers(text: string): string {
  return text.replace(/\([A-Z][^)]*\b(?:19|20)\d{2}[a-z]?\)/g, " ").replace(/\\cite\{[^}]+\}/g, " ").replace(/\[\d+\]/g, " ");
}

function isPureTransition(text: string): boolean {
  const normalized = withoutCitationMarkers(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return PURE_TRANSITIONS.has(normalized);
}

// Factuality is intentionally shallow: questions, empty/no-content sentences,
// and standalone transition/connective words are not treated as factual claims.
function isFactualSentence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith("?")) return false;
  if (!/[A-Za-z0-9]/.test(withoutCitationMarkers(trimmed))) return false;
  if (isPureTransition(trimmed)) return false;
  return true;
}

export function extractClaims(paragraph: string): WritingClaim[] {
  return splitSentences(paragraph).map((sentence) => ({
    id: claimId(paragraph, sentence.index),
    text: sentence.text,
    sentenceIndex: sentence.index,
    claimType: classifyClaimText(sentence.text),
    citedKeys: extractMentions(sentence.text, sentence.char_start).map((mention) => mention.raw_citation),
    isFactual: isFactualSentence(sentence.text),
  }));
}
