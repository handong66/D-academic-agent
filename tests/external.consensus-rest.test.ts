import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ConsensusQuickSearchResponseSchema,
  createConsensusRest,
  mapConsensusResultToEvidenceCard,
  mapConsensusResultToExternalPaper,
} from "../src/external/providers/consensus-rest.js";
import type { ConsensusQuickSearchOptions } from "../src/external/providers/consensus-rest.js";

function fixture(): unknown {
  return JSON.parse(readFileSync("fixtures/external/consensus/quick_search.sample.json", "utf8"));
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("consensus REST adapter", () => {
  it("quick_search sends x-api-key, repeats study_types params, validates the fixture, and maps the first result", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return jsonResponse(fixture());
    };
    const rest = createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: "key-123" }, { fetch });

    const response = await rest.quickSearch(" sleep academic performance ", {
      year_min: 2020,
      year_max: 2025,
      study_types: ["rct", "meta-analysis"],
      human: true,
      sample_size_min: 50,
      sjr_max: 2,
      duration_min: 7,
      duration_max: 365,
      exclude_preprints: true,
      medical_mode: false,
    });
    const first = response.results[0]!;

    expect(calls[0]!.url).toBe(
      "https://api.consensus.app/v1/quick_search?query=sleep+academic+performance&year_min=2020&year_max=2025&study_types=rct&study_types=meta-analysis&human=true&sample_size_min=50&sjr_max=2&duration_min=7&duration_max=365&exclude_preprints=true&medical_mode=false",
    );
    expect(calls[0]!.init?.headers).toMatchObject({ "x-api-key": "key-123" });
    expect(ConsensusQuickSearchResponseSchema.parse(response).results).toHaveLength(3);
    expect(mapConsensusResultToExternalPaper(first)).toEqual({
      provider: "consensus",
      doi: "10.0000/consensus.sleep.001",
      title: "Sleep duration and academic performance in university students",
      authors: ["Avery Chen", "Morgan Patel"],
      year: 2024,
      journal: "Journal of Synthetic Education Research",
      abstract: "A synthetic cohort study fixture describing the association between sleep duration and academic performance in university students.",
      url: "https://consensus.app/papers/sleep-duration-academic-performance-chen-patel/000000000001",
      citationCount: 42,
      qualitySignals: { study_type: "non-rct observational study" },
    });
    expect(mapConsensusResultToEvidenceCard(first)).toMatchObject({
      provider: "consensus",
      quote: "Students reporting longer consistent sleep had modestly higher course grades after adjustment for baseline workload.",
      relation: "mentions",
      sourceDoi: "10.0000/consensus.sleep.001",
      paper: { provider: "consensus", title: "Sleep duration and academic performance in university students" },
    });
  });

  it("returns undefined evidence when a result has no takeaway", () => {
    const response = ConsensusQuickSearchResponseSchema.parse(fixture());

    expect(mapConsensusResultToEvidenceCard(response.results[2]!)).toBeUndefined();
  });

  it("rejects malformed response bodies with a clean validation error", async () => {
    const fetch = async (): Promise<Response> => jsonResponse({ results: [{ title: "missing required fields" }] });
    const rest = createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: "key-123" }, { fetch });

    await expect(rest.quickSearch("sleep")).rejects.toThrow(/Invalid consensus quick_search response: results\.0\.abstract/);
  });

  it("validates quick_search input with zod before fetch", async () => {
    let fetchCalled = false;
    const fetch = async (): Promise<Response> => {
      fetchCalled = true;
      return jsonResponse(fixture());
    };
    const rest = createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: "key-123" }, { fetch });

    await expect(rest.quickSearch("   ")).rejects.toThrow(
      /Invalid consensus quick_search input: query String must contain at least 1 character/,
    );
    await expect(rest.quickSearch("sleep", { year_min: -1 })).rejects.toThrow(
      /Invalid consensus quick_search input: year_min Number must be greater than or equal to 0/,
    );
    await expect(
      rest.quickSearch("sleep", { unexpected: true } as unknown as ConsensusQuickSearchOptions),
    ).rejects.toThrow(/Invalid consensus quick_search input: Unrecognized key\(s\) in object: 'unexpected'/);
    expect(fetchCalled).toBe(false);
  });

  it("honors a bounded 429 retry path", async () => {
    let attempts = 0;
    const fetch = async (): Promise<Response> => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ error: "rate limited" }, 429, { "retry-after": "0" });
      }
      return jsonResponse(fixture());
    };
    const rest = createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: "key-123" }, { fetch });

    await expect(rest.quickSearch("sleep academic performance")).resolves.toMatchObject({
      results: expect.arrayContaining([expect.objectContaining({ doi: "10.0000/consensus.sleep.001" })]),
    });
    expect(attempts).toBe(2);
  });

  it("throws before fetch when apiKey is blank", () => {
    const fetch = async (): Promise<Response> => {
      throw new Error("fetch should not be called");
    };

    expect(() => createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: "   " }, { fetch })).toThrow(
      /Consensus apiKey must not be blank/,
    );
  });

  it("does not leak the api key or response body through non-OK errors", async () => {
    const key = "secret-key-123";
    const fetch = async (): Promise<Response> => jsonResponse({ error: key, body: "do not leak" }, 500);
    const rest = createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: key }, { fetch });

    await expect(rest.quickSearch("sleep")).rejects.toThrow(/^Consensus quick_search request failed with HTTP 500$/);
    await expect(rest.quickSearch("sleep")).rejects.not.toThrow(key);
  });

  it("does not leak the api key or response body through output zod errors", async () => {
    const key = "KEY-SENTINEL-zz";
    const secret = "SECRET-SENTINEL-zz";
    const fetch = async (): Promise<Response> =>
      jsonResponse({
        results: [
          {
            abstract: "synthetic abstract",
            authors: ["Avery Chen"],
            doi: "10.0000/consensus.leak-test",
            journal_name: "Synthetic Journal",
            pages: "1-2",
            publish_year: 2024,
            title: 123,
            url: "https://consensus.app/papers/leak-test",
            volume: "1",
            citation_count: 0,
            leak: secret,
          },
        ],
      });
    const rest = createConsensusRest({ baseURL: "https://api.consensus.app", apiKey: key }, { fetch });

    let thrown: unknown;
    try {
      await rest.quickSearch("sleep");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/^Invalid consensus quick_search response: results\.0\.title /);
    expect(message).not.toContain(key);
    expect(message).not.toContain("SECRET-SENTINEL");
  });
});
