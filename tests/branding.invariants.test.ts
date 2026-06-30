import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function collectTextFiles(path: string): string[] {
  const entries = readdirSync(join(root, path));
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry);
    const normalized = child.replaceAll("\\", "/");
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "release" ||
      entry === "out" ||
      entry === ".opencode-plugin-codex"
    ) {
      continue;
    }
    const stat = statSync(join(root, child));
    if (stat.isDirectory()) {
      files.push(...collectTextFiles(child));
    } else if (
      /\.(?:cjs|css|html|js|json|jsonl|md|mjs|ts|tsx)$/i.test(entry) &&
      normalized !== "tests/branding.invariants.test.ts"
    ) {
      files.push(normalized);
    }
  }
  return files;
}

const oldPackageName = ["academic", "agent", "harness"].join("-");
const oldDisplayName = ["Academic", "Agent", "Harness"].join(" ");
const oldLowerDisplayName = ["academic", "agent", "harness"].join(" ");
const oldAppId = ["com", "handong", "academic-agent"].join(".");
const oldRepoName = ["deepseek", "agent", "harness"].join("-");
const oldRepoDisplay = ["DeepSeek", "Agent", "Harness"].join(" ");
const oldTempPrefix = ["academic", "agent"].join("-") + "-";
const oldAppClientName = ["academic", "agent", "app"].join("-");

function expectNoUndecoratedValue(text: string, path: string, value: string, label: string): void {
  const lowerText = text.toLowerCase();
  const lowerValue = value.toLowerCase();
  let from = 0;

  for (;;) {
    const index = lowerText.indexOf(lowerValue, from);
    if (index === -1) {
      return;
    }

    const prefix = lowerText.slice(Math.max(0, index - 2), index);
    expect(prefix, `${path} should not contain ${label}: ${value}`).toBe("d-");
    from = index + lowerValue.length;
  }
}

describe("D-academic-agent branding invariants", () => {
  it("uses D-academic-agent across package, Electron, renderer, and MCP identities", () => {
    const pkg = JSON.parse(read("package.json")) as { name: string; build: { appId: string; productName: string } };
    const lock = JSON.parse(read("package-lock.json")) as { name: string; packages: Record<string, { name?: string }> };

    expect(pkg.name).toBe("d-academic-agent");
    expect(pkg.build.appId).toBe("com.handong.d-academic-agent");
    expect(pkg.build.productName).toBe("D-academic-agent");
    expect(lock.name).toBe("d-academic-agent");
    expect(lock.packages[""]?.name).toBe("d-academic-agent");

    expect(read("electron/renderer/index.html")).toContain("<title>D-academic-agent</title>");
    expect(read("electron/main.ts")).toContain('title: "D-academic-agent"');
    expect(read("electron/renderer/i18n.dict.ts")).toContain('"nav.brand": { en: "D-academic-agent", zh: "D-academic-agent" }');
    expect(read("electron/renderer/App.tsx")).toContain('t("nav.brand")');
    expect(read("electron/renderer/styles/tokens.css")).toContain("D-academic-agent Reading Room");
    expect(read("src/mcp/server.ts")).toContain('name: "d-academic-agent"');
    expect(read("src/external/mcp-client.ts")).toContain("d-academic-agent-${providerCfg.id}");
  });

  it("keeps old active project identities out of current surfaces", () => {
    const currentSurfaceFiles = [
      "README.md",
      "AGENTS.md",
      "docs/CURRENT_STATE.md",
      "docs/2026-06-22-litreview-harness-spec.md",
      "assignment-aware-literature-review-agent.md",
      "package.json",
      "package-lock.json",
      "electron/SMOKE.md",
      "electron/main.ts",
      "electron/renderer/App.tsx",
      "electron/renderer/i18n.dict.ts",
      "electron/renderer/index.html",
      "electron/renderer/styles/tokens.css",
      "fixtures/external/scite/C0-contract-report.md",
      "src/mcp/server.ts",
      "src/external/mcp-client.ts",
    ];
    const rootSurfaceFiles = [".impeccable.md", "tsconfig.json", "vitest.config.ts", "docs/GOAL-M0-autonomous-run.md"];
    const activeTreeFiles = [
      ...collectTextFiles("src"),
      ...collectTextFiles("electron"),
      ...collectTextFiles("tests"),
      ...collectTextFiles("scripts"),
      ...collectTextFiles("constitutions"),
      ...collectTextFiles("fixtures"),
    ];
    const filesToScan = [...new Set([...currentSurfaceFiles, ...rootSurfaceFiles, ...activeTreeFiles])];
    const forbiddenExact = [oldDisplayName, oldLowerDisplayName, oldAppId, oldRepoName, oldRepoDisplay];

    for (const path of filesToScan) {
      const text = read(path);
      const lowerText = text.toLowerCase();
      for (const value of forbiddenExact) {
        expect(lowerText, `${path} should not contain ${value}`).not.toContain(value.toLowerCase());
      }
      expectNoUndecoratedValue(text, path, oldPackageName, "old package identifier");
      expectNoUndecoratedValue(text, path, oldTempPrefix, "old temp/client prefix");
      expectNoUndecoratedValue(text, path, oldAppClientName, "old external client identifier");
    }
  });

  it("keeps current executable snippets in historical plans aligned with the new machine identity", () => {
    const planSnippetFiles = [
      "docs/plans/2026-06-22-M0-corpus-and-resolver.md",
      "docs/plans/2026-06-22-M2-mcp-planner-dx.md",
      "docs/plans/2026-06-26-writing-desk-and-external-research-integrations.md",
    ];

    for (const path of planSnippetFiles) {
      const text = read(path);
      expectNoUndecoratedValue(text, path, oldPackageName, "old package/MCP identifier");
      expectNoUndecoratedValue(text, path, oldAppClientName, "old app client identifier");
    }
  });
});
