import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assembleWithPdfs } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { checkClaim } from "../src/check/check.js";

const dir = "fixtures/pdf_corpus";

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([420, 520]);
    page.drawText(text, { x: 30, y: 470, size: 12, font });
  }
  return doc.save();
}

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "refs.bib"),
    `@article{pdfstudy2026, author={Pdf, Pat}, year={2026}, title={PDF Study}}`,
  );
  writeFileSync(
    join(dir, "pdfstudy2026.pdf"),
    await makePdf([
      "Adolescent social media use is associated with depression symptoms.",
      "Methods describe sampling limitations.",
    ]),
  );
});

describe("assembleWithPdfs", () => {
  it("preserves PDF page locators through assemble, index, retrieve, and checkClaim", async () => {
    const { sources, texts, chunksBySource } = await assembleWithPdfs(dir);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe("pdf");

    const retriever = await buildIndex(sources, texts, new HashEmbedder(256), chunksBySource);
    const checked = await checkClaim(
      { claim: "Social media use is associated with depression symptoms", cited_source: "pdfstudy2026" },
      retriever,
      new MockJudge(),
    );

    expect(checked.cited_source_support.locator.source_id).toBe("pdfstudy2026");
    expect(typeof checked.cited_source_support.locator.page).toBe("number");
  });
});
