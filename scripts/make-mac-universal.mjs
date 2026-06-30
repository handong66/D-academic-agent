import { makeUniversalApp } from "@electron/universal";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const productName = pkg.build?.productName ?? "D-academic-agent";
const version = pkg.version;
const appName = `${productName}.app`;

const x64AppPath = resolve(root, "release", "mac-x64", appName);
const arm64AppPath = resolve(root, "release", "mac-arm64", appName);
const outAppPath = resolve(root, "release", "mac-universal", appName);
const outZipPath = resolve(root, "release", `${productName}-v${version}-mac-universal.zip`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? 1}\n${result.stderr ?? ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function requirePath(path) {
  if (!existsSync(path)) throw new Error(`Missing required universal build input: ${path}`);
}

function pruneOppositeDarwinBinaries(appPath, appArch) {
  const opposite = appArch === "x64" ? "arm64" : "x64";
  const unpacked = join(appPath, "Contents", "Resources", "app.asar.unpacked", "node_modules");

  for (const name of [`sharp-darwin-${opposite}`, `sharp-libvips-darwin-${opposite}`]) {
    rmSync(join(unpacked, "@img", name), { force: true, recursive: true });
  }

  const onnxDarwin = join(unpacked, "onnxruntime-node", "bin", "napi-v6", "darwin", opposite);
  rmSync(onnxDarwin, { force: true, recursive: true });
}

function assertExpectedDarwinBinaries(appPath, appArch) {
  const unpacked = join(appPath, "Contents", "Resources", "app.asar.unpacked", "node_modules");
  const requiredPaths = [
    join(unpacked, "@img", `sharp-darwin-${appArch}`),
    join(unpacked, "@img", `sharp-libvips-darwin-${appArch}`),
    join(unpacked, "onnxruntime-node", "bin", "napi-v6", "darwin", appArch),
  ];

  for (const path of requiredPaths) {
    requirePath(path);
  }
}

function assertUniversalBinary(path) {
  const output = run("lipo", ["-info", path], { capture: true });
  if (!output.includes("x86_64") || !output.includes("arm64")) {
    throw new Error(`Expected universal binary with x86_64 and arm64: ${path}\n${output}`);
  }
}

requirePath(x64AppPath);
requirePath(arm64AppPath);
pruneOppositeDarwinBinaries(x64AppPath, "x64");
pruneOppositeDarwinBinaries(arm64AppPath, "arm64");
assertExpectedDarwinBinaries(x64AppPath, "x64");
assertExpectedDarwinBinaries(arm64AppPath, "arm64");

rmSync(outAppPath, { force: true, recursive: true });
rmSync(outZipPath, { force: true });
mkdirSync(dirname(outAppPath), { recursive: true });

await makeUniversalApp({
  x64AppPath,
  arm64AppPath,
  outAppPath,
  mergeASARs: true,
  singleArchFiles: "{**/*.node,**/node_modules/@img/**,**/node_modules/onnxruntime-node/bin/**}",
});

assertUniversalBinary(join(outAppPath, "Contents", "MacOS", productName));
assertUniversalBinary(
  join(
    outAppPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  ),
);

run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", outAppPath, outZipPath]);
console.log(`Built ${outZipPath}`);
