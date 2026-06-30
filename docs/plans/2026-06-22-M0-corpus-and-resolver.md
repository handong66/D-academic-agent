# M0 — Frozen Corpus, Gold Set & CitationResolver — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the evaluation foundation — a frozen demo corpus with a full source registry, a versioned gold-label set, offset-stable source hashing, a `CitationResolver`, and **executable invariant lints** (gates-over-memory) — so M1's checker/eval can be written against stable, hashed, machine-validated inputs.

**Architecture:** Pure-TS, headless, no DB. Parse BibTeX (via `citation-js`) + ingest `.txt` into typed `Source[]`; freeze to `fixtures/sources.lock.json`; resolve citations to `Source.id`; define gold with structured locators + snippet containment; enforce spec invariants as executable lint rules (`HARNESS-§…`), not prose. Governance (AGENTS.md + claim-check constitution + doc-sync set) borrowed from the MPhil-thesis repo's "关卡优先于记忆 / 真相源是代码" pattern. SQLite/retrieval/checker are M1.

**Tech Stack:** TypeScript (ESM, NodeNext, strict + `noUncheckedIndexedAccess`), Vitest, `node:crypto`, `zod` (runtime dep), `citation-js` (runtime dep), `tsx` (dev, for CLI scripts).

**Spec:** [`../2026-06-22-litreview-harness-spec.md`](../2026-06-22-litreview-harness-spec.md) — implements §4 / §9 / §14-M0.

---

## 0. v2 变更（Codex M0 评审处置 + MPhil 宪法范式）

**A. Codex 直接采纳（修复）**
- Source 补 `citation_metadata`（spec §4）— Task 2。
- `ClaimCitationPair` 不变式从注释 → **可执行 guard `makeClaimCitationPair()` + 测试**（rule `HARNESS-§4-PAIR-INVARIANT`）— Task 2 + Task 10。
- gold `locator` 结构化（source_hash + char 区间 + 可选 section）+ **snippet 包含校验** + 全五标签/overclaim 覆盖校验 — Task 9 + Task 10。
- `noUncheckedIndexedAccess` 下的索引 bug（`m[1]`/`hits[0]`/`keyMatch[1]`）全部加守卫 — 各任务代码已改。
- BibTeX 改用 `citation-js`（brace-balanced、与 spec 选型一致），弃手写正则 — Task 5。
- 新增**装配任务**：refs.bib → Source[] → `sources.lock.json`（含元数据的源注册表，取代只存 hash 的 corpus.lock）+ `bibKeyToSourceId` + 集成测试 — Task 6。
- CitationResolver 修 author-year 假阳性（按**已知源 surname** 匹配、不抓任意大写词）、多键 `\cite{a,b}`、coauthor 消歧、ambiguous — Task 7。
- hash 改为 offset-stable canonical（仅 CRLF→LF，不折叠内部空白），与 locator char 偏移一致 — Task 3。
- gold 加 `raw_citation`，使"resolver 能解析每条 gold 引用"可操作 — Task 9 + Task 12。
- `tsx` + 真实 CLI 入口 + `freeze` npm script；`zod`/`citation-js` 移入 runtime deps — Task 1 + Task 8。

**B. 我的判断（微调 Codex）**
- 语料：**不强塞全文论文**（全文 PDF 是 M4）。M0 语料显式标注为 **toy seed corpus**，并立红线"M1 指标不得对外宣称为权威 benchmark、仅 seed eval"。Codex 第 5 项给的就是这个备选。

**C. MPhil 宪法范式新增（提升 Harness 成熟度）**
- `src/lint/invariants.ts`：把 spec 不变式做成**自动触发的可执行关卡**（rule ID → spec §，severity 仅 error/warning）— Task 10。"关卡优先于记忆"。
- `AGENTS.md`（<90s 路由 + Red Lines）+ `constitutions/CLAIM_CHECK_CONSTITUTION.md`（命题拆解 + 反核验理由清单 + snippet-only 红线）— Task 11。
- doc-sync 一致性集（verdict enum ↔ gold schema ↔ rubric 必须同步）写入 AGENTS.md — Task 11。

---

## File Structure

```
academic-agent/
  package.json  tsconfig.json  vitest.config.ts
  AGENTS.md                              # router + Red Lines + doc-sync set
  constitutions/CLAIM_CHECK_CONSTITUTION.md
  src/
    types.ts                            # Source(+citation_metadata), CitationMention, makeClaimCitationPair guard, Verdict
    ingest/hash.ts                      # canonical (CRLF->LF), offset-stable sha256
    ingest/text.ts                      # ingestTextSource
    ingest/bibtex.ts                    # parseBibtex via citation-js -> BibEntry[]
    corpus/assemble.ts                  # assembleSources(): refs.bib + *.txt -> {sources, bibKeyToSourceId}; writeSourcesLock()
    citation/resolver.ts                # CitationResolver (surname-vs-known-sources, multi-key, coauthor disambig)
    eval/gold.ts                        # GoldLabel zod (structured locator + raw_citation) + loadGoldClaims
    lint/invariants.ts                  # HARNESS-* executable rules + runLint()
  scripts/freeze.ts                     # CLI: write fixtures/sources.lock.json
  fixtures/
    corpus/*.txt  corpus/refs.bib
    sources.lock.json                   # frozen Source registry (hashes + metadata)
    gold_claims.jsonl  ANNOTATION_RUBRIC.md
  tests/ (mirrors src)
```

---

## Task 1: Project init

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`; Test `tests/smoke.test.ts`

- [ ] **Step 1: Write `tests/smoke.test.ts`**
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => { it("runs", () => { expect(1 + 1).toBe(2); }); });
```
- [ ] **Step 2: `package.json`** (zod + citation-js are runtime deps; tsx dev)
```json
{
  "name": "d-academic-agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "tsx src/lint/invariants.ts",
    "freeze": "tsx scripts/freeze.ts"
  },
  "dependencies": { "zod": "^3.23.0", "citation-js": "^0.7.14" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0", "tsx": "^4.19.0", "@types/node": "^22.0.0" }
}
```
- [ ] **Step 3: `tsconfig.json` + `vitest.config.ts`**
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noUncheckedIndexedAccess": true, "esModuleInterop": true,
    "skipLibCheck": true, "resolveJsonModule": true, "outDir": "dist"
  },
  "include": ["src", "tests", "scripts"]
}
```
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
```
- [ ] **Step 4:** `cd academic-agent && npm install && npm test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "chore(harness): init TS+vitest, runtime deps zod/citation-js (M0)"`

---

## Task 2: Typed contracts + ClaimCitationPair guard

**Files:** Create `src/types.ts`; Test `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { VERDICTS, isVerdict, makeClaimCitationPair } from "../src/types.js";
import type { CitationMention } from "../src/types.js";

const resolved: CitationMention = { draft_sentence_id: "s1", char_start: 0, char_end: 5, raw_citation: "(Smith, 2021)", resolved_source_id: "smith2021", resolution_status: "resolved" };
const unresolved: CitationMention = { ...resolved, resolved_source_id: undefined, resolution_status: "unresolved" };

describe("types", () => {
  it("verdict enum + guard", () => {
    expect(VERDICTS).toEqual(["supports","weakly_supports","unsupported","contradicts","unclear"]);
    expect(isVerdict("supports")).toBe(true);
    expect(isVerdict("nope")).toBe(false);
  });
  it("makeClaimCitationPair enforces the §4 invariant", () => {
    const pair = makeClaimCitationPair("c1", "m1", resolved);
    expect(pair.source_id).toBe("smith2021");
    expect(() => makeClaimCitationPair("c1", "m1", unresolved)).toThrow(/resolved/i);
  });
});
```
- [ ] **Step 2:** `npm test -- types` → FAIL.
- [ ] **Step 3: Implement `src/types.ts`**
```ts
export interface Source {
  id: string;
  title: string;
  authors: string[];           // surnames in order
  year: string;
  type: "scholarly_article" | "book" | "webpage" | "lecture_note" | "other";
  path_or_url: string;
  source_hash: string;
  citation_metadata: { bibtex_key: string; raw?: Record<string, unknown> }; // spec §4
  fulltext_status: "unavailable" | "extracted" | "indexed";
}

export interface CitationMention {
  draft_sentence_id: string;
  char_start: number;          // citation span in draft (was "CitationSpan")
  char_end: number;
  raw_citation: string;
  resolved_source_id?: string; // AUTHORITATIVE binding
  resolution_status: "resolved" | "unresolved" | "ambiguous";
}

export interface ClaimCitationPair { claim_id: string; citation_mention_id: string; source_id: string; }

// §4 invariant as an executable guard (gates-over-memory): only resolved mentions form pairs,
// and pair.source_id is a copy of the authoritative resolved_source_id.
export function makeClaimCitationPair(claim_id: string, citation_mention_id: string, mention: CitationMention): ClaimCitationPair {
  if (mention.resolution_status !== "resolved" || !mention.resolved_source_id) {
    throw new Error(`HARNESS-§4-PAIR-INVARIANT: cannot form ClaimCitationPair from a non-resolved mention (${mention.raw_citation})`);
  }
  return { claim_id, citation_mention_id, source_id: mention.resolved_source_id };
}

export const VERDICTS = ["supports","weakly_supports","unsupported","contradicts","unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];
export function isVerdict(x: unknown): x is Verdict {
  return typeof x === "string" && (VERDICTS as readonly string[]).includes(x);
}
```
- [ ] **Step 4:** `npm test -- types && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): typed contracts + executable ClaimCitationPair invariant (M0)"`

---

## Task 3: Offset-stable source hash

**Files:** Create `src/ingest/hash.ts`; Test `tests/ingest.hash.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { canonicalize, sourceHash } from "../src/ingest/hash.js";

describe("sourceHash", () => {
  it("normalizes only line endings (offset-stable), distinct text => distinct hash", () => {
    expect(canonicalize("a\r\nb")).toBe("a\nb");           // CRLF->LF only
    expect(canonicalize("a  b")).toBe("a  b");              // internal spaces preserved (locators stay valid)
    expect(sourceHash("Hello world")).not.toBe(sourceHash("Hello  world"));
    expect(sourceHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```
- [ ] **Step 2:** `npm test -- ingest.hash` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { createHash } from "node:crypto";
// Canonical form = the exact text M1 chunkers and gold locators index into.
// Only line endings are normalized so char offsets are stable across OS; internal whitespace is preserved.
export function canonicalize(content: string): string { return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
export function sourceHash(content: string): string {
  return createHash("sha256").update(canonicalize(content), "utf8").digest("hex");
}
```
- [ ] **Step 4:** `npm test -- ingest.hash` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): offset-stable canonical source hash (M0)"`

---

## Task 4: Text/Markdown ingest

**Files:** Create `src/ingest/text.ts`; Test `tests/ingest.text.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { ingestTextSource } from "../src/ingest/text.js";

describe("ingestTextSource", () => {
  it("builds a Source with citation_metadata + offset-stable hash", () => {
    const s = ingestTextSource({ id: "smith2021", bibtex_key: "smith2021", title: "Access", authors: ["Smith"], year: "2021", path_or_url: "fixtures/corpus/smith2021.txt", content: "Urban access improved." });
    expect(s.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.citation_metadata.bibtex_key).toBe("smith2021");
    expect(s.fulltext_status).toBe("extracted");
  });
});
```
- [ ] **Step 2:** `npm test -- ingest.text` → FAIL.
- [ ] **Step 3: Implement**
```ts
import type { Source } from "../types.js";
import { sourceHash } from "./hash.js";
export interface TextIngestInput { id: string; bibtex_key: string; title: string; authors: string[]; year: string; path_or_url: string; content: string; type?: Source["type"]; }
export function ingestTextSource(i: TextIngestInput): Source {
  return { id: i.id, title: i.title, authors: i.authors, year: i.year, type: i.type ?? "scholarly_article",
    path_or_url: i.path_or_url, source_hash: sourceHash(i.content),
    citation_metadata: { bibtex_key: i.bibtex_key }, fulltext_status: "extracted" };
}
```
- [ ] **Step 4:** `npm test -- ingest.text` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): text/markdown ingest with citation_metadata (M0)"`

---

## Task 5: BibTeX parse via citation-js

**Files:** Create `src/ingest/bibtex.ts`; Test `tests/ingest.bibtex.test.ts`

- [ ] **Step 1: Failing test** (covers multi-entry + nested braces in title)
```ts
import { describe, it, expect } from "vitest";
import { parseBibtex } from "../src/ingest/bibtex.js";

const RAW = `@article{smith2021, author={Smith, John and Jones, Amy}, year={2021}, title={Access in {Urban} schools}}
@article{lee2020, author={Lee, Kim}, year={2020}, title={Sleep}}`;

describe("parseBibtex", () => {
  it("parses keys, surnames, year, title (brace-balanced)", () => {
    const es = parseBibtex(RAW);
    expect(es.map(e => e.key)).toEqual(["smith2021", "lee2020"]);
    expect(es[0]?.authors).toEqual(["Smith", "Jones"]);
    expect(es[0]?.year).toBe("2021");
    expect(es[0]?.title).toContain("Urban");
  });
});
```
- [ ] **Step 2:** `npm test -- ingest.bibtex` → FAIL.
- [ ] **Step 3: Implement (citation-js → CSL-JSON → BibEntry)**
```ts
import Cite from "citation-js";
export interface BibEntry { key: string; authors: string[]; year: string; title: string; }

interface CslName { family?: string; literal?: string; }
interface CslItem { id?: string; title?: string; author?: CslName[]; issued?: { "date-parts"?: number[][] }; }

export function parseBibtex(raw: string): BibEntry[] {
  const data = new Cite(raw).data as CslItem[];
  return data.map((it) => {
    const authors = (it.author ?? []).map((a) => (a.family ?? a.literal ?? "").trim()).filter(Boolean);
    const year = String(it.issued?.["date-parts"]?.[0]?.[0] ?? "");
    return { key: it.id ?? "", authors, year, title: it.title ?? "" };
  });
}
```
- [ ] **Step 4:** `npm test -- ingest.bibtex` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): BibTeX parsing via citation-js (M0)"`

---

## Task 6: Assembly — refs.bib + .txt → Source[] + bibKey map + sources.lock

**Files:** Create `src/corpus/assemble.ts`; Test `tests/corpus.assemble.test.ts`

- [ ] **Step 1: Failing test** (uses a tiny inline fixture dir created in the test)
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleSources } from "../src/corpus/assemble.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "corpus-"));
  writeFileSync(join(dir, "refs.bib"), `@article{smith2021, author={Smith, John}, year={2021}, title={Access}}`);
  writeFileSync(join(dir, "smith2021.txt"), "Urban access improved.");
});

describe("assembleSources", () => {
  it("joins bib + txt into Source[] and a bibKey map", () => {
    const { sources, bibKeyToSourceId } = assembleSources(dir);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.id).toBe("smith2021");
    expect(sources[0]?.citation_metadata.bibtex_key).toBe("smith2021");
    expect(bibKeyToSourceId["smith2021"]).toBe("smith2021");
  });
  it("throws when a .bib entry has no matching .txt", () => {
    const d2 = mkdtempSync(join(tmpdir(), "corpus-"));
    writeFileSync(join(d2, "refs.bib"), `@article{ghost2000, author={Ghost, A}, year={2000}, title={X}}`);
    expect(() => assembleSources(d2)).toThrow(/ghost2000/);
  });
});
```
- [ ] **Step 2:** `npm test -- corpus.assemble` → FAIL.
- [ ] **Step 3: Implement**
```ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseBibtex } from "../ingest/bibtex.js";
import { ingestTextSource } from "../ingest/text.js";
import type { Source } from "../types.js";

export function assembleSources(dir: string): { sources: Source[]; bibKeyToSourceId: Record<string, string> } {
  const entries = parseBibtex(readFileSync(join(dir, "refs.bib"), "utf8"));
  const sources: Source[] = [];
  const bibKeyToSourceId: Record<string, string> = {};
  for (const e of entries) {
    const txt = join(dir, `${e.key}.txt`);
    if (!existsSync(txt)) throw new Error(`assembleSources: bib entry "${e.key}" has no matching ${e.key}.txt`);
    const s = ingestTextSource({ id: e.key, bibtex_key: e.key, title: e.title, authors: e.authors, year: e.year, path_or_url: txt, content: readFileSync(txt, "utf8") });
    sources.push(s);
    bibKeyToSourceId[e.key] = s.id;
  }
  sources.sort((a, b) => a.id.localeCompare(b.id)); // deterministic
  return { sources, bibKeyToSourceId };
}

export function writeSourcesLock(dir: string, out: string): void {
  const { sources } = assembleSources(dir);
  writeFileSync(out, JSON.stringify(sources, null, 2) + "\n");
}
```
- [ ] **Step 4:** `npm test -- corpus.assemble` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): assemble refs.bib + txt into Source registry (M0)"`

---

## Task 7: CitationResolver

**Files:** Create `src/citation/resolver.ts`; Test `tests/citation.resolver.test.ts`

- [ ] **Step 1: Failing test** (false-positive, et al., ambiguous, coauthor disambig, multi-key, miss)
```ts
import { describe, it, expect } from "vitest";
import { CitationResolver } from "../src/citation/resolver.js";
import type { Source } from "../src/types.js";

const mk = (id: string, authors: string[], year: string): Source => ({ id, title: "", authors, year, type: "scholarly_article", path_or_url: "", source_hash: "h", citation_metadata: { bibtex_key: id }, fulltext_status: "extracted" });
const sources = [ mk("smith2021a", ["Smith", "Lee"], "2021"), mk("smith2021b", ["Smith", "Wong"], "2021"), mk("jones2020", ["Jones", "Park"], "2020") ];
const r = new CitationResolver(sources, { smith2021a: "smith2021a", smith2021b: "smith2021b", jones2020: "jones2020" });

describe("CitationResolver", () => {
  it("bibtex key (incl multi-key picks first resolvable)", () => {
    expect(r.resolve("\\cite{jones2020}").source_id).toBe("jones2020");
    expect(r.resolve("\\cite{missing,jones2020}").source_id).toBe("jones2020");
  });
  it("author-year ignores leading capitalized words (no false positive)", () => {
    expect(r.resolve("Jones et al. (2020)")).toEqual({ source_id: "jones2020", status: "resolved" });
  });
  it("ambiguous when two same-first-author+year and no coauthor cue", () => {
    expect(r.resolve("(Smith, 2021)").status).toBe("ambiguous");
  });
  it("disambiguates by coauthor surname", () => {
    expect(r.resolve("(Smith & Wong, 2021)")).toEqual({ source_id: "smith2021b", status: "resolved" });
  });
  it("unresolved on no match", () => {
    expect(r.resolve("(Brown, 1999)")).toEqual({ source_id: undefined, status: "unresolved" });
  });
});
```
- [ ] **Step 2:** `npm test -- citation.resolver` → FAIL.
- [ ] **Step 3: Implement**
```ts
import type { Source } from "../types.js";
export interface Resolution { source_id?: string; status: "resolved" | "unresolved" | "ambiguous"; }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (raw: string, surname: string) => surname.length > 0 && new RegExp(`\\b${esc(surname)}\\b`, "i").test(raw);

export class CitationResolver {
  constructor(private readonly sources: Source[], private readonly bibKeyToSourceId: Record<string, string> = {}) {}

  resolve(raw: string): Resolution {
    // 1) bibtex key(s): {a} or \cite{a,b}
    const braced = raw.match(/\{([^}]+)\}/)?.[1];
    if (braced) {
      const keys = braced.split(",").map((k) => k.trim());
      const hit = keys.find((k) => this.bibKeyToSourceId[k]);
      if (hit) return { source_id: this.bibKeyToSourceId[hit], status: "resolved" };
    }
    // 2) author-year: match against KNOWN source surnames (never an arbitrary capitalized word)
    const year = raw.match(/\b(?:19|20)\d{2}\b/)?.[0];
    if (year) {
      const sameYear = this.sources.filter((s) => s.year === year);
      const firstAuthorHits = sameYear.filter((s) => has(raw, s.authors[0] ?? ""));
      const pool = firstAuthorHits.length > 0 ? firstAuthorHits : sameYear.filter((s) => s.authors.some((a) => has(raw, a)));
      if (pool.length === 1) return { source_id: pool[0]?.id, status: "resolved" };
      if (pool.length > 1) {
        const byCo = pool.filter((s) => s.authors.slice(1).some((a) => has(raw, a)));
        if (byCo.length === 1) return { source_id: byCo[0]?.id, status: "resolved" };
        return { source_id: undefined, status: "ambiguous" };
      }
    }
    return { source_id: undefined, status: "unresolved" };
  }
}
```
- [ ] **Step 4:** `npm test -- citation.resolver` → PASS (5 tests).
- [ ] **Step 5: Commit** `git commit -am "feat(harness): CitationResolver (known-surname match, multi-key, coauthor disambig) (M0)"`

---

## Task 8: Demo corpus + freeze CLI

**Files:** Create `fixtures/corpus/*.txt` (6 toy sources), `fixtures/corpus/refs.bib`, `scripts/freeze.ts`, `fixtures/sources.lock.json`; Test `tests/corpus.freeze.test.ts`

- [ ] **Step 1:** Create 6 short `.txt` sources under `fixtures/corpus/` on the spec §15 topic (social media & adolescent mental health), each with a clear citable finding. **Mark them toy** in a header comment in `refs.bib`. Create `refs.bib` with one `@article{<basename>, author, year, title}` per file (keys = file basenames).
- [ ] **Step 2: Failing determinism test**
```ts
import { describe, it, expect } from "vitest";
import { assembleSources } from "../src/corpus/assemble.js";

describe("frozen corpus", () => {
  it("assembles 6 sources deterministically", () => {
    const a = assembleSources("fixtures/corpus");
    const b = assembleSources("fixtures/corpus");
    expect(a.sources).toHaveLength(6);
    expect(a).toEqual(b);
    for (const s of a.sources) expect(s.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```
- [ ] **Step 3:** `npm test -- corpus.freeze` → FAIL (until 6 files exist) then PASS once fixtures are in.
- [ ] **Step 4: `scripts/freeze.ts` (real CLI entry)**
```ts
import { writeSourcesLock } from "../src/corpus/assemble.js";
writeSourcesLock("fixtures/corpus", "fixtures/sources.lock.json");
console.log("wrote fixtures/sources.lock.json");
```
- [ ] **Step 5:** Generate the lockfile: `npm run freeze` → commits `fixtures/sources.lock.json`.
- [ ] **Step 6: Commit** `git commit -am "feat(harness): frozen toy demo corpus + sources.lock (M0)"`

---

## Task 9: Gold labels — structured schema, rubric, seed

**Files:** Create `src/eval/gold.ts`, `fixtures/gold_claims.jsonl`, `fixtures/ANNOTATION_RUBRIC.md`; Test `tests/eval.gold.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { loadGoldClaims } from "../src/eval/gold.js";

describe("loadGoldClaims", () => {
  it("loads >=20 labels with structured locator + raw_citation", () => {
    const gold = loadGoldClaims("fixtures/gold_claims.jsonl");
    expect(gold.length).toBeGreaterThanOrEqual(20);
    for (const g of gold) {
      expect(g.locator.source_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(g.locator.char_end).toBeGreaterThan(g.locator.char_start);
      expect(g.raw_citation.length).toBeGreaterThan(0);
    }
  });
});
```
- [ ] **Step 2:** `npm test -- eval.gold` → FAIL.
- [ ] **Step 3: Implement schema + loader**
```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
export const Locator = z.object({ source_id: z.string(), source_hash: z.string().regex(/^[0-9a-f]{64}$/), char_start: z.number().int().nonnegative(), char_end: z.number().int().positive(), section: z.string().optional() });
export const GoldLabel = z.object({
  claim_text: z.string().min(1), cited_source: z.string().min(1), raw_citation: z.string().min(1),
  snippet: z.string().min(1), locator: Locator,
  label: z.enum(["supports","weakly_supports","unsupported","contradicts","unclear"]),
  rationale: z.string().min(1), annotator: z.string().min(1), label_schema_version: z.string(),
});
export type GoldLabel = z.infer<typeof GoldLabel>;
export function loadGoldClaims(path: string): GoldLabel[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => GoldLabel.parse(JSON.parse(l)));
}
```
- [ ] **Step 4:** Author `fixtures/ANNOTATION_RUBRIC.md` (spec §6 four dims + the 3 worked examples) and `fixtures/gold_claims.jsonl` with ≥20 hand labels (use real char offsets into the Task-8 source texts + the frozen `source_hash` from `sources.lock.json`). Cover all five verdicts + overclaim (causality, scope, mentions-only). Example line:
```
{"claim_text":"Social media use causes adolescent depression.","cited_source":"twenge2018","raw_citation":"(Twenge, 2018)","snippet":"the study does not establish that social media use causes depression","locator":{"source_id":"twenge2018","source_hash":"<from sources.lock.json>","char_start":61,"char_end":131},"label":"unsupported","rationale":"correlation, not causation","annotator":"han","label_schema_version":"1.0"}
```
- [ ] **Step 5:** `npm test -- eval.gold` → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat(harness): gold schema (structured locator + raw_citation) + rubric + seed (M0)"`

---

## Task 10: Executable invariant lint (gates-over-memory)

**Files:** Create `src/lint/invariants.ts`; Test `tests/lint.invariants.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { runLint } from "../src/lint/invariants.js";

describe("runLint", () => {
  it("passes on the frozen corpus + gold (no errors)", () => {
    const issues = runLint("fixtures/corpus", "fixtures/gold_claims.jsonl");
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});
```
- [ ] **Step 2:** `npm test -- lint.invariants` → FAIL.
- [ ] **Step 3: Implement** (rule IDs → spec §; severity only error/warning)
```ts
import { canonicalize } from "../ingest/hash.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleSources } from "../corpus/assemble.js";
import { loadGoldClaims } from "../eval/gold.js";
import { VERDICTS } from "../types.js";

export interface LintIssue { ruleId: string; severity: "error" | "warning"; message: string; }

export function runLint(corpusDir: string, goldPath: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const { sources } = assembleSources(corpusDir);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const gold = loadGoldClaims(goldPath);

  // HARNESS-§9-GOLD-SOURCE-EXISTS: cited source + locator.source_id must exist in the registry
  for (const g of gold) {
    if (!byId.has(g.cited_source)) issues.push({ ruleId: "HARNESS-§9-GOLD-SOURCE-EXISTS", severity: "error", message: `gold cites unknown source ${g.cited_source}` });
  }
  // HARNESS-§9-SNIPPET-CONTAINED: snippet must appear in the cited source's canonical text
  for (const g of gold) {
    const src = byId.get(g.cited_source);
    if (src) {
      const text = canonicalize(readFileSync(join(corpusDir, `${src.citation_metadata.bibtex_key}.txt`), "utf8"));
      if (!text.includes(g.snippet)) issues.push({ ruleId: "HARNESS-§9-SNIPPET-CONTAINED", severity: "error", message: `snippet not found in ${g.cited_source}: "${g.snippet.slice(0, 40)}…"` });
      if (src.source_hash !== g.locator.source_hash) issues.push({ ruleId: "HARNESS-§9-LOCATOR-HASH", severity: "error", message: `gold locator source_hash mismatch for ${g.cited_source}` });
    }
  }
  // HARNESS-§9-LABEL-COVERAGE: seed set must exercise every verdict class (warning if not)
  const seen = new Set(gold.map((g) => g.label));
  for (const v of VERDICTS) if (!seen.has(v)) issues.push({ ruleId: "HARNESS-§9-LABEL-COVERAGE", severity: "warning", message: `seed gold has no "${v}" example` });

  return issues;
}

// CLI entry (npm run lint): exit non-zero on any error
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const issues = runLint("fixtures/corpus", "fixtures/gold_claims.jsonl");
  for (const i of issues) console.log(`[${i.severity}] ${i.ruleId}: ${i.message}`);
  if (issues.some((i) => i.severity === "error")) process.exit(1);
}
```
- [ ] **Step 4:** `npm test -- lint.invariants && npm run lint` → PASS / exit 0.
- [ ] **Step 5: Commit** `git commit -am "feat(harness): executable invariant lint (HARNESS-§ rules, gates-over-memory) (M0)"`

---

## Task 11: Governance — AGENTS.md + claim-check constitution + doc-sync set

**Files:** Create `AGENTS.md`, `constitutions/CLAIM_CHECK_CONSTITUTION.md`

- [ ] **Step 1: Write `AGENTS.md`** (<90s router + Red Lines; borrowed from MPhil pattern)
```markdown
# AGENTS.md — D-academic-agent Router

> Minimal cold-start contract. Operational detail lives in `constitutions/` and in executable lint (`src/lint/invariants.ts`).

## Red Lines (follow even if nothing else is read)
1. **Checker only sees the retrieved snippet.** Never let `check_claim` judge from model priors or surface similarity. (spec §6)
2. **Tools are pure; the runner persists.** `check_claim`/`search_*` return TraceEvents; only the run loop / CLI / eval runner writes JSONL. (spec §10/§11)
3. **Gold is human-labeled; never self-graded.** The model that generates a claim must not produce its own gold. (spec §9)
4. **Eval is seed/reporting-only.** Never present M1 metrics as an authoritative benchmark; no pass/fail threshold gates M0/M1. (spec §9/§15)
5. **Invariants are gates, not memory.** Run `npm run lint` (HARNESS-§ rules); a `ClaimCitationPair` is only formed via `makeClaimCitationPair()`.

## Constitution Router
| Domain | Open first |
|---|---|
| claim/citation verification | `constitutions/CLAIM_CHECK_CONSTITUTION.md` |
| invariant/lint rules | `src/lint/invariants.ts` + this file |

## Doc-sync consistency set (update together — never one alone)
- `Verdict` enum (`src/types.ts`) ↔ gold `label` enum (`src/eval/gold.ts`) ↔ `ANNOTATION_RUBRIC.md`.
- spec (`docs/…spec.md`) ↔ this plan ↔ code: a change to one requires reconciling the others.
- `fixtures/sources.lock.json` is regenerated via `npm run freeze` whenever corpus text changes.

## What this file is not
Not the spec, not the rule book. Detail belongs in the spec, the constitution, or the lint.
```
- [ ] **Step 2: Write `constitutions/CLAIM_CHECK_CONSTITUTION.md`** (proposition decomposition + anti-pattern list + snippet-only)
```markdown
# Claim-Check Constitution

> Scope: any operation that judges whether a citation supports a claim.

## Step 1 — Proposition decomposition
Reduce the cited sentence to one checkable proposition: "Does the cited source provide evidence for «X»?"

## Step 2 — Snippet-only judgment
Judge **only** from the retrieved snippet of the cited source. Never use model background knowledge.

## Reasons that DO NOT excuse a "supports" verdict
- "the citation already exists in the bibliography"
- "a nearby sentence cites it correctly"
- "the paper looks topically relevant"
- "it was verified in a previous session"
- "the snippet is semantically similar to the claim" (similarity ≠ support)

## Overclaim taxonomy (→ weakly_supports / unsupported)
- correlation reported, causation claimed
- local/sample finding stated as universal
- source only *mentions* the topic without supporting evidence
- scope creep (narrow result generalized)

## Counter-evidence is a separate field
`cited_source_support` (does the cited source support it?) and `corpus_counterevidence` (does the rest of the corpus contradict it?) are distinct outputs; never collapse them into one verdict.
```
- [ ] **Step 3: Commit** `git commit -am "docs(harness): AGENTS.md router + claim-check constitution + doc-sync set (M0)"`

---

## Task 12: Integration test — resolver resolves every gold citation

**Files:** Test `tests/integration.gold-resolves.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { assembleSources } from "../src/corpus/assemble.js";
import { CitationResolver } from "../src/citation/resolver.js";
import { loadGoldClaims } from "../src/eval/gold.js";

describe("gold citations resolve against the frozen corpus", () => {
  it("every gold raw_citation resolves to its cited_source", () => {
    const { sources, bibKeyToSourceId } = assembleSources("fixtures/corpus");
    const r = new CitationResolver(sources, bibKeyToSourceId);
    for (const g of loadGoldClaims("fixtures/gold_claims.jsonl")) {
      expect(r.resolve(g.raw_citation)).toEqual({ source_id: g.cited_source, status: "resolved" });
    }
  });
});
```
- [ ] **Step 2:** `npm test -- integration.gold-resolves` → FAIL if any gold citation is unresolvable.
- [ ] **Step 3:** Fix the gold `raw_citation` strings (or corpus author metadata) until all resolve. No code change expected if Tasks 6–9 are correct.
- [ ] **Step 4:** `npm test` (full suite) → PASS.
- [ ] **Step 5: Commit** `git commit -am "test(harness): integration — gold citations resolve against frozen corpus (M0)"`

---

## M0 Done — Acceptance (spec §15 M0)

- [ ] `npm test` green; `npm run typecheck` clean; `npm run lint` exit 0 (no `HARNESS-§` errors).
- [ ] `fixtures/sources.lock.json`: 6 sources with stable `source_hash` + `citation_metadata`.
- [ ] `fixtures/gold_claims.jsonl`: ≥20 labels, structured locators, `raw_citation`, all five verdicts + overclaim cases; `ANNOTATION_RUBRIC.md` present.
- [ ] Every gold `raw_citation` resolves to its `cited_source` (Task 12).
- [ ] `makeClaimCitationPair` enforces the §4 invariant in code (Task 2) and `runLint` enforces gold invariants (Task 10).
- [ ] `AGENTS.md` Red Lines + `CLAIM_CHECK_CONSTITUTION.md` present; corpus explicitly marked **toy seed** (no benchmark claims).

**Locked interfaces for M1:** `Source` (+citation_metadata), `sources.lock.json` registry, `Resolution`, `GoldLabel` (structured locator + raw_citation), `runLint`, `makeClaimCitationPair`, canonical text + offset-stable `source_hash`.

---

## Self-Review (plan author)

- **Spec coverage:** §4 (Source+citation_metadata, CitationMention span, ClaimCitationPair guard) → T2; offset-stable provenance → T3; assembly/registry → T6; §9 (structured gold + rubric + raw_citation + validation) → T9/T10; §14-M0 (corpus/gold/hashes/resolver) → T6–T9, T12. ✅
- **Codex M0 points:** citation_metadata ✓, invariant guard+test ✓, structured locator+snippet containment ✓, strict-index bugs guarded ✓, citation-js parser ✓, assembly task ✓, resolver false-positive/multi-key/coauthor ✓, offset-stable hash ✓, gold raw_citation+resolvable ✓, tsx/CLI/deps ✓, toy-corpus marked ✓. ✅
- **Placeholders:** none — every step has runnable code or concrete file content; only the human authoring (corpus text, gold labels) is inherently manual and is gated by executable tests/lint (T8–T10, T12).
- **Type consistency:** `Source`, `Resolution`, `GoldLabel`, `Locator`, `Verdict`, `makeClaimCitationPair`, `assembleSources`, `runLint` names/signatures consistent across T2/T6/T7/T9/T10/T12.
