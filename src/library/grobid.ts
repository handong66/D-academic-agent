import { XMLParser } from "fast-xml-parser";
import { canonicalize, sourceHash } from "../ingest/hash.js";
import { chunkSource } from "../retrieve/chunk.js";
import type { Chunk } from "../retrieve/types.js";
import type { Source } from "../types.js";
import type { PdfParser } from "./parser.js";

type PdfMeta = { id: string; embedding_model: string; embedding_dim: number };
type TeiRecord = Record<string, unknown>;
export type Reference = { title?: string; author?: string; year?: string; doi?: string };

function isRecord(value: unknown): value is TeiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function child(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ").trim();
  if (!isRecord(value)) return "";

  const direct = value["#text"];
  if (direct !== undefined) return textOf(direct);

  return Object.entries(value)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, nested]) => textOf(nested))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function attr(value: unknown, key: string): string {
  const raw = child(first(value), `@_${key}`);
  return typeof raw === "string" ? raw : "";
}

function surnameOf(author: unknown): string {
  const persName = first(child(author, "persName"));
  return textOf(child(persName, "surname"));
}

function firstBiblStruct(teiRoot: unknown): unknown {
  const fileDesc = child(child(child(teiRoot, "teiHeader"), "fileDesc"), "sourceDesc");
  return first(child(fileDesc, "biblStruct"));
}

function biblTitle(biblStruct: unknown): string {
  return textOf(first(child(child(biblStruct, "analytic"), "title")));
}

function biblAuthor(biblStruct: unknown): string {
  return surnameOf(first(child(child(biblStruct, "analytic"), "author")));
}

function biblYear(biblStruct: unknown): string {
  const imprint = child(child(biblStruct, "monogr"), "imprint");
  return attr(child(imprint, "date"), "when");
}

function biblDoi(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const doi = biblDoi(item);
      if (doi) return doi;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  for (const idno of arrayOf(child(value, "idno"))) {
    if (attr(idno, "type").toLowerCase() === "doi") {
      const doi = textOf(idno).trim();
      if (doi) return doi;
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith("@_") || key === "idno") continue;
    const doi = biblDoi(nested);
    if (doi) return doi;
  }
  return undefined;
}

function findBiblStructs(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(findBiblStructs);
  if (!isRecord(value)) return [];

  const direct = child(value, "biblStruct");
  const found = arrayOf(direct);
  return [
    ...found,
    ...Object.entries(value)
      .filter(([key]) => !key.startsWith("@_") && key !== "biblStruct")
      .flatMap(([, nested]) => findBiblStructs(nested)),
  ];
}

function definedReference(ref: Reference): Reference {
  return Object.fromEntries(Object.entries(ref).filter(([, value]) => value)) as Reference;
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}${path}`;
}

export function teiToSourceChunks(
  tei: string,
  meta: PdfMeta,
): { source: Source; chunks: Chunk[]; references: Reference[] } {
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(tei) as TeiRecord;
  const teiRoot = parsed.TEI ?? parsed;
  const biblStruct = firstBiblStruct(teiRoot);
  const fileDesc = child(child(teiRoot, "teiHeader"), "fileDesc");
  const title = textOf(first(child(child(fileDesc, "titleStmt"), "title")));
  const authors = arrayOf(child(child(biblStruct, "analytic"), "author")).map(surnameOf).filter(Boolean);
  const hash = sourceHash(canonicalize(tei));
  const divs = arrayOf(child(child(child(teiRoot, "text"), "body"), "div"));
  const chunks: Chunk[] = [];
  let textOffset = 0;
  let ordinal = 0;

  for (const div of divs) {
    const section = textOf(child(div, "head")) || "body";
    const paragraphs = arrayOf(child(div, "p")).map(textOf).filter(Boolean);
    const divText = paragraphs.join("\n");
    if (!divText) continue;

    const divChunks = chunkSource(meta.id, hash, divText, meta.embedding_model, meta.embedding_dim);
    for (const chunk of divChunks) {
      chunks.push({
        ...chunk,
        id: `${meta.id}#${ordinal}`,
        ordinal,
        section,
        char_start: textOffset + chunk.char_start,
        char_end: textOffset + chunk.char_end,
      });
      ordinal++;
    }
    textOffset += divText.length;
  }

  const references = findBiblStructs(child(child(teiRoot, "text"), "back"))
    .map((ref) => definedReference({ title: biblTitle(ref), author: biblAuthor(ref), year: biblYear(ref), doi: biblDoi(ref) }))
    .filter((ref) => Object.keys(ref).length > 0);
  const doi = biblDoi(biblStruct);

  return {
    source: {
      id: meta.id,
      title,
      authors,
      year: biblYear(biblStruct),
      type: "pdf",
      path_or_url: "",
      source_hash: hash,
      citation_metadata: { bibtex_key: meta.id, ...(doi === undefined ? {} : { doi }), raw: { references } },
      fulltext_status: "indexed",
    },
    chunks,
    references,
  };
}

export async function grobidAvailable(baseURL: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint(baseURL, "/api/isalive"));
    return response.status === 200;
  } catch {
    return false;
  }
}

export class GrobidParser implements PdfParser {
  readonly baseURL: string;

  constructor(opts: { baseURL: string }) {
    this.baseURL = opts.baseURL;
  }

  async parse(bytes: Uint8Array, meta: PdfMeta): Promise<{ source: Source; chunks: Chunk[] }> {
    const form = new FormData();
    const pdfData = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(pdfData).set(bytes);
    form.append("input", new Blob([pdfData], { type: "application/pdf" }), `${meta.id}.pdf`);

    const response = await fetch(endpoint(this.baseURL, "/api/processFulltextDocument"), {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error(`GROBID processFulltextDocument failed: ${response.status}`);

    const tei = await response.text();
    const { source, chunks } = teiToSourceChunks(tei, meta);
    return { source, chunks };
  }
}
