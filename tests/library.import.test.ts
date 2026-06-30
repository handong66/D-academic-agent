import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { importPdf } from "../src/library/import.js";
import { openLibrary, type Library } from "../src/library/library.js";
import { UnpdfParser, type PdfParser } from "../src/library/parser.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { buildIndexFromStored } from "../src/retrieve/index.js";
import type { Chunk, Embedder } from "../src/retrieve/types.js";
import type { Source } from "../src/types.js";

let library: Library | undefined;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `d-academic-agent-import-${randomUUID()}`);
  mkdirSync(dir);
  tempDirs.push(dir);
  return dir;
}

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([420, 520]);
    page.drawText(text, { x: 30, y: 470, size: 12, font });
  }
  return doc.save();
}

class CountingEmbedder implements Embedder {
  readonly model = "hash-256";
  readonly dim = 256;
  calls = 0;
  private readonly embedder = new HashEmbedder(256);

  embed(texts: string[], role?: "query" | "document"): Promise<number[][]> {
    this.calls++;
    return this.embedder.embed(texts, role);
  }
}

function parserWithFirstChunk(text: string): PdfParser {
  return {
    async parse(_bytes, meta) {
      const sourceHash = `hash-${meta.id}`;
      const source: Source = {
        id: meta.id,
        title: meta.id,
        authors: [],
        year: "",
        type: "pdf",
        path_or_url: "",
        source_hash: sourceHash,
        citation_metadata: { bibtex_key: meta.id },
        fulltext_status: "indexed",
      };
      const chunk: Chunk = {
        id: `${meta.id}#0`,
        source_id: meta.id,
        source_hash: sourceHash,
        ordinal: 0,
        section: "body",
        char_start: 0,
        char_end: text.length,
        text,
        chunker_version: "1.0",
        embedding_model: meta.embedding_model,
        embedding_dim: meta.embedding_dim,
      };
      return { source, chunks: [chunk] };
    },
  };
}

afterEach(() => {
  library?.close();
  library = undefined;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("importPdf", () => {
  it("imports a parsed PDF into the library and retrieves page-tagged stored chunks", async () => {
    const bytes = await makePdf([
      "Adolescent social media depression symptoms are discussed in this study.",
      "The second page covers methods and sampling limitations.",
    ]);
    library = openLibrary(join(makeTempDir(), "library.db"));

    const { source, duplicate } = await importPdf(bytes, {
      id: "mypdf",
      parser: new UnpdfParser(),
      embedder: new HashEmbedder(256),
      library,
    });

    expect(duplicate).toBe(false);
    expect(source.id).toBe("mypdf");
    expect(library.listSources()).toContainEqual(expect.objectContaining({ id: "mypdf", type: "pdf" }));

    const stored = library.loadAll();
    const retriever = buildIndexFromStored(stored.chunks, stored.vectors, new HashEmbedder(256));
    const hits = await retriever.retrieve("social media depression", { k: 3 });

    expect(hits.length).toBeGreaterThan(0);
    const matched = hits.filter((hit) => hit.chunk.source_id === "mypdf");
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((hit) => typeof hit.chunk.page_start === "number")).toBe(true);
  });

  it("rejects a zero-chunk import and leaves the library empty (seed fallback survives)", async () => {
    library = openLibrary(join(makeTempDir(), "library.db"));
    const emptyParser: PdfParser = {
      async parse(_bytes, meta) {
        return {
          source: {
            id: meta.id,
            title: "Scanned image, no text layer",
            authors: [],
            year: "2020",
            type: "pdf",
            path_or_url: "",
            source_hash: "deadbeef",
            citation_metadata: { bibtex_key: meta.id },
            fulltext_status: "indexed",
          },
          chunks: [],
        };
      },
    };

    await expect(
      importPdf(new Uint8Array(), { id: "empty", parser: emptyParser, embedder: new HashEmbedder(256), library }),
    ).rejects.toThrow(/no extractable text/);
    expect(library.listSources()).toEqual([]); // nothing persisted → listSources stays empty → seed fallback intact
  });

  it("returns an existing source as a duplicate when importing the same PDF bytes twice", async () => {
    const bytes = await makePdf(["The same source text should only be imported once."]);
    library = openLibrary(join(makeTempDir(), "library.db"));
    const embedder = new CountingEmbedder();

    const first = await importPdf(bytes.slice(), {
      id: "original-pdf",
      parser: new UnpdfParser(),
      embedder,
      library,
    });
    const second = await importPdf(bytes.slice(), {
      id: "duplicate-pdf",
      parser: new UnpdfParser(),
      embedder,
      library,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.source.id).toBe("original-pdf");
    expect(embedder.calls).toBe(1);
    expect(library.listSources()).toHaveLength(1);
  });

  it("sets DOI metadata from the first parsed chunk when the source lacks one", async () => {
    library = openLibrary(join(makeTempDir(), "library.db"));

    const { source } = await importPdf(new Uint8Array([1]), {
      id: "doi-in-prefix",
      parser: parserWithFirstChunk("Front matter DOI: 10.9999/paper.001 with abstract text."),
      embedder: new HashEmbedder(256),
      library,
    });

    expect(source.citation_metadata.doi).toBe("10.9999/paper.001");
    expect(library.loadAll().sources[0]!.citation_metadata.doi).toBe("10.9999/paper.001");
  });

  it("does not set DOI metadata from text after the first 2000 characters", async () => {
    library = openLibrary(join(makeTempDir(), "library.db"));
    const lateDoiText = `${"a".repeat(2001)} 10.9999/paper.001`;

    const { source } = await importPdf(new Uint8Array([1]), {
      id: "late-doi",
      parser: parserWithFirstChunk(lateDoiText),
      embedder: new HashEmbedder(256),
      library,
    });

    expect(source.citation_metadata.doi).toBeUndefined();
    expect(library.loadAll().sources[0]!.citation_metadata.doi).toBeUndefined();
  });
});
