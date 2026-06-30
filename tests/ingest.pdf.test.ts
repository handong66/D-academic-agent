import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ingestPdf } from "../src/ingest/pdf.js";

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([300, 400]);
    page.drawText(text, { x: 20, y: 360, size: 12, font });
  }
  return doc.save();
}

describe("ingestPdf", () => {
  it("extracts text into a Source + page-tagged Chunks with stable hashing", async () => {
    const bytes = await makePdf(["Adolescent social media use and depression.", "Methods and sample limitations."]);
    const r = await ingestPdf(bytes, { id: "toy_pdf", embedding_model: "hash-256", embedding_dim: 256 });
    expect(r.source.id).toBe("toy_pdf");
    expect(r.source.type).toBe("pdf");
    expect(r.source.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks.some((c) => /depression/i.test(c.text))).toBe(true);
    expect(r.chunks.every((c) => typeof c.page_start === "number")).toBe(true);
    expect(r.chunks.every((c) => typeof c.page_end === "number")).toBe(true);
  });
});
