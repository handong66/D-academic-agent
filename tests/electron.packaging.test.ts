import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron packaging invariants", () => {
  it("keeps native worker dependencies unpacked and rebuilds better-sqlite3 for Electron packaging", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      build?: {
        artifactName?: string;
        asarUnpack?: string[];
        mac?: { mergeASARs?: boolean; singleArchFiles?: string; target?: string[] };
        npmRebuild?: boolean;
      };
    };
    const asarUnpack = pkg.build?.asarUnpack ?? [];
    const packageScript = pkg.scripts?.package ?? "";
    const packageHelper = readFileSync(join(process.cwd(), "scripts", "package-mac.mjs"), "utf8");
    const universalHelper = readFileSync(join(process.cwd(), "scripts", "make-mac-universal.mjs"), "utf8");

    expect(pkg.build?.npmRebuild).toBe(false);
    expect(packageScript).toBe("node scripts/package-mac.mjs dir");
    expect(pkg.scripts?.["package:mac:arm64"]).toBe("node scripts/package-mac.mjs arm64");
    expect(pkg.scripts?.["package:mac:x64"]).toBe("node scripts/package-mac.mjs x64");
    expect(pkg.scripts?.["package:mac:universal"]).toBe("node scripts/package-mac.mjs universal");
    expect(packageHelper).toContain('"electron-rebuild"');
    expect(packageHelper).toContain('"--arch"');
    expect(packageHelper).toContain('"npm", ["rebuild", "better-sqlite3"]');
    expect(packageHelper).toContain("shouldRestoreHostNativeModules");
    expect(packageHelper).toContain("scripts/make-mac-universal.mjs");
    expect(universalHelper).toContain('from "@electron/universal"');
    expect(universalHelper).toContain("makeUniversalApp");
    expect(universalHelper).toContain("singleArchFiles");
    expect(universalHelper).toContain("assertExpectedDarwinBinaries");
    expect(universalHelper).toContain("sharp-darwin-${appArch}");
    expect(universalHelper).toContain("sharp-libvips-darwin-${appArch}");
    expect(universalHelper).toContain("onnxruntime-node");
    expect(universalHelper).toContain("assertUniversalBinary");
    expect(pkg.build?.artifactName).toBe("${productName}-v${version}-${os}-${arch}.${ext}");
    expect(pkg.build?.mac?.mergeASARs).toBe(true);
    expect(pkg.build?.mac?.singleArchFiles).toBe("**/*.node");
    expect(pkg.build?.mac?.target).toContain("dir");
    expect(asarUnpack).toContain("node_modules/better-sqlite3/build/Release/**");
    expect(asarUnpack).toContain("node_modules/onnxruntime-node/bin/**");
    expect(asarUnpack).toContain("node_modules/@img/**");
  });

  it("publishes tagged macOS arm64, x64, and universal release assets from CI", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "release.yml"), "utf8");

    expect(workflow).toContain('tags:');
    expect(workflow).toContain('"v*.*.*"');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("package:mac:arm64");
    expect(workflow).toContain("package:mac:x64");
    expect(workflow).toContain("package:mac:universal");
    expect(workflow).toContain("mac-app-arm64");
    expect(workflow).toContain("mac-app-x64");
    expect(workflow).toContain("build-mac-universal");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("macos-15-intel");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("SHA256SUMS.txt");
  });
});
