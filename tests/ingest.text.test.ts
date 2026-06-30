import { describe, it, expect } from "vitest";
import { ingestTextSource } from "../src/ingest/text.js";

describe("ingestTextSource", () => {
  it("builds a Source with citation_metadata + offset-stable hash", () => {
    const s = ingestTextSource({
      id: "smith2021",
      bibtex_key: "smith2021",
      title: "Access",
      authors: ["Smith"],
      year: "2021",
      path_or_url: "fixtures/corpus/smith2021.txt",
      content: "Urban access improved.",
    });
    expect(s.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.citation_metadata.bibtex_key).toBe("smith2021");
    expect(s.fulltext_status).toBe("extracted");
  });
});
