import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildExternalProvider } from "../src/external/provider-factory.js";
import type { SciteTally } from "../src/external/types.js";
import type { ExternalHttpProviderConfig, ExternalMcpProviderConfig } from "../src/providers/config.js";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function sciteConfig(): ExternalMcpProviderConfig {
  return {
    id: "scite",
    label: "scite",
    enabled: true,
    allowedTools: ["search"],
    capabilities: ["paper_search", "citation_contexts", "not_a_real_capability"],
    transport: {
      kind: "streamable-http",
      url: "https://api.scite.ai/mcp",
      auth: {
        type: "scite-client-credentials",
        clientIdKeyRef: "SCITE_CLIENT_ID",
        clientSecretKeyRef: "SCITE_CLIENT_SECRET",
      },
    },
  };
}

function consensusConfig(): ExternalHttpProviderConfig {
  return {
    id: "consensus",
    label: "Consensus",
    enabled: true,
    baseURL: "https://api.consensus.app",
    capabilities: ["paper_search", "study_snapshot", "not_a_real_capability"],
    auth: {
      type: "api-key-header",
      header: "x-api-key",
      keyRef: "CONSENSUS_API_KEY",
    },
  };
}

function fixture(provider: "scite" | "consensus"): unknown {
  const path =
    provider === "scite" ? "fixtures/external/scite/search.fixture.json" : "fixtures/external/consensus/quick_search.sample.json";
  return JSON.parse(readFileSync(path, "utf8"));
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function tally(doi: string, overrides: Partial<SciteTally> = {}): SciteTally {
  return {
    doi,
    total: 10,
    supporting: 7,
    contradicting: 0,
    mentioning: 3,
    unclassified: 0,
    ...overrides,
  };
}

describe("external provider factory", () => {
  it("keeps scite disconnected and never fetches when either client credential is missing", () => {
    const credentialCases: Array<{ name: string; secrets: Record<string, string> }> = [
      { name: "no keys", secrets: {} },
      { name: "only client id", secrets: { SCITE_CLIENT_ID: "client-id" } },
      { name: "only client secret", secrets: { SCITE_CLIENT_SECRET: "client-secret" } },
    ];

    for (const { name, secrets } of credentialCases) {
      const calls: FetchCall[] = [];
      const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(input), init });
        throw new Error(`fetch should not be called for ${name}`);
      };

      const provider = buildExternalProvider(sciteConfig(), secrets, { fetch });

      expect(provider.status).toMatchObject({
        id: "scite",
        enabled: true,
        connected: false,
        capabilities: ["paper_search", "citation_contexts"],
      });
      expect(provider.search).toBeUndefined();
      expect(provider.referenceHealth).toBeUndefined();
      expect(calls).toEqual([]);
    }
  });

  it("builds a scite search provider from both client credentials and maps REST hits", async () => {
    const calls: FetchCall[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url === "https://api.scite.ai/auth_token_users/token") {
        return jsonResponse({ access_token: "scite-bearer-token", expires_in: 3600 });
      }
      if (url.startsWith("https://api.scite.ai/api_partner/search")) {
        return jsonResponse(fixture("scite"));
      }
      return jsonResponse({ error: "unexpected URL" }, 404);
    };

    const provider = buildExternalProvider(
      sciteConfig(),
      { SCITE_CLIENT_ID: "client-id", SCITE_CLIENT_SECRET: "client-secret" },
      { fetch },
    );

    expect(provider.status).toEqual({
      id: "scite",
      enabled: true,
      connected: true,
      capabilities: ["paper_search", "citation_contexts"],
    });
    expect(calls).toEqual([]);
    if (provider.search === undefined) throw new Error("expected scite search");

    const result = await provider.search("sleep academic performance", { limit: 5 });

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.scite.ai/auth_token_users/token",
      "https://api.scite.ai/api_partner/search?query=sleep+academic+performance&limit=5",
    ]);
    expect(calls[1]!.init?.headers).toMatchObject({ Authorization: "Bearer scite-bearer-token" });
    expect(result.provider).toBe("scite");
    expect(result.papers[0]).toMatchObject({
      provider: "scite",
      providerPaperId: "paper-123",
      doi: "10.1016/j.biopsych.2005.08.012",
      title: "Sleep and academic performance in adolescents",
      citationCount: 2,
    });
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence[0]).toMatchObject({
      provider: "scite",
      quote: "Students with longer sleep duration had higher grade point averages.",
      relation: "mentions",
    });
  });

  it("builds scite reference health from aggregate tallies and resilient paper notices with bounded fan-out", async () => {
    const dois = [
      "10.1000/retracted",
      "10.1000/contradicted",
      "10.1000/clean",
      "10.1000/missing-paper",
      "10.1000/extra-a",
      "10.1000/extra-b",
      "10.1000/extra-c",
      "10.1000/extra-d",
    ];
    const tallies = new Map<string, SciteTally>([
      ["10.1000/retracted", tally("10.1000/retracted", { supporting: 2, contradicting: 0, mentioning: 1 })],
      ["10.1000/contradicted", tally("10.1000/contradicted", { supporting: 1, contradicting: 5, mentioning: 4 })],
      ["10.1000/clean", tally("10.1000/clean", { supporting: 9, contradicting: 0, mentioning: 1 })],
      ["10.1000/missing-paper", tally("10.1000/missing-paper", { supporting: 3, contradicting: 0, mentioning: 2 })],
    ]);
    const calls: FetchCall[] = [];
    const aggregateBatches: string[][] = [];
    let inFlightPapers = 0;
    let maxInFlightPapers = 0;

    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url === "https://api.scite.ai/auth_token_users/token") {
        return jsonResponse({ access_token: "scite-bearer-token", expires_in: 3600 });
      }
      if (url === "https://api.scite.ai/tallies/aggregate") {
        const body = JSON.parse(String(init?.body)) as { dois: string[] };
        aggregateBatches.push(body.dois);
        return jsonResponse(body.dois.map((doi) => tallies.get(doi)).filter((item): item is SciteTally => item !== undefined));
      }
      if (url.startsWith("https://api.scite.ai/papers/")) {
        const doi = decodeURIComponent(url.slice("https://api.scite.ai/papers/".length));
        inFlightPapers += 1;
        maxInFlightPapers = Math.max(maxInFlightPapers, inFlightPapers);
        await Promise.resolve();
        inFlightPapers -= 1;
        if (doi === "10.1000/missing-paper") {
          return jsonResponse({ error: "not found" }, 404);
        }
        if (doi === "10.1000/retracted") {
          return jsonResponse({
            doi,
            retracted: true,
            editorialNotices: [{ status: "retraction_notice", date: "2024-01-01", noticeDoi: "10.1000/notice" }],
          });
        }
        return jsonResponse({ doi, retracted: false, editorialNotices: [] });
      }
      return jsonResponse({ error: "unexpected URL" }, 404);
    };

    const provider = buildExternalProvider(
      sciteConfig(),
      { SCITE_CLIENT_ID: "client-id", SCITE_CLIENT_SECRET: "client-secret" },
      { fetch },
    );
    if (provider.referenceHealth === undefined) throw new Error("expected scite referenceHealth");

    const signals = await provider.referenceHealth(dois);

    expect(aggregateBatches).toEqual([dois]);
    expect(maxInFlightPapers).toBeLessThanOrEqual(5);
    expect(signals.map((signal) => signal.doi)).toEqual(dois);
    expect(signals).toHaveLength(dois.length);
    expect(signals[0]).toMatchObject({
      provider: "scite",
      doi: "10.1000/retracted",
      risk: "blocked",
      retracted: true,
      editorialNotices: [{ status: "retraction_notice" }],
    });
    expect(signals[1]).toMatchObject({
      doi: "10.1000/contradicted",
      risk: "risky",
      pushbackCount: 5,
    });
    expect(signals[2]).toMatchObject({
      doi: "10.1000/clean",
      risk: "ok",
      supportCount: 9,
    });
    expect(signals[3]).toMatchObject({
      doi: "10.1000/missing-paper",
      risk: "ok",
      supportCount: 3,
    });
    expect(signals.slice(4).map((signal) => signal.risk)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(calls.filter((call) => call.url.startsWith("https://api.scite.ai/papers/"))).toHaveLength(dois.length);
  });

  it("deduplicates and caps scite reference health DOI batches before fetching", async () => {
    const uniqueDois = Array.from({ length: 101 }, (_, index) => `10.2000/${index}`);
    const inputDois = [uniqueDois[0]!, ...uniqueDois];
    const aggregateBatches: string[][] = [];
    const paperDois: string[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "https://api.scite.ai/auth_token_users/token") {
        return jsonResponse({ access_token: "scite-bearer-token", expires_in: 3600 });
      }
      if (url === "https://api.scite.ai/tallies/aggregate") {
        const body = JSON.parse(String(init?.body)) as { dois: string[] };
        aggregateBatches.push(body.dois);
        return jsonResponse([]);
      }
      if (url.startsWith("https://api.scite.ai/papers/")) {
        const doi = decodeURIComponent(url.slice("https://api.scite.ai/papers/".length));
        paperDois.push(doi);
        return jsonResponse({ doi, editorialNotices: [] });
      }
      return jsonResponse({ error: "unexpected URL" }, 404);
    };
    const provider = buildExternalProvider(
      sciteConfig(),
      { SCITE_CLIENT_ID: "client-id", SCITE_CLIENT_SECRET: "client-secret" },
      { fetch },
    );
    if (provider.referenceHealth === undefined) throw new Error("expected scite referenceHealth");

    const signals = await provider.referenceHealth(inputDois);

    const expectedDois = uniqueDois.slice(0, 100);
    expect(aggregateBatches).toEqual([expectedDois]);
    expect(paperDois).toEqual(expectedDois);
    expect(signals.map((signal) => signal.doi)).toEqual(expectedDois);
  });

  it("keeps consensus disconnected and never fetches when the api key is missing", () => {
    const calls: FetchCall[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      throw new Error("fetch should not be called without a Consensus key");
    };

    const provider = buildExternalProvider(consensusConfig(), {}, { fetch });

    expect(provider.status).toMatchObject({
      id: "consensus",
      enabled: true,
      connected: false,
      capabilities: ["paper_search", "study_snapshot"],
    });
    expect(provider.search).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("builds a consensus search provider from an api key and maps quick_search results", async () => {
    const calls: FetchCall[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return jsonResponse(fixture("consensus"));
    };

    const provider = buildExternalProvider(consensusConfig(), { CONSENSUS_API_KEY: "consensus-key" }, { fetch });

    expect(provider.status).toEqual({
      id: "consensus",
      enabled: true,
      connected: true,
      capabilities: ["paper_search", "study_snapshot"],
    });
    expect(calls).toEqual([]);
    if (provider.search === undefined) throw new Error("expected consensus search");

    const result = await provider.search("sleep academic performance", { year_min: 2020, human: true });

    expect(calls[0]!.url).toBe("https://api.consensus.app/v1/quick_search?query=sleep+academic+performance&year_min=2020&human=true");
    expect(calls[0]!.init?.headers).toMatchObject({ "x-api-key": "consensus-key" });
    expect(result.provider).toBe("consensus");
    expect(result.papers).toHaveLength(3);
    expect(result.papers[0]).toMatchObject({
      provider: "consensus",
      doi: "10.0000/consensus.sleep.001",
      title: "Sleep duration and academic performance in university students",
      citationCount: 42,
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]).toMatchObject({
      provider: "consensus",
      quote: "Students reporting longer consistent sleep had modestly higher course grades after adjustment for baseline workload.",
      relation: "mentions",
    });
  });
});
