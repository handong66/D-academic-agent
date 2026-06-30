import { readFileSync } from "node:fs";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callAllowedExternalTool, connectExternalMcpProvider } from "../src/external/mcp-client.js";
import { sciteMcpProviderConfig, sciteSearchLiterature } from "../src/external/providers/scite-mcp.js";
import type { ExternalMcpProviderConfig } from "../src/providers/config.js";

function sampleSearchLiterature(): unknown {
  return JSON.parse(readFileSync("fixtures/external/scite/search_literature.sample.json", "utf8"));
}

function fakeSciteServer(invocations: { count: number }): McpServer {
  const server = new McpServer({ name: "scite-mcp-test", version: "0.0.0" });
  server.registerTool(
    "search_literature",
    {
      description: "Fake scite literature search",
      inputSchema: { query: z.string(), limit: z.number().optional() },
      annotations: { readOnlyHint: true },
    },
    async () => {
      invocations.count += 1;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(sampleSearchLiterature()),
          },
        ],
      };
    },
  );
  return server;
}

async function connectedSciteProvider(providerCfg: ExternalMcpProviderConfig = sciteMcpProviderConfig) {
  const invocations = { count: 0 };
  const server = fakeSciteServer(invocations);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const connection = await Promise.all([
    connectExternalMcpProvider(providerCfg, { transport: clientTransport }),
    server.connect(serverTransport),
  ]).then(([connected]) => connected);
  if (connection.client === undefined) {
    throw new Error("expected connected scite test client");
  }
  return { client: connection.client, invocations };
}

describe("scite MCP adapter", () => {
  it("maps the sparse search_literature MCP result to ExternalPaper entries", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const invocations = { count: 0 };
    const server = fakeSciteServer(invocations);
    const serverConnected = server.connect(serverTransport);

    const papers = await sciteSearchLiterature({ query: "sleep and academic performance", limit: 5 }, { transport: clientTransport });
    await serverConnected;

    expect(invocations.count).toBe(1);
    expect(papers).toEqual([
      {
        provider: "scite",
        title: "1205 SLEEP DIFFICULTIES ASSOCIATED WITH ACADEMIC PERFORMANCE IN STUDENT ATHLETES",
        doi: "10.1093/sleepj/zsx050.1204",
        url: "https://libkey.io/libraries/267/articles/99374859/full-text-file?utm_source=api_3210&allow_speedbump=true",
        authors: [],
      },
      {
        provider: "scite",
        title: "Sleep quality as a mediating role in general health and academic performance in the context of sustainable education",
        doi: "10.53894/ijirss.v7i2.2864",
        url: "https://ct.prod.getft.io/c2NpdGUsdW5kZWZpbmVkLE1UQXVOVE00T1RRdmFXcHBjbk56TG5ZM2FUSXVNamcyTkEsTW1ZMlltUXlZVEF0WlRRME1pMDBaR0V3TFdKbU5Ea3RNR05qWW1JeU1UUmhOelJpLGh0dHA6Ly9keC5kb2kub3JnLzEwLjUzODk0L2lqaXJzcy52N2kyLjI4NjQ.ilSEnFpxslQUZmdInID9hfBD2BW6r5Xl3pa2QMsfiQc",
        authors: [],
      },
      {
        provider: "scite",
        title: "Sleep Quality, Sleep Propensity and Academic Performance",
        doi: "10.2466/pms.99.2.525-535",
        url: "https://libkey.io/libraries/267/articles/56762311/full-text-file?utm_source=api_3210&allow_speedbump=true",
        authors: [],
      },
      {
        provider: "scite",
        title: "Sluggish Cognitive Tempo and Daytime Sleepiness Mediate Relationships Between Sleep and Academic Performance",
        doi: "10.1097/dbp.0000000000000948",
        url: "https://julac-eduhk.primo.exlibrisgroup.com/openurl/852JULAC_EDUHK/852JULAC_EDUHK:EDUHK?genre=article&aulast=O'Hare&issn=0196-206X&title=Journal%20of%20Developmental%20%26%20Behavioral%20Pediatrics&atitle=Sluggish%20Cognitive%20Tempo%20and%20Daytime%20Sleepiness%20Mediate%20Relationships%20Between%20Sleep%20and%20Academic%20Performance&volume=42&issue=8&spage=637&epage=647&date=2021-10-01&rft_id=info:doi/10.1097%2FDBP.0000000000000948&rft_id=info:pmid/34074917&sid=LibKey",
        authors: [],
      },
      {
        provider: "scite",
        title: "Effects of Sleep on the Academic Performance of Children with Attention Deficit and Hyperactivity Disorder",
        doi: "10.3390/brainsci11010097",
        url: "https://libkey.io/libraries/267/articles/431952152/full-text-file?utm_source=api_3210&allow_speedbump=true",
        authors: [],
      },
    ]);
  });

  it("rejects non-search_literature tool names through the shared allowlist guard", async () => {
    const { client, invocations } = await connectedSciteProvider();

    try {
      await expect(callAllowedExternalTool(client, sciteMcpProviderConfig, "unsafe_write", { query: "x" })).rejects.toThrow(/not allowed/i);
      expect(invocations.count).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("fails loud when an MCP result drops the doi identifier (no silent Untitled)", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "scite-mcp-test-bad", version: "0.0.0" });
    server.registerTool(
      "search_literature",
      { description: "bad", inputSchema: { query: z.string() }, annotations: { readOnlyHint: true } },
      async () => ({ content: [{ type: "text" as const, text: JSON.stringify({ results: [{ title: "no doi here", url: "u" }] }) }] }),
    );
    const serverConnected = server.connect(serverTransport);

    await expect(sciteSearchLiterature({ query: "x" }, { transport: clientTransport })).rejects.toThrow(/search_literature response/i);
    await serverConnected;
  });
});
