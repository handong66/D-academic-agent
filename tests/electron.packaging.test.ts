import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron packaging invariants", () => {
  it("keeps native worker dependencies unpacked and rebuilds better-sqlite3 for Electron packaging", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: { package?: string };
      build?: { asarUnpack?: string[]; npmRebuild?: boolean };
    };
    const asarUnpack = pkg.build?.asarUnpack ?? [];
    const packageScript = pkg.scripts?.package ?? "";

    expect(pkg.build?.npmRebuild).toBe(false);
    expect(packageScript).toContain("electron-rebuild -v 42.4.1 -w better-sqlite3 --force");
    expect(packageScript).toContain("npm rebuild better-sqlite3");
    expect(asarUnpack).toContain("node_modules/better-sqlite3/build/Release/**");
    expect(asarUnpack).toContain("node_modules/onnxruntime-node/bin/**");
    expect(asarUnpack).toContain("node_modules/@img/**");
  });
});
