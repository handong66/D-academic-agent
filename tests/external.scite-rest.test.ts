import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SciteTally } from "../src/external/types.js";
import {
  classifyReferenceRisk,
  createSciteRest,
  mapPaperToExternalPaper,
  mapSciteTallyToReferenceSignal,
  mapSearchHitToEvidenceCards,
  mapSearchHitToExternalPaper,
  SciteSearchResultsResponseSchema,
} from "../src/external/providers/scite-rest.js";

function fixture(name: "paper" | "search" | "tally"): unknown {
  return JSON.parse(readFileSync(`fixtures/external/scite/${name}.fixture.json`, "utf8"));
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("scite REST adapter", () => {
  it("gets a DOI-encoded tally, validates it, and maps the ok reference signal", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return jsonResponse(fixture("tally"));
    };
    const rest = createSciteRest({ baseURL: "https://api.scite.ai", token: "token-123" }, { fetch });

    const tally = await rest.getTally("10.1016/j.biopsych.2005.08.012");
    const signal = mapSciteTallyToReferenceSignal(tally);

    expect(calls[0]!.url).toBe("https://api.scite.ai/tallies/10.1016%2Fj.biopsych.2005.08.012");
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: "Bearer token-123" });
    expect(signal).toEqual({
      provider: "scite",
      doi: "10.1016/j.biopsych.2005.08.012",
      supportCount: 27,
      pushbackCount: 6,
      mentionCount: 308,
      unclassifiedCount: 6,
      citingPublicationCount: 436,
      risk: "ok",
    });
  });

  it("maps contradicting-heavy tallies to needs_care", () => {
    const tally: SciteTally = {
      total: 4,
      supporting: 1,
      contradicting: 1,
      mentioning: 2,
      unclassified: 0,
      doi: "10.0000/risky",
    };

    expect(mapSciteTallyToReferenceSignal(tally).risk).toBe("needs_care");
  });

  // The risky/blocked and notice-driven tiers extend §7.3; §7.3 only defines the needs_care pushback tier.
  it("classifies reference risk from the most severe tally and editorial-notice signal", () => {
    const tally = (contradicting: number, supporting = 0, mentioning = 10): SciteTally => ({
      total: supporting + contradicting + mentioning,
      supporting,
      contradicting,
      mentioning,
      unclassified: 0,
      doi: undefined,
      citingPublications: undefined,
    });

    expect(classifyReferenceRisk({ retracted: true })).toBe("blocked");
    expect(classifyReferenceRisk({ editorialNotices: [{ status: "retraction_notice" }] })).toBe("blocked");
    expect(classifyReferenceRisk({ editorialNotices: [{ status: "expression_of_concern" }] })).toBe("risky");
    expect(classifyReferenceRisk({ tally: tally(4, 0, 6) })).toBe("risky");
    expect(classifyReferenceRisk({ tally: tally(2, 0, 8) })).toBe("needs_care");
    expect(classifyReferenceRisk({ editorialNotices: [{ status: "correction" }] })).toBe("needs_care");
    expect(classifyReferenceRisk({ editorialNotices: [{ status: "erratum" }] })).toBe("needs_care");
    expect(classifyReferenceRisk({ tally: tally(1, 1, 8) })).toBe("ok");
    expect(classifyReferenceRisk({})).toBe("unknown");
    expect(classifyReferenceRisk({ tally: tally(45, 0, 55), editorialNotices: [{ status: "correction" }] })).toBe("risky");
  });

  it("keeps the tally-only mapper on its legacy ok/needs_care risk scale", () => {
    const tally: SciteTally = {
      total: 10,
      supporting: 0,
      contradicting: 4,
      mentioning: 6,
      unclassified: 0,
      doi: "10.0000/legacy-tally-risk",
    };

    expect(classifyReferenceRisk({ tally })).toBe("risky");
    expect(mapSciteTallyToReferenceSignal(tally).risk).toBe("needs_care");
  });

  it("gets paper metadata and maps C0-observed PaperResponse fields to ExternalPaper", async () => {
    const fetch = async (): Promise<Response> => jsonResponse(fixture("paper"));
    const rest = createSciteRest({ baseURL: "https://api.scite.ai" }, { fetch });

    const paper = await rest.getPaper("10.1016/j.biopsych.2005.08.012");
    expect(mapPaperToExternalPaper(paper)).toMatchObject({
      provider: "scite",
      providerPaperId: "paper-123",
      doi: "10.1016/j.biopsych.2005.08.012",
      title: "Sleep and academic performance in adolescents",
      authors: ["Jane Doe", "John Smith"],
      year: 2006,
      journal: "Biological Psychiatry",
      abstract: "A fixture paper response using observed C0 PaperResponse fields.",
      url: "https://doi.org/10.1016%2Fj.biopsych.2005.08.012",
    });
  });

  it("searches through the rich REST path without Authorization when token is absent and maps evidence cards", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return jsonResponse(fixture("search"));
    };
    const rest = createSciteRest({ baseURL: "https://api.scite.ai" }, { fetch });

    const results = await rest.search("sleep academic performance", { limit: 5 });
    const hit = results.hits[0]!;
    const paper = mapSearchHitToExternalPaper(hit);
    const evidence = mapSearchHitToEvidenceCards(hit);

    expect(calls[0]!.url).toBe("https://api.scite.ai/api_partner/search?query=sleep+academic+performance&limit=5");
    expect(calls[0]!.init?.headers).not.toHaveProperty("Authorization");
    expect(SciteSearchResultsResponseSchema.parse(results).count).toBe(1);
    expect(paper).toMatchObject({
      provider: "scite",
      providerPaperId: "paper-123",
      doi: "10.1016/j.biopsych.2005.08.012",
      title: "Sleep and academic performance in adolescents",
      authors: ["Jane Doe", "John Smith"],
      citationCount: 2,
    });
    expect(evidence).toHaveLength(3);
    expect(evidence[0]).toMatchObject({
      provider: "scite",
      quote: "Students with longer sleep duration had higher grade point averages.",
      relation: "mentions",
      sourceDoi: "10.1016/j.biopsych.2005.08.012",
    });
    expect(evidence[2]!.editorialNotices).toEqual([
      {
        status: "retraction_notice",
        date: "2020-01-02",
        noticeDoi: "10.0000/notice",
        urls: ["https://example.test/notice"],
      },
    ]);
  });

  it("maps scite search-hit tally and notices to a typed blocked reference signal", () => {
    const results = SciteSearchResultsResponseSchema.parse(fixture("search"));
    const paper = mapSearchHitToExternalPaper(results.hits[0]!);

    expect(paper.referenceSignal).toEqual({
      provider: "scite",
      doi: "10.1016/j.biopsych.2005.08.012",
      supportCount: 27,
      pushbackCount: 6,
      mentionCount: 308,
      unclassifiedCount: 6,
      citingPublicationCount: 436,
      risk: "blocked",
      retracted: true,
      editorialNotices: [
        {
          status: "retraction_notice",
          date: "2020-01-02",
          noticeDoi: "10.0000/notice",
          urls: ["https://example.test/notice"],
        },
      ],
    });
    expect(paper.qualitySignals).not.toHaveProperty("tally");
    expect(paper.qualitySignals).not.toHaveProperty("editorialNotices");
  });

  it("rejects unknown search options so nothing extra can leave on the outbound URL", async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error("fetch should not be called when options are rejected");
    };
    const rest = createSciteRest({ baseURL: "https://api.scite.ai" }, { fetch });

    await expect(rest.search("sleep academic performance", { topic: "smuggled" } as never)).rejects.toThrow(
      /Invalid scite search options/,
    );
  });

  it("rejects malformed response bodies with a clean validation error", async () => {
    const fetch = async (): Promise<Response> => jsonResponse({ total: 1, supporting: 1, mentioning: 0, unclassified: 0 });
    const rest = createSciteRest({ baseURL: "https://api.scite.ai" }, { fetch });

    await expect(rest.getTally("10.0000/malformed")).rejects.toThrow(/Invalid scite tally response/);
  });

  it("honors a bounded 429 retry path", async () => {
    let attempts = 0;
    const fetch = async (): Promise<Response> => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ error: "rate limited" }, 429, { "retry-after": "0" });
      }
      return jsonResponse(fixture("tally"));
    };
    const rest = createSciteRest({ baseURL: "https://api.scite.ai" }, { fetch });

    await expect(rest.getTally("10.1016/j.biopsych.2005.08.012")).resolves.toMatchObject({ contradicting: 6 });
    expect(attempts).toBe(2);
  });

  it("enforces the aggregate tally batch cap before issuing a request", async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error("fetch should not be called");
    };
    const rest = createSciteRest({ baseURL: "https://api.scite.ai" }, { fetch });

    await expect(rest.aggregateTallies(Array.from({ length: 101 }, (_, index) => `10.0000/${index}`))).rejects.toThrow(/100/);
  });
});
