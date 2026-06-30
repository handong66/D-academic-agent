import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createWorkerRuntime } from "../src/app/worker-runtime.js";
import type { AppConfig } from "../src/providers/config.js";

const corpusDir = "fixtures/corpus";

function parseLine(line: string): any {
  return JSON.parse(line);
}

function libraryPath(): string {
  const dir = join(tmpdir(), `d-academic-agent-runtime-library-${randomUUID()}`);
  mkdirSync(dir);
  return join(dir, "library.db");
}

function validConfig(library: string): AppConfig {
  return {
    embedder: { provider: "hash", dim: 256 },
    judge: { provider: "mock" },
    pdf: { provider: "unpdf" },
    corpus: corpusDir,
    library,
    externalResearch: { mcpProviders: [], httpProviders: [] },
  };
}

async function makePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([520, 520]);
  page.drawText(text, { x: 30, y: 470, size: 12, font });
  return doc.save();
}

describe("WorkerRuntime persistent library", () => {
  it("falls back to the seed corpus while the library is empty", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryPath() });

    const audit = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "seed-audit",
          type: "audit",
          draftText: "Linked to depression (Twenge, 2018).",
        }),
      ),
    );

    expect(audit.id).toBe("seed-audit");
    expect(audit.type).toBe("audit_result");
    expect(audit.result.sentences).toHaveLength(1);
    expect(audit.result.sentences[0]!.mentions[0]).toEqual(expect.objectContaining({ status: "resolved" }));
  });

  it("preserves the optional library path in runtime config", async () => {
    const path = libraryPath();
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: path });

    const applied = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "cfg-library",
          type: "set_config",
          config: validConfig(path),
          secrets: {},
        }),
      ),
    );
    const config = parseLine(await rt.handleLine(JSON.stringify({ id: "cfg-after-library", type: "get_config" })));

    expect(applied).toEqual({ id: "cfg-library", type: "config_applied" });
    expect(config.config.library).toBe(path);
  });

  it("imports a PDF, lists it, and audits a draft citation against the rebuilt library context", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryPath() });
    const bytes = await makePdf("Persistent library retrieval supports draft audits with imported PDF evidence.");
    const bytesBase64 = Buffer.from(bytes).toString("base64");

    const importedLine = await rt.handleLine(
      JSON.stringify({
        id: "runtime2026",
        type: "import_pdf",
        bytesBase64,
      }),
    );
    const imported = parseLine(importedLine);
    const listed = parseLine(await rt.handleLine(JSON.stringify({ id: "library-list", type: "list_library" })));
    const audit = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "library-audit",
          type: "audit",
          draftText: "Persistent library retrieval supports draft audits \\cite{runtime2026}.",
        }),
      ),
    );

    expect(importedLine).not.toContain(bytesBase64);
    expect(imported).toEqual({
      id: "runtime2026",
      type: "imported",
      source: { id: "runtime2026", title: "runtime2026", year: "", type: "pdf" },
      duplicate: false,
    });
    expect(listed).toEqual({
      id: "library-list",
      type: "library",
      sources: [{ id: "runtime2026", title: "runtime2026", year: "", type: "pdf" }],
    });
    expect(audit.id).toBe("library-audit");
    expect(audit.type).toBe("audit_result");
    expect(audit.result.sentences[0]!.mentions[0]).toEqual(
      expect.objectContaining({
        status: "resolved",
        source_id: "runtime2026",
        support: expect.objectContaining({ verdict: "supports" }),
      }),
    );
  });

  it("removes a library source and omits it from later library listings", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryPath() });
    const bytesBase64 = Buffer.from(await makePdf("A removable source for runtime library testing.")).toString("base64");
    await rt.handleLine(JSON.stringify({ id: "remove-me", type: "import_pdf", bytesBase64 }));

    const removed = parseLine(await rt.handleLine(JSON.stringify({ id: "remove-req", type: "remove_source", sourceId: "remove-me" })));
    const listed = parseLine(await rt.handleLine(JSON.stringify({ id: "library-after-remove", type: "list_library" })));

    expect(removed).toEqual({ id: "remove-req", type: "removed", sourceId: "remove-me" });
    expect(listed.sources).not.toContainEqual(expect.objectContaining({ id: "remove-me" }));
  });

  it("does not echo import_pdf bytes in parser errors", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryPath() });
    const bytesBase64 = Buffer.from("not a pdf secret payload").toString("base64");

    const line = await rt.handleLine(JSON.stringify({ id: "bad-import", type: "import_pdf", bytesBase64 }));
    const res = parseLine(line);

    expect(res.id).toBe("bad-import");
    expect(res.type).toBe("error");
    expect(line).not.toContain(bytesBase64);
  });
});
