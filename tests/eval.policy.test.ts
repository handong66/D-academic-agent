import { describe, expect, it } from "vitest";
import { POLICY_MAX_SNIPPET_CHARS, policyCompliance } from "../src/eval/policy.js";
import type { TraceEvent } from "../src/trace/trace.js";
import type { Verdict } from "../src/types.js";

function result(verdict: Verdict, source_hash: string): { verdict: Verdict; source_hash: string } {
  return { verdict, source_hash };
}

function trace(outbound_snippets: string[]): TraceEvent {
  return {
    schema_version: "1.0",
    event_type: "judge_cited",
    step: 0,
    ts: "2026-06-23T00:00:00.000Z",
    model_id: "test-model",
    prompt_version: "test",
    source_hashes: [],
    input_hash: "input",
    output_hash: "output",
    outbound_snippets,
  };
}

describe("policyCompliance", () => {
  it("reports full grounded locator rate when decisive verdicts carry source hashes", () => {
    const metric = policyCompliance([result("supports", "source-a"), result("unsupported", "source-b")], []);

    expect(metric.grounded_locator_rate).toBe(1);
  });

  it("penalizes decisive verdicts with an empty source hash", () => {
    const metric = policyCompliance([result("supports", "source-a"), result("contradicts", "")], []);

    expect(metric.grounded_locator_rate).toBeLessThan(1);
  });

  it("penalizes outbound snippets longer than the policy maximum", () => {
    const metric = policyCompliance(
      [result("unclear", "")],
      [trace(["x".repeat(POLICY_MAX_SNIPPET_CHARS + 1)])],
    );

    expect(metric.snippet_only_rate).toBeLessThan(1);
  });

  it("sums outbound snippet characters", () => {
    const metric = policyCompliance([result("unclear", "")], [trace(["abc", "de"]), trace(["f"])]);

    expect(metric.outbound_chars).toBe(6);
  });

  it("treats all-unclear results as vacuously grounded", () => {
    const metric = policyCompliance([result("unclear", ""), result("unclear", "")], []);

    expect(metric.grounded_locator_rate).toBe(1);
  });

  it("handles fully empty results and traces (vacuously compliant, zero outbound)", () => {
    const metric = policyCompliance([], []);

    expect(metric).toEqual({ grounded_locator_rate: 1, snippet_only_rate: 1, outbound_chars: 0 });
  });
});
