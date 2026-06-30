import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tools/tools.js";
import { SearchInput, FulltextInput, ExtractInput, searchSources, getFulltext, checkClaimTool, extractCitations } from "../tools/tools.js";
import { buildLiteratureMatrix } from "../tools/matrix.js";
import { runEval } from "../eval/runner.js";
import { HashEmbedder } from "../retrieve/embed.js";
import { resolveProjectLocal } from "../tools/projectlocal.js";
import { CITATION_AUDIT_SKILL } from "../tools/skill.js";

// MCP face (spec §11): full surface, read-only vs writes-local annotations. Writes-local tools
// pass outDir through resolveProjectLocal. Tested over a real Client/InMemoryTransport.
const json = (x: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(x) }] });

export function createMcpServer(ctx: ToolContext): McpServer {
  const s = new McpServer({ name: "d-academic-agent", version: "0.1.0" });
  // Read tools return their full result INCLUDING traces (§10/§11: tools return TraceEvents).
  s.registerTool("search_sources", { description: "Hybrid-retrieve evidence chunks", inputSchema: SearchInput.shape, annotations: { readOnlyHint: true } }, async (a) => json(await searchSources(ctx, a)));
  s.registerTool("get_fulltext", { description: "Get a source's full text", inputSchema: FulltextInput.shape, annotations: { readOnlyHint: true } }, async (a) => json(await getFulltext(ctx, a)));
  // §17: check_claim is registered FROM the portable CitationAuditSkill bundle (real reuse).
  s.registerTool(CITATION_AUDIT_SKILL.tool, { description: CITATION_AUDIT_SKILL.system, inputSchema: CITATION_AUDIT_SKILL.input.shape, annotations: { readOnlyHint: true } }, async (a) => json(await checkClaimTool(ctx, a)));
  s.registerTool("extract_citations", { description: "Resolve an in-text citation to a source", inputSchema: ExtractInput.shape, annotations: { readOnlyHint: true } }, async (a) => json(extractCitations(ctx, a)));
  s.registerTool("build_matrix", { description: "Write a literature matrix (project-local)", inputSchema: { outDir: z.string() }, annotations: { readOnlyHint: false } },
    async ({ outDir }) => json({ dir: buildLiteratureMatrix([], outDir) }));
  s.registerTool("run_eval", { description: "Run the seed eval (project-local writes)", inputSchema: { outDir: z.string() }, annotations: { readOnlyHint: false } },
    async ({ outDir }) => json(await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: resolveProjectLocal(outDir) }, new HashEmbedder(256), ctx.judge)));
  return s;
}
