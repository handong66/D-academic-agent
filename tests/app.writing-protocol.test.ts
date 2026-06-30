import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleWorkerMessage } from "../src/app/protocol.js";
import { createWorkerRuntime } from "../src/app/worker-runtime.js";
import { buildMockContext } from "../src/cli-ctx.js";
import type { AppConfig } from "../src/providers/config.js";

const corpusDir = "fixtures/corpus";

function libraryPath(): string {
  const dir = join(tmpdir(), `d-academic-agent-writing-protocol-${randomUUID()}`);
  mkdirSync(dir);
  return join(dir, "library.db");
}

function validConfig(): AppConfig {
  return {
    embedder: { provider: "hash", dim: 256 },
    judge: { provider: "mock" },
    pdf: { provider: "unpdf" },
    corpus: corpusDir,
    externalResearch: { mcpProviders: [], httpProviders: [] },
  };
}

describe("writing protocol", () => {
  it("round-trips analyze_paragraph as a writing_report", async () => {
    const { ctx } = await buildMockContext();

    const res = await handleWorkerMessage(
      { id: "p1", type: "analyze_paragraph", paragraph: "Climate change accelerates glacial retreat." },
      ctx,
    );

    expect(res.id).toBe("p1");
    expect(res.type).toBe("writing_report");
    if (res.type !== "writing_report") throw new Error("expected writing_report response");
    expect(res.report.input).toBe("Climate change accelerates glacial retreat.");
    expect(Array.isArray(res.report.claims)).toBe(true);
    expect(res.report.claims.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.report.paragraphSummary)).toContain("needs_citation");
  });

  it("#7 redacts configured secrets from serialized analyze_paragraph runtime output", async () => {
    const secret = "sk-MOCKKEY123";
    const path = libraryPath();
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: path });
    await rt.handleLine(
      JSON.stringify({
        id: "set-secret",
        type: "set_config",
        config: validConfig(),
        secrets: { "openai-compatible": secret },
      }),
    );

    const line = await rt.handleLine(
      JSON.stringify({
        id: "p-secret",
        type: "analyze_paragraph",
        paragraph: `Climate change accelerates glacial retreat. ${secret}`,
      }),
    );

    expect(line).not.toContain(secret);
    expect(line).toContain("***");
    const parsed = JSON.parse(line) as { id: string; type: string; report?: { input?: string } };
    expect(parsed.id).toBe("p-secret");
    expect(parsed.type).toBe("writing_report");
    expect(parsed.report?.input).toContain("***");
  });

  it("keeps the existing audit handler behavior unchanged", async () => {
    const { ctx } = await buildMockContext();

    const res = await handleWorkerMessage({ id: "audit-regression", type: "audit", draftText: "Linked to depression (Twenge, 2018)." }, ctx);

    expect(res.id).toBe("audit-regression");
    expect(res.type).toBe("audit_result");
    if (res.type !== "audit_result") throw new Error("expected audit_result response");
    expect(res.result.sentences.length).toBe(1);
  });

  it("rejects an empty/whitespace paragraph at the validation boundary (pinned contract)", async () => {
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: libraryPath() });
    // contract: empty input is an explicit validation error (not an empty report); the UI also disables submit on empty.
    const line = await rt.handleLine(JSON.stringify({ id: "p-empty", type: "analyze_paragraph", paragraph: "   " }));
    const parsed = JSON.parse(line) as { id: string; type: string; message?: string };
    expect(parsed.id).toBe("p-empty");
    expect(parsed.type).toBe("error");
    expect(parsed.message).toMatch(/non-empty/i);
  });
});
