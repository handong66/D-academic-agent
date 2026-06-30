import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { makeToolContext } from "../src/tools/tools.js";
import { createMcpServer } from "../src/mcp/server.js";

async function connected() {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  const ctx = makeToolContext(sources, texts, await buildIndex(sources, texts, new HashEmbedder(256)), new MockJudge());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([createMcpServer(ctx).connect(st), client.connect(ct)]);
  return client;
}

describe("MCP server (protocol)", () => {
  it("lists the full surface with read-only annotations", async () => {
    const tools = (await (await connected()).listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["build_matrix", "check_claim", "extract_citations", "get_fulltext", "run_eval", "search_sources"]);
    expect(tools.find((t) => t.name === "search_sources")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "run_eval")?.annotations?.readOnlyHint).toBe(false);
  });
  it("calls search_sources and returns content", async () => {
    const res = await (await connected()).callTool({ name: "search_sources", arguments: { query: "social media depression", sourceId: "twenge2018" } });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.hits.length).toBeGreaterThan(0);
    expect(parsed.traces.length).toBeGreaterThan(0); // §10: read tools return their TraceEvents
  });
  it("build_matrix writes a project-local file and rejects traversal over the protocol", async () => {
    const client = await connected();
    const ok = await client.callTool({ name: "build_matrix", arguments: { outDir: "out/mcp-mtx-test" } });
    const dir = JSON.parse((ok.content as { type: string; text: string }[])[0]!.text).dir;
    expect(existsSync(join(dir, "matrix.md"))).toBe(true);
    const bad = await client.callTool({ name: "build_matrix", arguments: { outDir: "/tmp/escape" } });
    expect(bad.isError).toBe(true);
  });
});
