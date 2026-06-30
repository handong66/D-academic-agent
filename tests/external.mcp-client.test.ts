import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callAllowedExternalTool,
  connectExternalMcpProvider,
  oauthPkceAuth,
  sciteClientCredentialsAuth,
  UnsupportedAuthError,
} from "../src/external/mcp-client.js";
import type { ExternalMcpProviderConfig } from "../src/providers/config.js";

const searchProvider = (allowedTools = ["search"]): ExternalMcpProviderConfig => ({
  id: "scite",
  label: "scite MCP",
  enabled: true,
  allowedTools,
  capabilities: ["paper_search", "citation_contexts", "not_a_capability"],
  transport: {
    kind: "stdio",
    command: "scite-mcp",
  },
});

function fakeSearchServer(invocations: { count: number }): McpServer {
  const server = new McpServer({ name: "external-provider-test", version: "0.0.0" });
  server.registerTool(
    "search",
    {
      description: "Fake read-only paper search",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      invocations.count += 1;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ query, papers: [{ title: "Fake MCP result" }] }),
          },
        ],
      };
    },
  );
  return server;
}

async function connectFakeProvider(providerCfg: ExternalMcpProviderConfig = searchProvider(), secrets?: Record<string, string>) {
  const invocations = { count: 0 };
  const server = fakeSearchServer(invocations);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const connection = await Promise.all([
    connectExternalMcpProvider(providerCfg, { transport: clientTransport, secrets }),
    server.connect(serverTransport),
  ]).then(([connected]) => connected);
  if (connection.client === undefined) {
    throw new Error("expected connected test client");
  }
  return { client: connection.client, status: connection.status, invocations };
}

describe("external MCP client wrapper", () => {
  it("connects with InMemoryTransport and exposes listed tools plus explicit capabilities", async () => {
    const { client, status } = await connectFakeProvider();

    expect(status).toEqual({
      id: "scite",
      enabled: true,
      connected: true,
      capabilities: ["paper_search", "citation_contexts"],
    });

    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["search"]);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
  });

  it("rejects non-allowlisted tool names before any server call", async () => {
    const { client, invocations } = await connectFakeProvider();

    await expect(callAllowedExternalTool(client, searchProvider(), "unsafe_write", { query: "x" })).rejects.toThrow(/not allowed/i);
    expect(invocations.count).toBe(0);
  });

  it("calls allowlisted tools and returns the provider payload", async () => {
    const { client, invocations } = await connectFakeProvider();

    const result = await callAllowedExternalTool(client, searchProvider(), "search", { query: "social media" });
    const text = (result.content as { type: string; text: string }[])[0]!.text;

    expect(JSON.parse(text)).toEqual({ query: "social media", papers: [{ title: "Fake MCP result" }] });
    expect(invocations.count).toBe(1);
  });

  it("returns a deferred status for unsupported provider auth without connecting", async () => {
    const providerCfg: ExternalMcpProviderConfig = {
      ...searchProvider(),
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

    const [clientTransport] = InMemoryTransport.createLinkedPair();
    const connection = await connectExternalMcpProvider(providerCfg, { transport: clientTransport });

    expect(connection.client).toBeUndefined();
    expect(connection.status.connected).toBe(false);
    expect(connection.status.message).toMatch(/auth lands in C\/D/i);
    expect(connection.status.capabilities).toEqual(["paper_search", "citation_contexts"]);
  });

  it("returns a deferred status for oauth-pkce when the access token scalar is absent", async () => {
    const providerCfg: ExternalMcpProviderConfig = {
      ...searchProvider(),
      transport: {
        kind: "streamable-http",
        url: "https://mcp.consensus.app/mcp",
        auth: {
          type: "oauth-pkce",
          scopes: ["search"],
          tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
        },
      },
    };

    const [clientTransport] = InMemoryTransport.createLinkedPair();
    const connection = await connectExternalMcpProvider(providerCfg, { transport: clientTransport, secrets: {} });

    expect(connection.client).toBeUndefined();
    expect(connection.status.connected).toBe(false);
    expect(connection.status.message).toMatch(/oauth-pkce/i);
  });

  it("connects oauth-pkce providers when handed an access-token scalar", async () => {
    const providerCfg: ExternalMcpProviderConfig = {
      ...searchProvider(),
      id: "consensus",
      label: "Consensus MCP",
      transport: {
        kind: "streamable-http",
        url: "https://mcp.consensus.app/mcp",
        auth: {
          type: "oauth-pkce",
          scopes: ["search"],
          tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
        },
      },
    };

    const { client, status } = await connectFakeProvider(providerCfg, { CONSENSUS_OAUTH_TOKEN: "access-token-scalar" });

    try {
      expect(oauthPkceAuth("access-token-scalar")).toEqual({ headers: { Authorization: "Bearer access-token-scalar" } });
      expect(status.connected).toBe(true);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["search"]);
    } finally {
      await client.close();
    }
  });

  it("throws UnsupportedAuthError from auth factories that still require a live exchange", () => {
    expect(() => sciteClientCredentialsAuth()).toThrow(UnsupportedAuthError);
  });
});
