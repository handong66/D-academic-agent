import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/retrieve/db.js";
import { openLibrary } from "../src/library/library.js";
import type { Chunk } from "../src/retrieve/types.js";
import type { Source } from "../src/types.js";

const hash = "a".repeat(64);

function dbFile(): string {
  return join(mkdtempSync(join(tmpdir(), "lib-")), "library.db");
}

function source(id: string): Source {
  return {
    id,
    title: id,
    authors: ["A"],
    year: "2020",
    type: "pdf",
    path_or_url: "",
    source_hash: hash,
    citation_metadata: { bibtex_key: id },
    fulltext_status: "indexed",
  };
}

function chunk(id: string, sourceId: string): Chunk {
  return {
    id,
    source_id: sourceId,
    source_hash: hash,
    ordinal: 0,
    section: "body",
    char_start: 0,
    char_end: 5,
    text: "hello",
    chunker_version: "1.0",
    embedding_model: "hash-256",
    embedding_dim: 4,
  };
}

describe("Library", () => {
  it("persists sources, chunks, and vectors across reopen", () => {
    const file = dbFile();
    const lib = openLibrary(file);
    lib.addSource(source("s1"), [{ chunk: chunk("s1#0", "s1"), vector: [1, 0, 0, 0] }]);

    expect(lib.listSources()).toEqual([{ id: "s1", title: "s1", year: "2020", type: "pdf" }]);
    lib.close();

    const re = openLibrary(file);
    const loaded = re.loadAll();
    expect(loaded.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(loaded.sources[0]!.authors).toEqual(["A"]);
    expect(loaded.sources[0]!.citation_metadata).toEqual({ bibtex_key: "s1" });
    expect(loaded.chunks).toHaveLength(1);
    expect(loaded.vectors.get("s1#0")).toEqual([1, 0, 0, 0]);

    re.removeSource("s1");
    expect(re.listSources()).toEqual([]);
    expect(re.loadAll().chunks).toEqual([]);
    re.close();
  });

  it("reports stale when the active embedder model or dimension differs from stored chunks", () => {
    const lib = openLibrary(dbFile());
    lib.addSource(source("s1"), [{ chunk: chunk("s1#0", "s1"), vector: [1, 0, 0, 0] }]);

    expect(lib.staleFor("hash-256", 4)).toBe(false);
    expect(lib.staleFor("hash-256", 384)).toBe(true);
    expect(lib.staleFor("Xenova/all-MiniLM-L6-v2", 4)).toBe(true);
    lib.close();
  });

  it("throws when a stored vector is not numeric or does not match embedding_dim", () => {
    const file = dbFile();
    const lib = openLibrary(file);
    lib.addSource(source("s1"), [{ chunk: chunk("s1#0", "s1"), vector: [1, 0, 0, 0] }]);
    lib.close();

    const db = openDb(file);
    db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?").run(JSON.stringify(["bad", 0, 0, 0]), "s1#0");
    db.close();

    const corrupted = openLibrary(file);
    expect(() => corrupted.loadAll()).toThrow(/embedding vector/i);
    corrupted.close();
  });
});
