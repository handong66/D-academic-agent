import { describe, expect, it } from "vitest";
import { declaredCapabilities, enabledProviders, providerById } from "../src/external/provider-registry.js";
import type { ExternalResearchConfig } from "../src/providers/config.js";

const config: ExternalResearchConfig = {
  mcpProviders: [
    {
      id: "scite",
      label: "scite MCP",
      enabled: true,
      allowedTools: ["search"],
      capabilities: ["paper_search"],
      transport: {
        kind: "stdio",
        command: "scite-mcp",
      },
    },
    {
      id: "consensus",
      label: "Consensus MCP",
      enabled: false,
      allowedTools: ["search"],
      capabilities: ["study_snapshot"],
      transport: {
        kind: "stdio",
        command: "consensus-mcp",
      },
    },
  ],
  httpProviders: [
    {
      id: "consensus",
      label: "Consensus HTTP",
      enabled: true,
      baseURL: "https://api.consensus.app",
      capabilities: ["paper_metadata"],
      auth: { type: "none" },
    },
  ],
};

describe("external provider registry", () => {
  it("returns enabled MCP and HTTP providers", () => {
    expect(enabledProviders(config).map((provider) => provider.label)).toEqual(["scite MCP", "Consensus HTTP"]);
  });

  it("looks up providers by id", () => {
    expect(providerById(config, "scite")?.label).toBe("scite MCP");
    expect(providerById({ mcpProviders: [], httpProviders: [] }, "scite")).toBeUndefined();
  });

  it("parses capabilities from the explicit field only", () => {
    const provider = {
      id: "scite",
      label: "scite MCP",
      enabled: true,
      allowedTools: ["citation_contexts", "paper_metadata", "search"],
      capabilities: ["paper_search", "not_a_capability", "citation_polarity"],
      transport: {
        kind: "stdio",
        command: "scite-mcp",
      },
    } satisfies ExternalResearchConfig["mcpProviders"][number];

    expect(declaredCapabilities(provider)).toEqual(["paper_search", "citation_polarity"]);
    expect(declaredCapabilities(provider)).not.toContain("citation_contexts");
    expect(declaredCapabilities(provider)).not.toContain("paper_metadata");
  });
});
