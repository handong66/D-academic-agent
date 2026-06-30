import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseBibtex } from "../ingest/bibtex.js";
import { ingestPdf } from "../ingest/pdf.js";
import { ingestTextSource } from "../ingest/text.js";
import type { Source } from "../types.js";
import type { Chunk } from "../retrieve/types.js";

export function assembleSources(dir: string): { sources: Source[]; bibKeyToSourceId: Record<string, string> } {
  const entries = parseBibtex(readFileSync(join(dir, "refs.bib"), "utf8"));
  const sources: Source[] = [];
  const bibKeyToSourceId: Record<string, string> = {};
  for (const e of entries) {
    const txt = join(dir, `${e.key}.txt`);
    if (!existsSync(txt)) throw new Error(`assembleSources: bib entry "${e.key}" has no matching ${e.key}.txt`);
    const s = ingestTextSource({
      id: e.key,
      bibtex_key: e.key,
      title: e.title,
      authors: e.authors,
      year: e.year,
      path_or_url: txt,
      content: readFileSync(txt, "utf8"),
    });
    sources.push(s);
    bibKeyToSourceId[e.key] = s.id;
  }
  // bidirectional completeness: every .txt on disk must be registered in refs.bib (no stray sources) (Codex review)
  const registered = new Set(entries.map((e) => `${e.key}.txt`));
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".txt") && !registered.has(f)) {
      throw new Error(`assembleSources: stray ${f} has no BibTeX entry in refs.bib`);
    }
  }
  sources.sort((a, b) => a.id.localeCompare(b.id)); // deterministic
  return { sources, bibKeyToSourceId };
}

export function writeSourcesLock(dir: string, out: string): void {
  const { sources } = assembleSources(dir);
  writeFileSync(out, JSON.stringify(sources, null, 2) + "\n");
}

export async function assembleWithPdfs(dir: string): Promise<{
  sources: Source[];
  texts: Map<string, string>;
  chunksBySource: Map<string, Chunk[]>;
  bibKeyToSourceId: Record<string, string>;
}> {
  const entries = parseBibtex(readFileSync(join(dir, "refs.bib"), "utf8"));
  const sources: Source[] = [];
  const texts = new Map<string, string>();
  const chunksBySource = new Map<string, Chunk[]>();
  const bibKeyToSourceId: Record<string, string> = {};

  for (const e of entries) {
    const txt = join(dir, `${e.key}.txt`);
    const pdf = join(dir, `${e.key}.pdf`);
    if (existsSync(txt)) {
      const content = readFileSync(txt, "utf8");
      const s = ingestTextSource({
        id: e.key,
        bibtex_key: e.key,
        title: e.title,
        authors: e.authors,
        year: e.year,
        path_or_url: txt,
        content,
      });
      sources.push(s);
      texts.set(s.id, content);
      bibKeyToSourceId[e.key] = s.id;
      continue;
    }
    if (existsSync(pdf)) {
      const file = readFileSync(pdf);
      const bytes = new Uint8Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
      const r = await ingestPdf(bytes, { id: e.key, embedding_model: "hash-256", embedding_dim: 256 });
      const source: Source = {
        ...r.source,
        title: e.title,
        authors: e.authors,
        year: e.year,
        path_or_url: pdf,
        citation_metadata: { bibtex_key: e.key },
      };
      sources.push(source);
      texts.set(source.id, r.chunks.map((c) => c.text).join("\n"));
      chunksBySource.set(source.id, r.chunks);
      bibKeyToSourceId[e.key] = source.id;
      continue;
    }
    throw new Error(`assembleWithPdfs: bib entry "${e.key}" has no matching ${e.key}.txt or ${e.key}.pdf`);
  }

  const registered = new Set(entries.flatMap((e) => [`${e.key}.txt`, `${e.key}.pdf`]));
  for (const f of readdirSync(dir)) {
    if ((f.endsWith(".txt") || f.endsWith(".pdf")) && !registered.has(f)) {
      throw new Error(`assembleWithPdfs: stray ${f} has no BibTeX entry in refs.bib`);
    }
  }
  sources.sort((a, b) => a.id.localeCompare(b.id));
  return { sources, texts, chunksBySource, bibKeyToSourceId };
}
