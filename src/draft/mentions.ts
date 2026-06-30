export interface Mention {
  raw_citation: string;
  char_start: number;
  char_end: number;
}

export type CitationMention = Mention;

const AUTHOR_YEAR = /\([A-Z][^)]*\b(?:19|20)\d{2}[a-z]?\)/g;
const TEX_CITE = /\\cite\{[^}]+\}/g;
const NUMERIC_BRACKET = /\[\d+\]/g;

export function extractMentions(text: string, offset: number): Mention[] {
  const mentions: Mention[] = [];

  for (const pattern of [AUTHOR_YEAR, TEX_CITE, NUMERIC_BRACKET]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const localStart = match.index;
      if (localStart === undefined) continue;
      const localEnd = localStart + match[0].length;
      mentions.push({
        raw_citation: text.slice(localStart, localEnd),
        char_start: offset + localStart,
        char_end: offset + localEnd,
      });
    }
  }

  mentions.sort((a, b) => a.char_start - b.char_start || a.char_end - b.char_end);

  const nonOverlapping: Mention[] = [];
  let lastEnd = -1;
  for (const mention of mentions) {
    if (mention.char_start >= lastEnd) {
      nonOverlapping.push(mention);
      lastEnd = mention.char_end;
    }
  }

  return nonOverlapping;
}
