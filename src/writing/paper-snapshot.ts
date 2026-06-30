import type { ToolContext } from "../tools/tools.js";

export interface PaperSnapshotSection {
  label: string;
  heading: string;
  excerpt: string;
}

export interface PaperSnapshot {
  sourceId: string;
  found: boolean;
  sparse: boolean;
  sections: PaperSnapshotSection[];
}

interface DetectedHeading {
  heading: string;
  labelHeading: string;
  lineIndex: number;
}

const MAX_HEADING_LENGTH = 60;
const MAX_EXCERPT_LENGTH = 300;

const SMALL_TITLE_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "vs", "with"]);

function withoutNumbering(line: string): string {
  return line.replace(/^(?:(?:\d+(?:\.\d+)*|[IVXLCDM]+)[.)]?\s+)/i, "").trim();
}

function hasTerminalPeriod(line: string): boolean {
  return /[.!?]$/.test(line);
}

function isAllCapsHeading(line: string): boolean {
  const letters = line.match(/[A-Za-z]/g) ?? [];
  return letters.length > 0 && letters.every((letter) => letter === letter.toUpperCase());
}

function isTitleCaseHeading(line: string): boolean {
  const words = line.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? [];
  const significantWords = words.filter((word) => !SMALL_TITLE_WORDS.has(word.toLowerCase()));
  return significantWords.length > 0 && significantWords.every((word) => /^[A-Z]/.test(word));
}

function detectHeading(rawLine: string, lineIndex: number): DetectedHeading | undefined {
  const heading = rawLine.trim();
  if (!heading || heading.length > MAX_HEADING_LENGTH || hasTerminalPeriod(heading)) return undefined;

  const labelHeading = withoutNumbering(heading);
  if (!labelHeading || labelHeading.length > MAX_HEADING_LENGTH) return undefined;
  if (!isAllCapsHeading(labelHeading) && !isTitleCaseHeading(labelHeading)) return undefined;

  return { heading, labelHeading, lineIndex };
}

function labelForHeading(heading: string): string {
  const normalized = heading.toLowerCase();
  if (/\babstract\b/.test(normalized)) return "abstract";
  if (/\b(introduction|background)\b/.test(normalized)) return "introduction";
  if (/\b(method|methods|methodology)\b/.test(normalized)) return "methods";
  if (/\bresults?\b/.test(normalized)) return "results";
  if (/\bdiscussion\b/.test(normalized)) return "discussion";
  if (/\blimitations?\b/.test(normalized)) return "limitations";
  if (/\b(conclusion|conclusions)\b/.test(normalized)) return "conclusion";
  if (/\breferences?\b/.test(normalized)) return "references";
  return "other";
}

function excerptBetween(lines: string[], startLine: number, endLine: number): string {
  const excerpt = lines.slice(startLine, endLine).join("\n").trim();
  return excerpt.length > MAX_EXCERPT_LENGTH ? excerpt.slice(0, MAX_EXCERPT_LENGTH) : excerpt;
}

export function paperSnapshot(sourceId: string, ctx: ToolContext): PaperSnapshot {
  const text = ctx.texts.get(sourceId);
  if (!text?.trim()) return { sourceId, found: false, sparse: true, sections: [] };

  const lines = text.split(/\r?\n/);
  const headings = lines
    .map((line, lineIndex) => detectHeading(line, lineIndex))
    .filter((heading): heading is DetectedHeading => heading !== undefined);

  const sections = headings.map((heading, index): PaperSnapshotSection => {
    const nextHeading = headings[index + 1];
    return {
      label: labelForHeading(heading.labelHeading),
      heading: heading.heading,
      excerpt: excerptBetween(lines, heading.lineIndex + 1, nextHeading?.lineIndex ?? lines.length),
    };
  });

  return {
    sourceId,
    found: true,
    sparse: sections.length === 0,
    sections,
  };
}
