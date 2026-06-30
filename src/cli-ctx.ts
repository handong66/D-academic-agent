import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleSources } from "./corpus/assemble.js";
import { buildIndex } from "./retrieve/index.js";
import { HashEmbedder } from "./retrieve/embed.js";
import { MockJudge } from "./check/judge.js";
import { makeToolContext, type ToolContext } from "./tools/tools.js";

// Shared offline builder for eval/plan/drill. Returns the ToolContext PLUS the concrete
// embedder/judge, because ToolContext has no embedder field but runEval needs one.
export interface CliContext { ctx: ToolContext; embedder: HashEmbedder; judge: MockJudge; }

export async function buildMockContext(): Promise<CliContext> {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  const embedder = new HashEmbedder(256);
  const judge = new MockJudge();
  const ctx = makeToolContext(sources, texts, await buildIndex(sources, texts, embedder), judge, embedder);
  return { ctx, embedder, judge };
}
