import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { GrobidParser, grobidAvailable, teiToSourceChunks } from "../src/library/grobid.js";

const tei = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title level="a" type="main">Social Media Use and Adolescent Depression</title></titleStmt><sourceDesc><biblStruct><analytic><author><persName><forename type="first">Jean</forename><surname>Twenge</surname></persName></author></analytic><monogr><imprint><date type="published" when="2018">2018</date></imprint></monogr></biblStruct></sourceDesc></fileDesc></teiHeader><text><body><div><head>Methods</head><p>We sampled 7000 adolescents across the country.</p></div><div><head>Results</head><p>Social media use was associated with depressive symptoms.</p></div></body><back><div type="references"><listBibl><biblStruct><analytic><title level="a">Screens and well-being</title><author><persName><surname>Orben</surname></persName></author></analytic><monogr><imprint><date when="2019"/></imprint></monogr></biblStruct></listBibl></div></back></text></TEI>`;
const teiWithDoi = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title level="a" type="main">DOI Source</title></titleStmt><sourceDesc><biblStruct><analytic><author><persName><surname>Curie</surname></persName></author><idno type="DOI">10.1234/test.doi</idno></analytic><monogr><imprint><date type="published" when="2020">2020</date></imprint></monogr></biblStruct></sourceDesc></fileDesc></teiHeader><text><body><div><head>Abstract</head><p>This source carries a DOI in the TEI header.</p></div></body></text></TEI>`;
const teiWithReferenceDoi = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title level="a" type="main">Reference DOI Source</title></titleStmt><sourceDesc><biblStruct><analytic><author><persName><surname>Franklin</surname></persName></author></analytic><monogr><imprint><date type="published" when="2024">2024</date></imprint></monogr></biblStruct></sourceDesc></fileDesc></teiHeader><text><body><div><head>Abstract</head><p>This source has reference-level DOI metadata.</p></div></body><back><div type="references"><listBibl><biblStruct><analytic><title level="a">Reference with DOI</title><author><persName><surname>Alpha</surname></persName></author><idno type="DOI">10.4321/ref.with.doi</idno></analytic><monogr><imprint><date when="2021"/></imprint></monogr></biblStruct><biblStruct><analytic><title level="a">Reference without DOI</title><author><persName><surname>Beta</surname></persName></author></analytic><monogr><imprint><date when="2022"/></imprint></monogr></biblStruct></listBibl></div></back></text></TEI>`;

describe("teiToSourceChunks", () => {
  it("maps GROBID TEI into a PDF source, section-aware chunks, and references", () => {
    const { source, chunks, references } = teiToSourceChunks(tei, {
      id: "twenge2018",
      embedding_model: "hash-256",
      embedding_dim: 256,
    });

    expect(source.title).toContain("Social Media");
    expect(source.authors).toContain("Twenge");
    expect(source.year).toBe("2018");
    expect(source.type).toBe("pdf");
    expect(source.citation_metadata.bibtex_key).toBe("twenge2018");
    expect(source.citation_metadata.raw?.references).toEqual(expect.arrayContaining([expect.objectContaining({ author: "Orben" })]));
    expect(chunks.map((chunk) => chunk.section)).toEqual(expect.arrayContaining(["Methods", "Results"]));
    expect(chunks.map((chunk) => chunk.section)).not.toContain("body");
    expect(references).toEqual(expect.arrayContaining([expect.objectContaining({ author: "Orben" })]));
  });

  it("extracts the paper DOI from the header biblStruct idno", () => {
    const { source } = teiToSourceChunks(teiWithDoi, {
      id: "curie2020",
      embedding_model: "hash-256",
      embedding_dim: 256,
    });

    expect(source.citation_metadata.doi).toBe("10.1234/test.doi");
  });

  it("extracts reference DOIs and stores the same references in raw citation metadata", () => {
    const { source, references } = teiToSourceChunks(teiWithReferenceDoi, {
      id: "franklin2024",
      embedding_model: "hash-256",
      embedding_dim: 256,
    });

    expect(references).toEqual([
      { title: "Reference with DOI", author: "Alpha", year: "2021", doi: "10.4321/ref.with.doi" },
      { title: "Reference without DOI", author: "Beta", year: "2022" },
    ]);
    expect(references[1]).not.toHaveProperty("doi");
    expect(source.citation_metadata.raw?.references).toEqual(references);
  });
});

const live = process.env.M5C_LIVE_GROBID ? describe : describe.skip;

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 520]);
  page.drawText("Social media use and adolescent depression.", { x: 30, y: 470, size: 12, font });
  return doc.save();
}

live("GROBID live integration", () => {
  it("detects a live GROBID service", async () => {
    await expect(grobidAvailable(process.env.M5C_LIVE_GROBID ?? "http://localhost:8070")).resolves.toBe(true);
  });

  it("parses a PDF through a live GROBID service", async () => {
    const parser = new GrobidParser({ baseURL: process.env.M5C_LIVE_GROBID ?? "http://localhost:8070" });
    const pdfBytes = await makePdf();

    await expect(
      parser.parse(pdfBytes, {
        id: "live",
        embedding_model: "hash-256",
        embedding_dim: 256,
      }),
    ).resolves.toHaveProperty("source.type", "pdf");
  });
});
