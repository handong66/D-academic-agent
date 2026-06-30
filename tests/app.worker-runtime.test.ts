import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkerRuntime, redactSecrets } from "../src/app/worker-runtime.js";
import { defaultConfig, type AppConfig } from "../src/providers/config.js";

const corpusDir = "fixtures/corpus";

function parseLine(line: string): any {
  return JSON.parse(line);
}

function libraryPath(): string {
  const dir = join(tmpdir(), `d-academic-agent-worker-runtime-${randomUUID()}`);
  mkdirSync(dir);
  return join(dir, "library.db");
}

function runtime() {
  const path = libraryPath();
  return { path, rt: createWorkerRuntime({ corpusDir, libraryPath: path }) };
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

describe("WorkerRuntime", () => {
  it("returns the default nested config", async () => {
    const { path, rt: runtimePromise } = runtime();
    const rt = await runtimePromise;

    const res = parseLine(await rt.handleLine(JSON.stringify({ id: "cfg-1", type: "get_config" })));

    expect(res).toEqual({ id: "cfg-1", type: "config", config: { ...defaultConfig, corpus: corpusDir, library: path } }); // corpus reflects the real corpusDir, not defaultConfig's "./corpus" placeholder
  });

  it("applies a valid config and continues handling audit requests", async () => {
    const rt = await runtime().rt;

    const applied = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "set-1",
          type: "set_config",
          config: validConfig(),
          secrets: {},
        }),
      ),
    );
    const audit = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "audit-1",
          type: "audit",
          draftText: "Linked to depression (Twenge, 2018).",
        }),
      ),
    );

    expect(applied).toEqual({ id: "set-1", type: "config_applied" });
    expect(audit.id).toBe("audit-1");
    expect(audit.type).toBe("audit_result");
    expect(audit.result.sentences.length).toBe(1);
  });

  it("does not echo set_config secrets in response JSON", async () => {
    const rt = await runtime().rt;
    const secret = "sk-LEAK-DO-NOT-PRINT";

    const line = await rt.handleLine(
      JSON.stringify({
        id: "set-secret",
        type: "set_config",
        config: validConfig(),
        secrets: { "openai-compatible": secret },
      }),
    );

    expect(line).not.toContain(secret);
    expect(parseLine(line)).toEqual({ id: "set-secret", type: "config_applied" });
  });

  it("returns a scrubbed error for bad config and keeps the previous context usable", async () => {
    const rt = await runtime().rt;
    const previousConfig = validConfig();
    await rt.handleLine(JSON.stringify({ id: "set-good", type: "set_config", config: previousConfig, secrets: {} }));

    const badPayload = {
      id: "set-bad",
      type: "set_config",
      config: {
        embedder: { provider: "nonexistent" },
        judge: { provider: "mock" },
        pdf: { provider: "unpdf" },
        corpus: corpusDir,
      },
      secrets: { "openai-compatible": "sk-LEAK-DO-NOT-PRINT" },
    };

    const errorLine = await rt.handleLine(JSON.stringify(badPayload));
    const error = parseLine(errorLine);
    const config = parseLine(await rt.handleLine(JSON.stringify({ id: "cfg-after-bad", type: "get_config" })));
    const audit = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "audit-after-bad",
          type: "audit",
          draftText: "Linked to depression (Twenge, 2018).",
        }),
      ),
    );

    expect(error.type).toBe("error");
    expect(error.id).toBe("set-bad");
    expect(error.message).toBe("set_config failed: invalid config");
    expect(errorLine).not.toContain("sk-LEAK-DO-NOT-PRINT");
    expect(errorLine).not.toContain("nonexistent");
    expect(config).toEqual({ id: "cfg-after-bad", type: "config", config: previousConfig });
    expect(audit.id).toBe("audit-after-bad");
    expect(audit.type).toBe("audit_result");
    expect(audit.result.sentences.length).toBe(1);
  });

  it("get_config returns a corpus that set_config (Settings Apply) can rebuild from", async () => {
    const rt = await runtime().rt;
    const cfg = parseLine(await rt.handleLine(JSON.stringify({ id: "g", type: "get_config" }))).config;
    expect(cfg.corpus).toBe(corpusDir); // not "./corpus" — the dir actually exists
    const applied = parseLine(await rt.handleLine(JSON.stringify({ id: "s", type: "set_config", config: cfg, secrets: {} })));
    expect(applied).toEqual({ id: "s", type: "config_applied" }); // round-trip Apply works (was the blocker: ENOENT on "./corpus")
  });

  it("emits plan stages through RuntimeOptions.emit while returning the final response line", async () => {
    const emitted: Array<{ id: string; type: string; stage: string; detail: string }> = [];
    const path = libraryPath();
    const rt = await createWorkerRuntime({
      corpusDir,
      libraryPath: path,
      emit: (event) => emitted.push(event as { id: string; type: string; stage: string; detail: string }),
    });

    const final = parseLine(
      await rt.handleLine(
        JSON.stringify({
          id: "runtime-plan-stage",
          type: "plan_and_check",
          thesis: "social media use is associated with adolescent depression",
          judgeBudget: 2,
        }),
      ),
    );

    expect(final).toMatchObject({ id: "runtime-plan-stage", type: "plan_check_result" });
    expect(emitted.map((event) => event.stage)).toEqual(["plan", "retrieve", "judge", "judge", "report"]);
    expect(emitted.every((event) => event.type === "plan_stage" && event.id === "runtime-plan-stage")).toBe(true);
  });

  it("does not emit intermediate events for malformed JSON", async () => {
    const emitted: unknown[] = [];
    const path = libraryPath();
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: path, emit: (event) => emitted.push(event) });

    const res = parseLine(await rt.handleLine("not-json"));

    expect(res.type).toBe("error");
    expect(emitted).toEqual([]);
  });

  it("does not emit intermediate events for runtime-local get_config", async () => {
    const emitted: unknown[] = [];
    const path = libraryPath();
    const rt = await createWorkerRuntime({ corpusDir, libraryPath: path, emit: (event) => emitted.push(event) });

    const res = parseLine(await rt.handleLine(JSON.stringify({ id: "cfg-no-stage", type: "get_config" })));

    expect(res.type).toBe("config");
    expect(emitted).toEqual([]);
  });

  it("redactSecrets scrubs any known key value that surfaces in a downstream response", () => {
    const secret = "sk-LEAK-DO-NOT-PRINT";
    const leaked = JSON.stringify({ id: "x", type: "error", message: `401 Unauthorized for key ${secret}` });

    const scrubbed = redactSecrets(leaked, { "openai-compatible": secret });

    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain("***");
    expect(redactSecrets(leaked, {})).toBe(leaked); // no secrets configured → passthrough
  });
});
