import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerRuntime } from "../src/app/worker-runtime.js";
import type { SciteTally } from "../src/external/types.js";
import type { AppConfig } from "../src/providers/config.js";

const corpusDir = "fixtures/corpus";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function parseLine(line: string): any {
  return JSON.parse(line);
}

function libraryPath(): string {
  const dir = join(tmpdir(), `d-academic-agent-external-protocol-${randomUUID()}`);
  mkdirSync(dir);
  return join(dir, "library.db");
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

function externalConfig(path: string): AppConfig {
  return {
    embedder: { provider: "hash", dim: 256 },
    judge: { provider: "mock" },
    pdf: { provider: "unpdf" },
    corpus: corpusDir,
    library: path,
    externalResearch: {
      mcpProviders: [
        {
          id: "scite",
          label: "scite",
          enabled: true,
          allowedTools: ["search"],
          capabilities: ["paper_search", "citation_contexts"],
          transport: {
            kind: "streamable-http",
            url: "https://api.scite.ai/mcp",
            auth: {
              type: "scite-client-credentials",
              clientIdKeyRef: "SCITE_CLIENT_ID",
              clientSecretKeyRef: "SCITE_CLIENT_SECRET",
            },
          },
        },
      ],
      httpProviders: [
        {
          id: "consensus",
          label: "Consensus",
          enabled: true,
          baseURL: "https://api.consensus.app",
          capabilities: ["paper_search", "study_snapshot"],
          auth: {
            type: "api-key-header",
            header: "x-api-key",
            keyRef: "CONSENSUS_API_KEY",
          },
        },
      ],
    },
  };
}

describe("external search worker protocol", () => {
  it("reports provider status, runs per-provider external search, and redacts secrets from response lines", async () => {
    const sentinel = "WORKER-SECRET-SENTINEL";
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
      if (url.startsWith("https://api.consensus.app/v1/quick_search")) {
        const body = fixture("consensus") as { results: Array<Record<string, unknown>> };
        body.results[0] = { ...body.results[0], takeaway: `redact this ${sentinel}` };
        return jsonResponse(body);
      }
      return jsonResponse({ error: "unexpected URL" }, 404);
    };
    const path = libraryPath();
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: path, fetch });

    const setLine = await rt.handleLine(
      JSON.stringify({
        id: "set-external",
        type: "set_config",
        config: externalConfig(path),
        secrets: {
          SCITE_CLIENT_ID: "scite-client-id",
          SCITE_CLIENT_SECRET: "scite-client-secret",
          CONSENSUS_API_KEY: "consensus-api-key",
          SENTINEL: sentinel,
        },
      }),
    );
    expect(parseLine(setLine)).toEqual({ id: "set-external", type: "config_applied" });
    expect(setLine).not.toContain(sentinel);

    const statusLine = await rt.handleLine(JSON.stringify({ id: "status-1", type: "external_provider_status" }));
    expect(parseLine(statusLine)).toEqual({
      id: "status-1",
      type: "external_provider_status_result",
      providers: [
        { id: "scite", enabled: true, connected: true, capabilities: ["paper_search", "citation_contexts"] },
        { id: "consensus", enabled: true, connected: true, capabilities: ["paper_search", "study_snapshot"] },
      ],
    });
    expect(calls).toEqual([]);

    const sciteSearchLine = await rt.handleLine(
      JSON.stringify({
        id: "search-scite",
        type: "external_search",
        providerId: "scite",
        query: "sleep academic performance",
        opts: { limit: 5 },
      }),
    );
    const sciteSearch = parseLine(sciteSearchLine);
    expect(sciteSearch).toMatchObject({
      id: "search-scite",
      type: "external_search_result",
      result: {
        provider: "scite",
        papers: [
          {
            provider: "scite",
            providerPaperId: "paper-123",
            title: "Sleep and academic performance in adolescents",
          },
        ],
      },
    });
    expect(sciteSearch.result.evidence).toHaveLength(3);

    const consensusSearchLine = await rt.handleLine(
      JSON.stringify({
        id: "search-consensus",
        type: "external_search",
        providerId: "consensus",
        query: "sleep academic performance",
        opts: { year_min: 2020 },
      }),
    );
    const consensusSearch = parseLine(consensusSearchLine);
    expect(consensusSearch).toMatchObject({
      id: "search-consensus",
      type: "external_search_result",
      result: {
        provider: "consensus",
        papers: expect.arrayContaining([
          expect.objectContaining({
            provider: "consensus",
            title: "Sleep duration and academic performance in university students",
          }),
        ]),
      },
    });
    expect(consensusSearch.result.evidence[0].quote).toBe("redact this ***");
    expect(consensusSearchLine).not.toContain(sentinel);
    expect(consensusSearchLine).toContain("***");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.scite.ai/auth_token_users/token",
      "https://api.scite.ai/api_partner/search?query=sleep+academic+performance&limit=5",
      "https://api.consensus.app/v1/quick_search?query=sleep+academic+performance&year_min=2020",
    ]);
  });

  it("returns scite library reference health signals and redacts secrets from response lines", async () => {
    const sentinel = "REFERENCE-HEALTH-SECRET-SENTINEL";
    const calls: FetchCall[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url === "https://api.scite.ai/auth_token_users/token") {
        return jsonResponse({ access_token: "scite-bearer-token", expires_in: 3600 });
      }
      if (url === "https://api.scite.ai/tallies/aggregate") {
        return jsonResponse([
          tally("10.3000/retracted", { supporting: 1, contradicting: 0, mentioning: 1 }),
          tally("10.3000/contradicted", { supporting: 1, contradicting: 5, mentioning: 4 }),
          tally("10.3000/clean", { supporting: 9, contradicting: 0, mentioning: 1 }),
        ]);
      }
      if (url.startsWith("https://api.scite.ai/papers/")) {
        const doi = decodeURIComponent(url.slice("https://api.scite.ai/papers/".length));
        if (doi === "10.3000/retracted") {
          return jsonResponse({
            doi,
            retracted: true,
            editorialNotices: [{ status: `retraction_notice ${sentinel}`, date: "2024-01-01" }],
          });
        }
        return jsonResponse({ doi, retracted: false, editorialNotices: [] });
      }
      return jsonResponse({ error: "unexpected URL" }, 404);
    };
    const path = libraryPath();
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: path, fetch });

    const setLine = await rt.handleLine(
      JSON.stringify({
        id: "set-external",
        type: "set_config",
        config: externalConfig(path),
        secrets: {
          SCITE_CLIENT_ID: "scite-client-id",
          SCITE_CLIENT_SECRET: "scite-client-secret",
          SENTINEL: sentinel,
        },
      }),
    );
    expect(parseLine(setLine)).toEqual({ id: "set-external", type: "config_applied" });

    const healthLine = await rt.handleLine(
      JSON.stringify({
        id: "health-1",
        type: "library_reference_health",
        dois: ["10.3000/retracted", "10.3000/contradicted", "10.3000/clean"],
      }),
    );
    const health = parseLine(healthLine);

    expect(health).toMatchObject({
      id: "health-1",
      type: "library_reference_health_result",
      signals: [
        { provider: "scite", doi: "10.3000/retracted", risk: "blocked", retracted: true },
        { provider: "scite", doi: "10.3000/contradicted", risk: "risky", pushbackCount: 5 },
        { provider: "scite", doi: "10.3000/clean", risk: "ok", supportCount: 9 },
      ],
    });
    expect(health.signals[0].editorialNotices[0].status).toBe("retraction_notice ***");
    expect(healthLine).not.toContain(sentinel);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.scite.ai/auth_token_users/token",
      "https://api.scite.ai/tallies/aggregate",
      "https://api.scite.ai/papers/10.3000%2Fretracted",
      "https://api.scite.ai/papers/10.3000%2Fcontradicted",
      "https://api.scite.ai/papers/10.3000%2Fclean",
    ]);
  });

  it("returns an empty library reference health result when scite is not configured", async () => {
    const calls: FetchCall[] = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      throw new Error("fetch should not be called without scite config");
    };
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryPath(), fetch });

    const healthLine = await rt.handleLine(
      JSON.stringify({
        id: "health-no-scite",
        type: "library_reference_health",
        dois: ["10.3000/retracted"],
      }),
    );

    expect(parseLine(healthLine)).toEqual({
      id: "health-no-scite",
      type: "library_reference_health_result",
      signals: [],
    });
    expect(calls).toEqual([]);
  });
});
