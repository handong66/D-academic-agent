import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AppConfigSchema, defaultConfig, KeyRefSchema, loadConfig, saveConfig, type AppConfig } from "../src/providers/config.js";

describe("provider app config", () => {
  it("parses the offline default config (nested provider settings)", () => {
    expect(AppConfigSchema.parse(defaultConfig)).toEqual({
      embedder: { provider: "hash", dim: 256 },
      judge: { provider: "mock" },
      pdf: { provider: "unpdf" },
      corpus: "./corpus",
      externalResearch: { mcpProviders: [], httpProviders: [] },
    });
  });

  it("defaults external research providers for existing saved configs", () => {
    const parsed = AppConfigSchema.parse({
      embedder: { provider: "hash", dim: 256 },
      judge: { provider: "mock" },
      pdf: { provider: "unpdf" },
      corpus: "./corpus",
    });
    expect(parsed.externalResearch).toEqual({ mcpProviders: [], httpProviders: [] });
  });

  it("validates provider ids against their registry kind", () => {
    expect(() => AppConfigSchema.parse({ ...defaultConfig, embedder: { provider: "mock" } })).toThrow();
    expect(() => AppConfigSchema.parse({ ...defaultConfig, judge: { provider: "hash" } })).toThrow();
    const ok = AppConfigSchema.parse({
      embedder: { provider: "openai-compatible", model: "m", baseURL: "http://x/v1/", dim: 768 },
      judge: { provider: "openai-compatible", model: "j" },
      pdf: { provider: "unpdf" },
      corpus: "/tmp/c",
      keyRef: "openai-compatible",
    });
    expect(ok.embedder.dim).toBe(768);
    expect(ok.embedder.baseURL).toBe("http://x/v1/");
  });

  it("round-trips JSON losslessly (model/baseURL/dim persist)", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "pc-")), "config.json");
    const config: AppConfig = {
      embedder: { provider: "openai-compatible", model: "nomic-embed-text", baseURL: "http://localhost:11434/v1/", dim: 768 },
      judge: { provider: "mock" },
      pdf: { provider: "unpdf" },
      corpus: "./fixtures/corpus",
      keyRef: "openai-compatible",
      externalResearch: { mcpProviders: [], httpProviders: [] },
    };
    await saveConfig(file, config);
    await expect(loadConfig(file)).resolves.toEqual(config);
  });

  it("parses valid external MCP provider configs", () => {
    const parsed = AppConfigSchema.parse({
      ...defaultConfig,
      externalResearch: {
        mcpProviders: [
          {
            id: "scite",
            label: "scite",
            allowedTools: ["search", "tallies"],
            capabilities: ["paper_search", "citation_contexts", "citation_polarity"],
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
          {
            id: "consensus",
            label: "Consensus",
            allowedTools: ["search"],
            capabilities: ["paper_search", "study_snapshot", "consensus_meter"],
            transport: {
              kind: "streamable-http",
              url: "https://mcp.consensus.app/mcp",
              auth: {
                type: "oauth-pkce",
                resource: "consensus",
                scopes: ["search"],
                tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
                clientIdKeyRef: "CONSENSUS_CLIENT_ID",
                clientSecretKeyRef: "CONSENSUS_CLIENT_SECRET",
              },
            },
          },
        ],
      },
    });
    expect(parsed.externalResearch.mcpProviders).toHaveLength(2);
    expect(parsed.externalResearch.httpProviders).toEqual([]);
  });

  it("rejects malformed external MCP provider configs", () => {
    const baseProvider = {
      id: "scite",
      label: "scite",
      allowedTools: ["search"],
      transport: {
        kind: "streamable-http",
        url: "https://api.scite.ai/mcp",
        auth: { type: "none" },
      },
    };
    expect(() =>
      AppConfigSchema.parse({
        ...defaultConfig,
        externalResearch: { mcpProviders: [{ ...baseProvider, allowedTools: undefined }] },
      }),
    ).toThrow();
    expect(() =>
      AppConfigSchema.parse({
        ...defaultConfig,
        externalResearch: {
          mcpProviders: [{ ...baseProvider, transport: { ...baseProvider.transport, url: "not a url" } }],
        },
      }),
    ).toThrow();
    expect(() =>
      AppConfigSchema.parse({
        ...defaultConfig,
        externalResearch: {
          mcpProviders: [
            {
              ...baseProvider,
              transport: { ...baseProvider.transport, auth: { type: "bearer" } },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("validates key references without accepting obvious raw secrets", () => {
    expect(KeyRefSchema.safeParse("SCITE_CLIENT_SECRET").success).toBe(true);
    expect(KeyRefSchema.safeParse("env.SCITE_KEY").success).toBe(true);
    expect(KeyRefSchema.safeParse("my secret").success).toBe(false);
    expect(KeyRefSchema.safeParse("FOO\nBAR").success).toBe(false);
    expect(KeyRefSchema.safeParse("A".repeat(121)).success).toBe(false);
  });

  it("applies KeyRefSchema to the top-level keyRef (no raw secret there either)", () => {
    expect(AppConfigSchema.safeParse({ ...defaultConfig, keyRef: "openai-compatible" }).success).toBe(true);
    expect(AppConfigSchema.safeParse({ ...defaultConfig, keyRef: "sk-raw secret with spaces" }).success).toBe(false);
    expect(AppConfigSchema.safeParse({ ...defaultConfig, keyRef: "A".repeat(121) }).success).toBe(false);
  });

  it("never persists secrets or unknown fields", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "pc-")), "config.json");
    await saveConfig(file, { ...defaultConfig, keyRef: "openai-compatible", apiKey: "sk-should-not-be-written" } as AppConfig);
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("sk-should-not-be-written");
    expect(JSON.parse(raw)).toEqual({
      embedder: { provider: "hash", dim: 256 },
      judge: { provider: "mock" },
      pdf: { provider: "unpdf" },
      corpus: "./corpus",
      keyRef: "openai-compatible",
      externalResearch: { mcpProviders: [], httpProviders: [] },
    });
  });
});
