import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMockContext } from "../src/cli-ctx.js";
import { handleAuditMessage, handleWorkerMessage } from "../src/app/protocol.js";

describe("handleAuditMessage", () => {
  it("answers an audit request with the matching id and a DraftAudit result", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: "req-1", type: "audit", draftText: "Linked to depression (Twenge, 2018)." }, ctx);
    expect(res.id).toBe("req-1");
    expect(res.type).toBe("audit_result");
    expect(res.type === "audit_result" && res.result.sentences.length).toBe(1);
  });

  it("returns an error response (not a throw) on a bad request", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: "x", type: "audit", draftText: null as unknown as string }, ctx);
    expect(res.type).toBe("error");
  });

  it("returns an error response for an unsupported message type", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: "req-type", type: "foo", draftText: "Text." }, ctx);
    expect(res).toEqual({
      id: "req-type",
      type: "error",
      message: "unsupported message type: foo",
    });
  });

  it("returns id unknown when the request id is missing", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ type: "audit", draftText: "Text." }, ctx);
    expect(res.id).toBe("unknown");
    expect(res.type).toBe("error");
    expect(res.type === "error" && res.message).toBe("id must be a string");
  });

  it("returns id unknown when the request id is not a string", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: 42, type: "audit", draftText: "Text." }, ctx);
    expect(res.id).toBe("unknown");
    expect(res.type).toBe("error");
    expect(res.type === "error" && res.message).toBe("id must be a string");
  });

  it("returns an error response for null input", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage(null, ctx);
    expect(res.id).toBe("unknown");
    expect(res.type).toBe("error");
    expect(res.type === "error" && res.message).toBe("message must be an object");
  });

  it("returns an error response for non-object input", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage(7, ctx);
    expect(res.id).toBe("unknown");
    expect(res.type).toBe("error");
    expect(res.type === "error" && res.message).toBe("message must be an object");
  });

  it("preserves a string id when returning a validation error", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleAuditMessage({ id: "req-draft", type: "audit", draftText: null }, ctx);
    expect(res).toEqual({
      id: "req-draft",
      type: "error",
      message: "draftText must be a string",
    });
  });
});

describe("handleWorkerMessage", () => {
  it("keeps audit requests back-compatible through the generic handler", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "req-audit", type: "audit", draftText: "Linked to depression (Twenge, 2018)." }, ctx);
    expect(res.id).toBe("req-audit");
    expect(res.type).toBe("audit_result");
    expect(res.type === "audit_result" && res.result.sentences.length).toBe(1);
  });

  it("lists source metadata without full text", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "req-sources", type: "list_sources" }, ctx);
    expect(res.id).toBe("req-sources");
    expect(res.type).toBe("sources");
    if (res.type !== "sources") throw new Error("expected sources response");
    expect(res.sources).toHaveLength(6);
    expect(res.sources[0]).toEqual({
      id: "keles2020",
      title: "A systematic review of social media use and depression, anxiety, and distress",
      year: "2020",
      type: "scholarly_article",
    });
  });

  it("runs the seed eval and returns gold metrics only in the eval response", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "req-eval", type: "run_eval" }, ctx);
    expect(res.id).toBe("req-eval");
    expect(res.type).toBe("eval_result");
    if (res.type !== "eval_result") throw new Error("expected eval_result response");
    expect(typeof res.result.macro_f1).toBe("number");
    expect(typeof res.result.answer_groundedness).toBe("number");
    expect(typeof res.result.policy_compliance.grounded_locator_rate).toBe("number");
    expect(typeof res.result.policy_compliance.snippet_only_rate).toBe("number");
    expect(typeof res.result.policy_compliance.outbound_chars).toBe("number");
    expect(Object.keys(res.result.per_class)).toHaveLength(5);
    expect(Array.isArray(res.result.failures)).toBe(true);
  });

  it("builds a project-local matrix and returns the directory", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "req-matrix", type: "build_matrix", outDir: "out/app-protocol-matrix-test" }, ctx);
    expect(res.id).toBe("req-matrix");
    expect(res.type).toBe("matrix");
    if (res.type !== "matrix") throw new Error("expected matrix response");
    expect(existsSync(join(res.dir, "matrix.md"))).toBe(true);
    expect(readFileSync(join(res.dir, "matrix.md"), "utf8")).toContain("keles2020");
  });

  it("returns absent for a nonexistent local model status request without network", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "missing-local-model", type: "model_status" }, ctx);
    expect(res).toEqual({ id: "missing-local-model", type: "model_status", status: "absent" });
  });

  it("emits plan_stage events for plan_and_check without changing the final response", async () => {
    const { ctx } = await buildMockContext();
    const emitted: Array<{ id: string; type: string; stage: string; detail: string }> = [];
    const res = await handleWorkerMessage(
      { id: "req-plan-stage", type: "plan_and_check", thesis: "social media use is associated with adolescent depression", judgeBudget: 2 },
      ctx,
      (event) => emitted.push(event as { id: string; type: string; stage: string; detail: string }),
    );

    expect(res.id).toBe("req-plan-stage");
    expect(res.type).toBe("plan_check_result");
    expect(emitted.map((event) => event.type)).toEqual(["plan_stage", "plan_stage", "plan_stage", "plan_stage", "plan_stage"]);
    expect(emitted.map((event) => event.stage)).toEqual(["plan", "retrieve", "judge", "judge", "report"]);
    expect(emitted.every((event) => event.id === "req-plan-stage")).toBe(true);
  });

  it("does not emit plan stages for plan_and_check validation errors", async () => {
    const { ctx } = await buildMockContext();
    const emitted: unknown[] = [];
    const res = await handleWorkerMessage({ id: "req-bad-plan-stage", type: "plan_and_check" }, ctx, (event) => emitted.push(event));

    expect(res).toEqual({
      id: "req-bad-plan-stage",
      type: "error",
      message: "thesis must be a string",
    });
    expect(emitted).toEqual([]);
  });

  it("does not emit plan stages for non-plan messages", async () => {
    const { ctx } = await buildMockContext();
    const emitted: unknown[] = [];
    const res = await handleWorkerMessage({ id: "req-sources-no-stage", type: "list_sources" }, ctx, (event) => emitted.push(event));

    expect(res.type).toBe("sources");
    expect(emitted).toEqual([]);
  });

  it("returns an error response when local model download fails before network", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "missing-local-model", type: "download_model" }, ctx);
    expect(res.id).toBe("missing-local-model");
    expect(res.type).toBe("error");
    expect(res.type === "error" && res.message).toMatch(/Unknown local model/);
  });

  it.skipIf(!process.env.M5_LIVE_EMBED)("downloads a local transformers model through the protocol", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "all-MiniLM-L6-v2", type: "download_model" }, ctx);
    expect(res).toEqual({ id: "all-MiniLM-L6-v2", type: "model_downloaded" });
  });

  it("returns an error response for an unsupported generic message type", async () => {
    const { ctx } = await buildMockContext();
    const res = await handleWorkerMessage({ id: "req-type", type: "foo" }, ctx);
    expect(res).toEqual({
      id: "req-type",
      type: "error",
      message: "unsupported message type: foo",
    });
  });
});
