import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
