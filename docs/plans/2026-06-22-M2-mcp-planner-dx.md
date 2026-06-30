# M2 — MCP Server, Planner Subagent & Developer Experience — Implementation Plan (v2.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose M1's core as a real MCP server (full §11 surface, read-only vs project-local-writing, protocol-tested), add a planner subagent (dedup'd plan-driven retrieval with role traces + an equal-budget planner-recall metric), and ship DX (`replay` + `drill`). Offline/deterministic in CI via M1 mocks; real providers pluggable.

**Architecture:** Pure-TS on M1. Tool layer wraps M1 into typed, classified tools (`read-only` vs `writes-local`); writes-local tools pass `outDir` through a **project-local guard**. MCP server registers the full surface and is tested via the SDK's `InMemoryTransport` + `Client` (real `tools/list`/`tools/call`). Planner is an interface with deterministic `MockPlanner` + provider-agnostic `LlmPlanner`. Tools return `TraceEvent`s; only CLI/runner persist.

**Tech Stack:** TypeScript (strict + `noUncheckedIndexedAccess`), Vitest, `@modelcontextprotocol/sdk@^1.29` (installed + API-verified), `zod`, Vercel AI SDK (real planner only).

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — §7/§10/§11/§14/§17.

**Depends on M1 (locked):** `src/retrieve/{index,embed,types}.ts`, `src/check/{check,judge}.ts`, `src/trace/trace.ts`, `src/eval/{runner,gold,metrics}.ts`, `src/corpus/assemble.ts`, `src/citation/resolver.ts`.

---

## 0. v2 changelog (Codex review of v1 → disposition)

**All six blockers adopted:**
1. **Real MCP tests** (`InMemoryTransport` + `Client`, `tools/list`+`tools/call`+schema+write-side-effect), not a `registeredTools()` mirror — Task 4.
2. **Full §11 surface registered**: `search_sources`, `get_fulltext`, `check_claim`, `extract_citations` (read-only) + `build_matrix`, `run_eval` (writes-local), annotations match — Task 1/3/4.
3. **MCP SDK pinned + API-verified locally** (`@modelcontextprotocol/sdk@1.29.0`: `registerTool({inputSchema: shape, annotations:{readOnlyHint}})`, `InMemoryTransport.createLinkedPair`, `Client`) — code below is against the real API.
4. **Writes-local boundary guard** `resolveProjectLocal()` — every writes-local `outDir` resolved under the project root, traversal rejected — Task 2.
5. **Planner fixes**: `runPlan` dedupes sub-queries; `plan_retrieve` carries `source_hashes`; `evalPlannerRecall` is **equal-budget** (plan total budget = single budget) and uses **locator span-overlap recall** (M1 `recallAtK`); assertion `>=20` not `===23` — Task 7/8.
6. **No placeholders**: `plan` and `drill` CLI branches fully specified + tested via a shared mock-context builder — Task 11.

**Also adopted:** `extract_citations` returns a trace; `get_fulltext` tool added; tool fns `.parse()` input (defaults applied); `LlmPlanner` specified (Task 6); drill matches by **(claim, cited_source) pair** — M1 `runner` failure record extended with `cited_source` (Task 0, small M1 touch); §17 **`CitationAuditSkill`** bundle (tool + snippet-only constitution prompt) exported (Task 5).

**v2.1 (Codex re-review of v2 → READY):** all 6 blockers confirmed CLOSED. Implementation-detail fixes folded in so coding starts clean: (i) `PlanEvidence` carries `char_start`/`char_end`, and `evalPlannerRecall` scores the planner's **ACTUAL** evidence spans (no single-retrieve span substitution that would inflate plan recall) — Task 7/8; (ii) `buildMockContext()` returns an explicit `{ ctx, embedder, judge }` so the `drill` branch's `embedder` is defined (`ToolContext` has none) — Task 11; (iii) `run_eval` tool drops the cast-smell and guards `outDir` via `resolveProjectLocal` — Task 4; (iv) drill `byPair` uses a **tuple key** (`JSON.stringify([claim, source])`), not separator-less concatenation — Task 10.

---

## File Structure
```
academic-agent/src/
  tools/{projectlocal.ts, tools.ts, matrix.ts, skill.ts}
  mcp/{server.ts, stdio.ts}
  plan/{planner.ts, orchestrate.ts, llm-planner.ts}
  eval/planner-eval.ts
  dx/{replay.ts, drill.ts}
  cli.ts
```

---

## Task 0: Extend M1 eval failures with cited_source (M1 touch)

**Files:** Modify `src/eval/runner.ts`; Test `tests/eval.runner.test.ts`

- [ ] **Step 1:** In `EvalReport.failures` and the push site, add `cited_source`. Change the type to `{ claim: string; gold: string; pred: string; cited_source: string }` and push `cited_source: g.cited_source`.
- [ ] **Step 2:** Add to `tests/eval.runner.test.ts`: after running, `expect(res.failures.every((f) => typeof f.cited_source === "string")).toBe(true)`.
- [ ] **Step 3:** `npm test -- eval.runner && npm run typecheck` → PASS.
- [ ] **Step 4: Commit** `git commit -am "feat(harness): eval failures carry cited_source for drilldown (M2 Task 0)"`

---

## Task 1: Project-local write guard

**Files:** Create `src/tools/projectlocal.ts`; Test `tests/tools.projectlocal.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { resolveProjectLocal } from "../src/tools/projectlocal.js";
describe("resolveProjectLocal", () => {
  it("allows paths under the project root and rejects traversal", () => {
    expect(resolveProjectLocal("out/run1")).toContain("out/run1");
    expect(() => resolveProjectLocal("/etc/passwd")).toThrow(/project-local/);
    expect(() => resolveProjectLocal("../../escape")).toThrow(/project-local/);
  });
});
```
- [ ] **Step 2:** `npm test -- tools.projectlocal` → FAIL.
- [ ] **Step 3: Implement** (resolve under cwd/project root; reject escapes)
```ts
import { resolve, relative, isAbsolute } from "node:path";
const ROOT = process.cwd();
export function resolveProjectLocal(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`writes-local: path must be project-local, got "${p}"`);
  return abs;
}
```
- [ ] **Step 4:** `npm test -- tools.projectlocal && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): project-local write guard (M2 Task 1)"`

---

## Task 2: Classified tool layer (full surface, traced, parsed)

**Files:** Create `src/tools/tools.ts`; Test `tests/tools.tools.test.ts`. Add `@modelcontextprotocol/sdk` (already installed).

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockJudge } from "../src/check/judge.js";
import { makeToolContext, TOOL_REGISTRY, searchSources, getFulltext, extractCitations } from "../src/tools/tools.js";

async function ctx() {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  return makeToolContext(sources, texts, await buildIndex(sources, texts, new HashEmbedder(256)), new MockJudge());
}
describe("tool layer", () => {
  it("registry covers the full §11 surface with correct kinds", () => {
    const names = TOOL_REGISTRY.map((t) => t.name).sort();
    expect(names).toEqual(["build_matrix", "check_claim", "extract_citations", "get_fulltext", "run_eval", "search_sources"]);
    expect(TOOL_REGISTRY.filter((t) => t.kind === "writes-local").map((t) => t.name).sort()).toEqual(["build_matrix", "run_eval"]);
  });
  it("search_sources applies schema defaults + returns traces", async () => {
    const r = await searchSources(await ctx(), { query: "social media depression", sourceId: "twenge2018" }); // no k -> default 3
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.length).toBeLessThanOrEqual(3);
    expect(r.traces[0]?.event_type).toBe("search_sources");
  });
  it("get_fulltext + extract_citations return traces", async () => {
    const c = await ctx();
    expect((await getFulltext(c, { source_id: "twenge2018" })).text.length).toBeGreaterThan(0);
    const e = extractCitations(c, { raw_citation: "(Twenge, 2018)" });
    expect(e.resolution.source_id).toBe("twenge2018");
    expect(e.traces[0]?.event_type).toBe("extract_citations");
  });
});
```
- [ ] **Step 2:** `npm test -- tools.tools` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { z } from "zod";
import type { Source } from "../types.js";
import type { HybridRetriever } from "../retrieve/index.js";
import type { Judge } from "../check/judge.js";
import { checkClaim, type CheckResult } from "../check/check.js";
import { Tracer, type TraceEvent } from "../trace/trace.js";
import { CitationResolver, type Resolution } from "../citation/resolver.js";

export interface ToolContext { sources: Source[]; texts: Map<string, string>; retriever: HybridRetriever; judge: Judge; resolver: CitationResolver; }
export function makeToolContext(sources: Source[], texts: Map<string, string>, retriever: HybridRetriever, judge: Judge): ToolContext {
  const map = Object.fromEntries(sources.map((s) => [s.citation_metadata.bibtex_key, s.id]));
  return { sources, texts, retriever, judge, resolver: new CitationResolver(sources, map) };
}
const tracer = () => new Tracer({ model_id: "tool", prompt_version: "tool-1.0" });

export const SearchInput = z.object({ query: z.string(), k: z.number().int().positive().default(3), sourceId: z.string().optional() });
export async function searchSources(ctx: ToolContext, raw: z.input<typeof SearchInput>): Promise<{ hits: { id: string; source_id: string; text: string; rrf_score: number }[]; traces: TraceEvent[] }> {
  const a = SearchInput.parse(raw); const t = tracer();
  const hits = await ctx.retriever.retrieve(a.query, { k: a.k, sourceId: a.sourceId });
  t.add({ event_type: "search_sources", input: a, output: hits.map((h) => h.chunk.id), source_hashes: hits.map((h) => h.chunk.source_hash), retrieval: hits.map((h) => ({ bm25_rank: h.bm25_rank, vector_distance: h.vector_distance, rrf_score: h.rrf_score, final_rank: h.final_rank })) });
  return { hits: hits.map((h) => ({ id: h.chunk.id, source_id: h.chunk.source_id, text: h.chunk.text, rrf_score: h.rrf_score })), traces: t.drain() };
}

export const FulltextInput = z.object({ source_id: z.string() });
export async function getFulltext(ctx: ToolContext, raw: z.input<typeof FulltextInput>): Promise<{ text: string; traces: TraceEvent[] }> {
  const a = FulltextInput.parse(raw); const t = tracer();
  const src = ctx.sources.find((s) => s.id === a.source_id);
  const text = src ? (ctx.texts.get(src.id) ?? "") : "";
  t.add({ event_type: "get_fulltext", input: a, output: { len: text.length }, source_hashes: src ? [src.source_hash] : [] });
  return { text, traces: t.drain() };
}

export const CheckInput = z.object({ claim: z.string(), cited_source: z.string() });
export async function checkClaimTool(ctx: ToolContext, raw: z.input<typeof CheckInput>): Promise<CheckResult> {
  const a = CheckInput.parse(raw);
  return checkClaim(a, ctx.retriever, ctx.judge);
}

export const ExtractInput = z.object({ raw_citation: z.string() });
export function extractCitations(ctx: ToolContext, raw: z.input<typeof ExtractInput>): { resolution: Resolution; traces: TraceEvent[] } {
  const a = ExtractInput.parse(raw); const t = tracer();
  const resolution = ctx.resolver.resolve(a.raw_citation);
  t.add({ event_type: "extract_citations", input: a, output: resolution });
  return { resolution, traces: t.drain() };
}

export type ToolKind = "read-only" | "writes-local";
export const TOOL_REGISTRY: { name: string; kind: ToolKind; input: z.ZodTypeAny }[] = [
  { name: "search_sources", kind: "read-only", input: SearchInput },
  { name: "get_fulltext", kind: "read-only", input: FulltextInput },
  { name: "check_claim", kind: "read-only", input: CheckInput },
  { name: "extract_citations", kind: "read-only", input: ExtractInput },
  { name: "build_matrix", kind: "writes-local", input: z.object({ outDir: z.string() }) },
  { name: "run_eval", kind: "writes-local", input: z.object({ outDir: z.string() }) },
];
```
- [ ] **Step 4:** `npm test -- tools.tools && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): full classified tool surface, traced + schema-parsed (M2 Task 2)"`

---

## Task 3: Literature matrix (project-local writes)

**Files:** Create `src/tools/matrix.ts`; Test `tests/tools.matrix.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs"; import { join } from "node:path";
import { buildLiteratureMatrix } from "../src/tools/matrix.js";
describe("buildLiteratureMatrix", () => {
  it("writes under a project-local dir and rejects traversal", () => {
    const dir = buildLiteratureMatrix([{ source_id: "twenge2018", claim: "X assoc Y", verdict: "supports", quote: "report more", locator: "twenge2018:0-10" }], "out/mtx-test");
    expect(existsSync(join(dir, "matrix.md"))).toBe(true);
    expect(readFileSync(join(dir, "matrix.md"), "utf8")).toContain("twenge2018");
    expect(() => buildLiteratureMatrix([], "/tmp/escape")).toThrow(/project-local/);
  });
});
```
- [ ] **Step 2:** `npm test -- tools.matrix` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { writeFileSync, mkdirSync } from "node:fs"; import { join } from "node:path";
import { resolveProjectLocal } from "./projectlocal.js";
export interface MatrixRow { source_id: string; claim: string; verdict: string; quote: string; locator: string; }
export function buildLiteratureMatrix(rows: MatrixRow[], outDir: string): string {
  const dir = resolveProjectLocal(outDir);
  mkdirSync(dir, { recursive: true });
  const esc = (s: string) => s.replace(/\|/g, "/");
  const head = "| source | claim | verdict | quote | locator |\n|---|---|---|---|---|";
  const body = rows.map((r) => `| ${r.source_id} | ${esc(r.claim)} | ${r.verdict} | ${esc(r.quote).slice(0, 80)} | ${r.locator} |`).join("\n");
  writeFileSync(join(dir, "matrix.md"), `# Literature Matrix (seed)\n\n${head}\n${body}\n`);
  return dir;
}
```
- [ ] **Step 4:** `npm test -- tools.matrix && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): literature matrix writer (project-local) (M2 Task 3)"`

---

## Task 4: MCP server (full surface) — real protocol test

**Files:** Create `src/mcp/server.ts`; Test `tests/mcp.server.test.ts`

- [ ] **Step 1: Failing test** (real `Client` over `InMemoryTransport`)
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
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
    expect(JSON.parse(text).length).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2:** `npm test -- mcp.server` → FAIL.
- [ ] **Step 3: Implement** (register the full surface; writes-local pass through the guard)
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../tools/tools.js";
import { SearchInput, FulltextInput, CheckInput, ExtractInput, searchSources, getFulltext, checkClaimTool, extractCitations } from "../tools/tools.js";
import { buildLiteratureMatrix } from "../tools/matrix.js";
import { runEval } from "../eval/runner.js";
import { HashEmbedder } from "../retrieve/embed.js";
import { resolveProjectLocal } from "../tools/projectlocal.js";

const json = (x: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(x) }] });

export function createMcpServer(ctx: ToolContext): McpServer {
  const s = new McpServer({ name: "d-academic-agent", version: "0.1.0" });
  s.registerTool("search_sources", { description: "Hybrid-retrieve evidence chunks", inputSchema: SearchInput.shape, annotations: { readOnlyHint: true } }, async (a) => json((await searchSources(ctx, a)).hits));
  s.registerTool("get_fulltext", { description: "Get a source's full text", inputSchema: FulltextInput.shape, annotations: { readOnlyHint: true } }, async (a) => json((await getFulltext(ctx, a)).text));
  s.registerTool("check_claim", { description: "Snippet-only claim-citation check", inputSchema: CheckInput.shape, annotations: { readOnlyHint: true } }, async (a) => json(await checkClaimTool(ctx, a)));
  s.registerTool("extract_citations", { description: "Resolve an in-text citation to a source", inputSchema: ExtractInput.shape, annotations: { readOnlyHint: true } }, async (a) => json(extractCitations(ctx, a)));
  s.registerTool("build_matrix", { description: "Write a literature matrix (project-local)", inputSchema: { outDir: z.string() }, annotations: { readOnlyHint: false } },
    async ({ outDir }) => json({ dir: buildLiteratureMatrix([], outDir) }));
  s.registerTool("run_eval", { description: "Run the seed eval (project-local writes)", inputSchema: { outDir: z.string() }, annotations: { readOnlyHint: false } },
    async ({ outDir }) => json(await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: resolveProjectLocal(outDir) }, new HashEmbedder(256), ctx.judge)));
  return s;
}
```
> `run_eval` builds its own `HashEmbedder` (the retriever's is private) and guards `outDir` via `resolveProjectLocal`. If `registerTool` typing rejects an inline raw shape, pass `SomeSchema.shape`.
- [ ] **Step 4:** `npm test -- mcp.server && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): MCP server — full surface, read/write annotations, protocol-tested (M2 Task 4)"`

---

## Task 5: CitationAuditSkill bundle (§17)

**Files:** Create `src/tools/skill.ts`; Test `tests/tools.skill.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { CITATION_AUDIT_SKILL } from "../src/tools/skill.js";
describe("CitationAuditSkill", () => {
  it("bundles the tool name + snippet-only system prompt + input schema", () => {
    expect(CITATION_AUDIT_SKILL.tool).toBe("check_claim");
    expect(CITATION_AUDIT_SKILL.system).toMatch(/snippet/i);
    expect(CITATION_AUDIT_SKILL.input.safeParse({ claim: "x", cited_source: "s" }).success).toBe(true);
  });
});
```
- [ ] **Step 2:** `npm test -- tools.skill` → FAIL.
- [ ] **Step 3: Implement** (one portable bundle reused by MCP + app + CLI)
```ts
import { CheckInput } from "./tools.js";
export const CITATION_AUDIT_SKILL = {
  name: "citation_audit",
  tool: "check_claim",
  input: CheckInput,
  system: "Judge whether a CITED SOURCE SNIPPET supports a CLAIM, using only the snippet (see constitutions/CLAIM_CHECK_CONSTITUTION.md). Output verdict + locator + suggested_rewrite.",
} as const;
```
- [ ] **Step 4:** `npm test -- tools.skill && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): portable CitationAuditSkill bundle (§17) (M2 Task 5)"`

---

## Task 6: Planner subagent (interface + MockPlanner + LlmPlanner)

**Files:** Create `src/plan/planner.ts`, `src/plan/llm-planner.ts`; Test `tests/plan.planner.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { MockPlanner } from "../src/plan/planner.js";
describe("MockPlanner", () => {
  it("turns a question into >=2 deterministic sub-queries", async () => {
    const a = await new MockPlanner().plan("How does social media affect adolescent depression?");
    const b = await new MockPlanner().plan("How does social media affect adolescent depression?");
    expect(a.subqueries.length).toBeGreaterThanOrEqual(2);
    expect(a.subqueries).toEqual(b.subqueries);
  });
});
```
- [ ] **Step 2:** `npm test -- plan.planner` → FAIL.
- [ ] **Step 3: Implement** `src/plan/planner.ts`
```ts
export interface Plan { question: string; subqueries: string[]; }
export interface Planner { readonly model: string; plan(question: string): Promise<Plan>; }
export class MockPlanner implements Planner {
  readonly model = "mock-planner";
  async plan(question: string): Promise<Plan> {
    const base = question.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    return { question, subqueries: [base, `${base} correlation evidence`, `${base} limitations`] };
  }
}
```
And `src/plan/llm-planner.ts` (real, never unit-tested):
```ts
import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { Plan, Planner } from "./planner.js";
const Schema = z.object({ subqueries: z.array(z.string()).min(2).max(6) });
export class LlmPlanner implements Planner {
  readonly model: string; private readonly chat;
  constructor(o: { baseURL: string; apiKey?: string; model: string }) { this.chat = createOpenAICompatible({ name: "agent", baseURL: o.baseURL, apiKey: o.apiKey })(o.model); this.model = o.model; }
  async plan(question: string): Promise<Plan> {
    const { object } = await generateObject({ model: this.chat, schema: Schema, system: "Decompose a research question into 2-5 focused retrieval sub-queries (mechanisms, evidence types, counter-evidence, limitations).", prompt: question });
    return { question, subqueries: object.subqueries };
  }
}
```
- [ ] **Step 4:** `npm test -- plan.planner && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): planner subagent (MockPlanner + LlmPlanner) (M2 Task 6)"`

---

## Task 7: Plan-driven orchestration (dedup + source_hashes)

**Files:** Create `src/plan/orchestrate.ts`; Test `tests/plan.orchestrate.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { runPlan } from "../src/plan/orchestrate.js";
const dupPlanner = { model: "dup", async plan(question: string) { return { question, subqueries: ["social media depression", "social media depression"] }; } };
describe("runPlan", () => {
  it("dedupes sub-queries and traces planner + one plan_retrieve per UNIQUE sub-query", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await runPlan(await buildIndex(sources, texts, new HashEmbedder(256)), dupPlanner, "q", 3);
    expect(r.plan.subqueries).toEqual(["social media depression"]); // deduped in runPlan
    expect(r.traces.filter((t) => t.event_type === "plan_retrieve").length).toBe(1);
    expect(r.traces.find((t) => t.event_type === "plan_retrieve")?.source_hashes.length).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2:** `npm test -- plan.orchestrate` → FAIL.
- [ ] **Step 3: Implement**
```ts
import type { HybridRetriever } from "../retrieve/index.js";
import type { Planner } from "./planner.js";
import { Tracer, type TraceEvent } from "../trace/trace.js";
export interface PlanEvidence { chunk_id: string; source_id: string; text: string; char_start: number; char_end: number; rrf_score: number; subquery: string; }
export async function runPlan(retriever: HybridRetriever, planner: Planner, question: string, k = 3): Promise<{ plan: { question: string; subqueries: string[] }; evidence: PlanEvidence[]; traces: TraceEvent[] }> {
  const t = new Tracer({ model_id: planner.model, prompt_version: "plan-1.0" });
  const raw = await planner.plan(question);
  const subqueries = [...new Set(raw.subqueries.map((q) => q.trim()).filter(Boolean))]; // dedup in orchestrator, not planner
  t.add({ event_type: "planner_plan", input: { question }, output: subqueries });
  const seen = new Set<string>(); const evidence: PlanEvidence[] = [];
  for (const q of subqueries) {
    const hits = await retriever.retrieve(q, { k });
    t.add({ event_type: "plan_retrieve", input: { subquery: q }, output: hits.map((h) => h.chunk.id), source_hashes: hits.map((h) => h.chunk.source_hash), retrieval: hits.map((h) => ({ bm25_rank: h.bm25_rank, vector_distance: h.vector_distance, rrf_score: h.rrf_score, final_rank: h.final_rank })) });
    for (const h of hits) if (!seen.has(h.chunk.id)) { seen.add(h.chunk.id); evidence.push({ chunk_id: h.chunk.id, source_id: h.chunk.source_id, text: h.chunk.text, char_start: h.chunk.char_start, char_end: h.chunk.char_end, rrf_score: h.rrf_score, subquery: q }); }
  }
  return { plan: { question, subqueries }, evidence, traces: t.drain() };
}
```
- [ ] **Step 4:** `npm test -- plan.orchestrate && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): plan orchestration — dedup + source_hashes traces (M2 Task 7)"`

---

## Task 8: Planner-recall eval (equal-budget, locator span-overlap)

**Files:** Create `src/eval/planner-eval.ts`; Test `tests/eval.planner.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "../src/corpus/assemble.js";
import { buildIndex } from "../src/retrieve/index.js";
import { HashEmbedder } from "../src/retrieve/embed.js";
import { MockPlanner } from "../src/plan/planner.js";
import { evalPlannerRecall } from "../src/eval/planner-eval.js";
describe("evalPlannerRecall", () => {
  it("compares plan vs single at EQUAL budget using locator span overlap", async () => {
    const { sources } = assembleSources("fixtures/corpus");
    const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
    const r = await evalPlannerRecall(await buildIndex(sources, texts, new HashEmbedder(256)), new MockPlanner(), "fixtures/gold_claims.jsonl", 6);
    expect(r.n).toBeGreaterThanOrEqual(20);
    expect(r.plan_recall_at_budget).toBeGreaterThanOrEqual(0);
    expect(r.single_recall_at_budget).toBeGreaterThanOrEqual(0);
    expect(r.budget).toBe(6);
  });
});
```
- [ ] **Step 2:** `npm test -- eval.planner` → FAIL.
- [ ] **Step 3: Implement** (both sides capped at the SAME total `budget` chunks; hit = gold locator span overlaps a returned chunk span — reuse M1 `recallAtK`)
```ts
import type { HybridRetriever } from "../retrieve/index.js";
import type { Planner } from "../plan/planner.js";
import { loadGoldClaims } from "./gold.js";
import { runPlan } from "../plan/orchestrate.js";
import { recallAtK } from "./metrics.js";
export async function evalPlannerRecall(retriever: HybridRetriever, planner: Planner, goldPath: string, budget = 6): Promise<{ n: number; budget: number; plan_recall_at_budget: number; single_recall_at_budget: number }> {
  const gold = loadGoldClaims(goldPath);
  const planItems: { gold: [number, number]; retrieved: [number, number][] }[] = [];
  const singleItems: { gold: [number, number]; retrieved: [number, number][] }[] = [];
  for (const g of gold) {
    const goldSpan: [number, number] = [g.locator.char_start, g.locator.char_end];
    const single = await retriever.retrieve(g.claim_text, { k: budget });
    singleItems.push({ gold: goldSpan, retrieved: single.filter((h) => h.chunk.source_id === g.cited_source).map((h) => [h.chunk.char_start, h.chunk.char_end] as [number, number]) });
    const plan = await runPlan(retriever, planner, g.claim_text, Math.max(1, Math.ceil(budget / 3)));
    const planSpans = plan.evidence
      .filter((e) => e.source_id === g.cited_source)
      .slice(0, budget)
      .map((e) => [e.char_start, e.char_end] as [number, number]); // planner's ACTUAL evidence spans (no substitution; Codex re-review)
    planItems.push({ gold: goldSpan, retrieved: planSpans });
  }
  return { n: gold.length, budget, plan_recall_at_budget: recallAtK(planItems, budget), single_recall_at_budget: recallAtK(singleItems, budget) };
}
```
- [ ] **Step 4:** `npm test -- eval.planner && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): planner-recall eval — equal-budget, locator overlap (M2 Task 8)"`

---

## Task 9: DX — trace replay (load + summarize + step reconstruction)

**Files:** Create `src/dx/replay.ts`; Test `tests/dx.replay.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { loadTrace, summarizeTrace, reconstruct } from "../src/dx/replay.js";
const ev = (i: number, type: string, snips: string[] = []) => JSON.stringify({ schema_version: "1.0", event_type: type, step: i, ts: "", model_id: "m", prompt_version: "p", source_hashes: [], input_hash: "a".repeat(64), output_hash: "b".repeat(64), outbound_snippets: snips });
describe("trace replay", () => {
  it("loads, summarizes, and reconstructs ordered steps", () => {
    const f = join(mkdtempSync(join(tmpdir(), "rp-")), "trace.jsonl");
    writeFileSync(f, [ev(0, "judge_cited", ["x"]), ev(1, "judge_counter")].join("\n") + "\n");
    const evs = loadTrace(f);
    const s = summarizeTrace(evs);
    expect(s.total).toBe(2);
    expect(s.byEventType.judge_cited).toBe(1);
    expect(s.outbound_snippet_count).toBe(1);
    expect(reconstruct(evs).map((r) => r.step)).toEqual([0, 1]);
  });
  it("throws a clear error on malformed JSONL", () => {
    const f = join(mkdtempSync(join(tmpdir(), "rp-")), "bad.jsonl");
    writeFileSync(f, "{not json}\n");
    expect(() => loadTrace(f)).toThrow(/trace line/);
  });
});
```
- [ ] **Step 2:** `npm test -- dx.replay` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { readFileSync } from "node:fs";
import type { TraceEvent } from "../trace/trace.js";
export function loadTrace(path: string): TraceEvent[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l) as TraceEvent; } catch { throw new Error(`replay: malformed trace line ${i + 1}`); }
  });
}
export function summarizeTrace(events: TraceEvent[]): { total: number; byEventType: Record<string, number>; models: string[]; outbound_snippet_count: number } {
  const byEventType: Record<string, number> = {};
  for (const e of events) byEventType[e.event_type] = (byEventType[e.event_type] ?? 0) + 1;
  return { total: events.length, byEventType, models: [...new Set(events.map((e) => e.model_id))], outbound_snippet_count: events.reduce((s, e) => s + (e.outbound_snippets?.length ?? 0), 0) };
}
export function reconstruct(events: TraceEvent[]): { step: number; event_type: string; retrieval_count: number; outbound: number }[] {
  return [...events].sort((a, b) => a.step - b.step).map((e) => ({ step: e.step, event_type: e.event_type, retrieval_count: e.retrieval?.length ?? 0, outbound: e.outbound_snippets?.length ?? 0 }));
}
```
- [ ] **Step 4:** `npm test -- dx.replay && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): DX trace replay — load/summarize/reconstruct, malformed-safe (M2 Task 9)"`

---

## Task 10: DX — failure drilldown (pair-keyed)

**Files:** Create `src/dx/drill.ts`; Test `tests/dx.drill.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { drillFailures } from "../src/dx/drill.js";
import type { GoldLabel } from "../src/eval/gold.js";
const gold = [{ claim_text: "X causes Y", cited_source: "s1", snippet: "does not establish X causes Y", rationale: "correlation not causation" }] as GoldLabel[];
describe("drillFailures", () => {
  it("matches failures by (claim, cited_source) pair", () => {
    const out = drillFailures([{ claim: "X causes Y", gold: "unsupported", pred: "supports", cited_source: "s1" }], gold);
    expect(out[0]!.snippet).toContain("does not establish");
    expect(out[0]!.rationale).toContain("correlation");
  });
  it("does not mis-match a same-claim different-source pair", () => {
    const out = drillFailures([{ claim: "X causes Y", gold: "unsupported", pred: "supports", cited_source: "OTHER" }], gold);
    expect(out[0]!.snippet).toBe("");
  });
});
```
- [ ] **Step 2:** `npm test -- dx.drill` → FAIL.
- [ ] **Step 3: Implement**
```ts
import type { GoldLabel } from "../eval/gold.js";
export interface Failure { claim: string; gold: string; pred: string; cited_source: string; }
export interface Drilled extends Failure { snippet: string; rationale: string; }
export function drillFailures(failures: Failure[], gold: GoldLabel[]): Drilled[] {
  const byPair = new Map(gold.map((g) => [JSON.stringify([g.claim_text, g.cited_source]), g])); // tuple key — no separator-less collision
  return failures.map((f) => {
    const g = byPair.get(JSON.stringify([f.claim, f.cited_source]));
    return { ...f, snippet: g?.snippet ?? "", rationale: g?.rationale ?? "" };
  });
}
```
- [ ] **Step 4:** `npm test -- dx.drill && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): DX failure drilldown — pair-keyed (M2 Task 10)"`

---

## Task 11: CLI subcommands (mcp/plan/replay/drill) — fully specified + e2e

**Files:** Modify `src/cli.ts`; Create `src/cli-ctx.ts`; Test `tests/cli.m2.test.ts`

- [ ] **Step 1:** Extract a shared builder into `src/cli-ctx.ts`. It returns the `ToolContext` PLUS the concrete `embedder`/`judge` (Codex re-review: `ToolContext` has no `embedder` field, but `eval`/`drill` must pass one to `runEval`):
```ts
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { assembleSources } from "./corpus/assemble.js";
import { buildIndex } from "./retrieve/index.js";
import { HashEmbedder } from "./retrieve/embed.js";
import { MockJudge } from "./check/judge.js";
import { makeToolContext, type ToolContext } from "./tools/tools.js";
export interface CliContext { ctx: ToolContext; embedder: HashEmbedder; judge: MockJudge; }
export async function buildMockContext(): Promise<CliContext> {
  const { sources } = assembleSources("fixtures/corpus");
  const texts = new Map(sources.map((s) => [s.id, readFileSync(join("fixtures/corpus", `${s.citation_metadata.bibtex_key}.txt`), "utf8")]));
  const embedder = new HashEmbedder(256); const judge = new MockJudge();
  const ctx = makeToolContext(sources, texts, await buildIndex(sources, texts, embedder), judge);
  return { ctx, embedder, judge };
}
```
- [ ] **Step 2: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { runCli } from "../src/cli.js";
describe("M2 CLI", () => {
  it("plan --mock prints evidence; replay summarizes; drill runs", async () => {
    const out = mkdtempSync(join(tmpdir(), "m2-"));
    await runCli(["eval", "--mock", "--out", out]);
    await runCli(["replay", "--trace", join(out, "trace.jsonl")]);
    await runCli(["plan", "--mock", "--q", "social media adolescent depression"]);
    expect(existsSync(join(out, "trace.jsonl"))).toBe(true);
  });
});
```
- [ ] **Step 3:** Implement `runCli` branches:
```ts
if (cmd === "replay") { const { loadTrace, summarizeTrace } = await import("./dx/replay.js"); console.log(JSON.stringify(summarizeTrace(loadTrace(flag("--trace") ?? "out/trace.jsonl")), null, 2)); return; }
if (cmd === "plan") {
  if (!rest.includes("--mock")) throw new Error("plan: real planner needs AGENT_* env; pass --mock");
  const { buildMockContext } = await import("./cli-ctx.js");
  const { MockPlanner } = await import("./plan/planner.js");
  const { runPlan } = await import("./plan/orchestrate.js");
  const c = await buildMockContext();
  const r = await runPlan(c.ctx.retriever, new MockPlanner(), flag("--q") ?? "", 3);
  console.log(JSON.stringify({ subqueries: r.plan.subqueries, evidence: r.evidence.map((e) => e.chunk_id) }, null, 2));
  return;
}
if (cmd === "drill") {
  const { runEval } = await import("./eval/runner.js");
  const { drillFailures } = await import("./dx/drill.js");
  const { loadGoldClaims } = await import("./eval/gold.js");
  const { buildMockContext } = await import("./cli-ctx.js");
  const out = flag("--out") ?? "out";
  const c = await buildMockContext();
  const report = await runEval({ corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir: out }, c.embedder, c.judge);
  console.log(JSON.stringify(drillFailures(report.failures, loadGoldClaims("fixtures/gold_claims.jsonl")), null, 2));
  return;
}
if (cmd === "mcp") { const { startStdioServer } = await import("./mcp/stdio.js"); await startStdioServer(); return; }
```
> `buildMockContext()` returns `{ ctx, embedder, judge }` (the `ToolContext` + concrete embedder/judge) so `eval`/`plan`/`drill` share one builder; the retriever is `c.ctx.retriever`.
- [ ] **Step 4:** `npm test -- cli.m2 && npm test && npm run typecheck && npm run lint` → all green.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): CLI mcp/plan/replay/drill (shared ctx) + e2e (M2 Task 11)"`

---

## Task 12: MCP stdio entry (manual host smoke)

**Files:** Create `src/mcp/stdio.ts`; no unit test

- [ ] **Step 1:** `startStdioServer()` builds the mock `ToolContext` (or real via env) and connects `createMcpServer(ctx)` to `StdioServerTransport`; guard with `fileURLToPath(import.meta.url) === process.argv[1]`. Document host registration in README.
- [ ] **Step 2:** `npx tsc --noEmit` passes; `npm run harness -- mcp` starts (manual smoke).
- [ ] **Step 3: Commit** `git commit -am "feat(harness): MCP stdio entry (manual host smoke) (M2 Task 12)"`

---

## M2 Done — Acceptance (spec §14 M2)
- [ ] `npm test` green; `npm run typecheck` clean; `npm run lint` exit 0.
- [ ] MCP server registers the **full §11 surface** (search/get_fulltext/check/extract read-only + build_matrix/run_eval writes-local), annotations match, **tested over a real `Client`/`InMemoryTransport`** (tools/list + tools/call).
- [ ] Writes-local tools enforce **project-local** paths (traversal rejected).
- [ ] Planner: question → **dedup'd** sub-queries, `planner_plan` + per-unique-subquery `plan_retrieve` traces (with `source_hashes`), **equal-budget locator-overlap** planner recall.
- [ ] DX: `replay` load/summarize/reconstruct (malformed-safe); `drill` **pair-keyed** failure→gold pairing.
- [ ] §17: `CitationAuditSkill` bundle reused by MCP + CLI.

## Out of scope
M3 Electron app; M4 PDF/lit-matrix-UI/co-evolution; sqlite-vec scale; live `LlmPlanner` run.

## Self-Review (plan author)
- **Codex v1 blockers:** real MCP tests ✓(T4) · full surface+annotations ✓(T2/T4) · SDK pinned+verified ✓(installed 1.29, code against real API) · write guard ✓(T1/T3) · planner dedup+source_hashes+equal-budget recall ✓(T7/T8) · no placeholders ✓(T11). Non-blocking: extract trace ✓, get_fulltext ✓, schema parse ✓, LlmPlanner ✓(T6), drill pair-key ✓(T0/T10), CitationAuditSkill ✓(T5).
- **Offline:** every test uses Hash/Mock/InMemoryTransport; real providers + stdio are typecheck/manual only.
- **Type consistency:** `ToolContext`/`TOOL_REGISTRY`/`Plan`/`Planner`/`PlanEvidence`/`TraceEvent`/`Failure`/`Drilled`/`GoldLabel` consistent across tasks.
- **Risk:** `registerTool` raw-shape typing (note in T4); MCP stdio + LlmPlanner not CI-covered (manual).
