const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/i;
const TRAILING_DOI_PUNCTUATION_RE = /[.,);]+$/;

export function extractDoiFromText(text: string): string | undefined {
  const match = DOI_RE.exec(text);
  if (!match) return undefined;
  return match[0].replace(TRAILING_DOI_PUNCTUATION_RE, "");
}
