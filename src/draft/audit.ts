import { checkClaim } from "../check/check.js";
import type { Locator } from "../check/check.js";
import type { TraceEvent } from "../trace/trace.js";
import type { ToolContext } from "../tools/tools.js";
import type { Verdict } from "../types.js";
import { extractMentions } from "./mentions.js";
import type { Mention } from "./mentions.js";
import { splitSentences } from "./sentences.js";
import type { DraftSentence } from "./sentences.js";

export interface MentionSupport {
  verdict: Verdict;
  locator: Locator;
  quote: string;
  reason: string;
  suggested_rewrite: string;
  confidence: number;
}

export interface MentionAudit extends Mention {
  status: "resolved" | "unresolved" | "ambiguous";
  source_id?: string;
  support?: MentionSupport;
  counterevidence_found?: boolean;
}

export interface SentenceAudit extends DraftSentence {
  mentions: MentionAudit[];
}

export interface DraftAudit {
  sentences: SentenceAudit[];
  traces: TraceEvent[];
}

export async function auditDraft(draftText: string, ctx: ToolContext): Promise<DraftAudit> {
  const traces: TraceEvent[] = [];
  const sentences: SentenceAudit[] = [];

  for (const sentence of splitSentences(draftText)) {
    const mentions: MentionAudit[] = [];

    for (const mention of extractMentions(sentence.text, sentence.char_start)) {
      const resolution = ctx.resolver.resolve(mention.raw_citation);
      const audit: MentionAudit = {
        ...mention,
        status: resolution.status,
        source_id: resolution.source_id,
      };

      if (resolution.status === "resolved" && resolution.source_id) {
        const check = await checkClaim({ claim: sentence.text, cited_source: resolution.source_id }, ctx.retriever, ctx.judge);
        audit.support = {
          verdict: check.cited_source_support.verdict,
          locator: check.cited_source_support.locator,
          quote: check.cited_source_support.quote,
          reason: check.cited_source_support.reason,
          suggested_rewrite: check.cited_source_support.suggested_rewrite,
          confidence: check.cited_source_support.confidence,
        };
        audit.counterevidence_found = check.corpus_counterevidence.found;
        traces.push(...check.traces);
      }

      mentions.push(audit);
    }

    sentences.push({
      ...sentence,
      mentions,
    });
  }

  return { sentences, traces };
}
