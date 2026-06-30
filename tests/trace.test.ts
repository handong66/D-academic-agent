import { describe, it, expect } from "vitest";
import { Tracer } from "../src/trace/trace.js";

describe("Tracer", () => {
  it("emits the §10 typed schema; tools never persist", () => {
    const t = new Tracer({ model_id: "mock", prompt_version: "p1" });
    t.add({ event_type: "retrieve", input: { q: "x" }, output: { ids: ["a"] }, source_hashes: ["h"], retrieval: [{ bm25_rank: 1, vector_distance: 0.1, rrf_score: 0.2, final_rank: 1 }] });
    const [e] = t.drain();
    expect(e!.schema_version).toBe("1.0");
    expect(e!.step).toBe(0);
    expect(e!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e!.retrieval?.[0]?.final_rank).toBe(1);
    expect(t.drain()).toHaveLength(0);
  });
});
