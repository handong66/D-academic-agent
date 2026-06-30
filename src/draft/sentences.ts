export interface DraftSentence {
  index: number;
  char_start: number;
  char_end: number;
  text: string;
}

const SENTENCE_BOUNDARY = /[.?!](?=\s+[A-Z]|$)/g;

function findSentenceEnd(text: string, start: number): number {
  SENTENCE_BOUNDARY.lastIndex = start;
  const punctuationBoundary = SENTENCE_BOUNDARY.exec(text);
  const punctuationEnd = punctuationBoundary ? punctuationBoundary.index + 1 : undefined;
  const newlineIndex = text.indexOf("\n", start);
  const newlineEnd = newlineIndex >= 0 ? newlineIndex : undefined;
  if (punctuationEnd === undefined) return newlineEnd ?? text.length;
  if (newlineEnd === undefined) return punctuationEnd;
  return Math.min(punctuationEnd, newlineEnd);
}

export function splitSentences(text: string): DraftSentence[] {
  const sentences: DraftSentence[] = [];
  let start = 0;

  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start]!)) start++;
    if (start >= text.length) break;

    const char_end = findSentenceEnd(text, start);
    const sentenceText = text.slice(start, char_end);

    sentences.push({
      index: sentences.length,
      char_start: start,
      char_end,
      text: sentenceText,
    });

    start = char_end;
  }

  return sentences;
}
