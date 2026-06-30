import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerRuntime } from "../src/app/worker-runtime.js";
import { openLibrary } from "../src/library/library.js";
import type { Chunk } from "../src/retrieve/types.js";
import type { Source } from "../src/types.js";

const corpusDir = "fixtures/corpus";
const sourceId = "stored-reference-source";
const sourceHash = "stored-reference-source-hash";
const references = [
  { title: "Reference with DOI", author: "Alpha", year: "2021", doi: "10.4321/ref.with.doi" },
  { title: "Reference without DOI", author: "Beta", year: "2022" },
];

interface SourceReferencesResponse {
  id: string;
  type: "source_references";
  sourceId: string;
  references: typeof references;
}

function parseLine<T>(line: string): T {
  return JSON.parse(line) as T;
}

function libraryPath(): string {
  const dir = join(tmpdir(), `d-academic-agent-source-references-${randomUUID()}`);
  mkdirSync(dir);
  return join(dir, "library.db");
}

function storedSource(): Source {
  return {
    id: sourceId,
    title: "Stored Reference Source",
    authors: ["Franklin"],
    year: "2024",
    type: "pdf",
    path_or_url: "",
    source_hash: sourceHash,
    citation_metadata: { bibtex_key: sourceId, raw: { references } },
    fulltext_status: "indexed",
  };
}

function storedChunk(): Chunk {
  return {
    id: `${sourceId}#0`,
    source_id: sourceId,
    source_hash: sourceHash,
    ordinal: 0,
    section: "body",
    char_start: 0,
    char_end: 48,
    text: "Stored source text for reference lookup testing.",
    embedding_model: "hash-256",
    embedding_dim: 256,
    chunker_version: "1.0",
  };
}

function storedVector(): number[] {
  const vector = new Array<number>(256).fill(0);
  vector[0] = 1;
  return vector;
}

function libraryWithStoredReferences(): string {
  const path = libraryPath();
  const library = openLibrary(path);
  library.addSource(storedSource(), [{ chunk: storedChunk(), vector: storedVector() }]);
  library.close();
  return path;
}

describe("get_source_references", () => {
  it("returns stored references including DOI metadata for a source", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryWithStoredReferences() });

    const res = parseLine<SourceReferencesResponse>(
      await rt.handleLine(JSON.stringify({ id: "source-refs", type: "get_source_references", sourceId })),
    );

    expect(res).toEqual({
      id: "source-refs",
      type: "source_references",
      sourceId,
      references,
    });
  });

  it("returns an empty reference list for an unknown source", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryWithStoredReferences() });

    const res = parseLine<SourceReferencesResponse>(
      await rt.handleLine(JSON.stringify({ id: "missing-refs", type: "get_source_references", sourceId: "missing-source" })),
    );

    expect(res).toEqual({
      id: "missing-refs",
      type: "source_references",
      sourceId: "missing-source",
      references: [],
    });
  });
});
