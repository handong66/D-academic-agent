import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2] ?? "dir";
const validTargets = new Set(["dir", "arm64", "x64", "universal"]);

if (!validTargets.has(target)) {
  console.error(`Unknown macOS package target: ${target}`);
  console.error(`Expected one of: ${Array.from(validTargets).join(", ")}`);
  process.exit(1);
}

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const electronVersion = String(pkg.devDependencies?.electron ?? "").replace(/^[^\d]*/, "");
const productName = pkg.build?.productName ?? "D-academic-agent";

if (!electronVersion) {
  console.error("Could not infer Electron version from package.json devDependencies.electron");
  process.exit(1);
}

const env = {
  ...process.env,
  // Release builds are intentionally unsigned until Apple Developer ID credentials are configured.
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? "false",
};
let shouldRestoreHostNativeModules = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: options.quiet ? "ignore" : "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(" ")} exited with ${result.status ?? 1}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function restoreHostNativeModules() {
  if (process.env.SKIP_NATIVE_RESTORE === "1") return;
  run("npm", ["rebuild", "better-sqlite3"], { quiet: true });
}

function findAppDirs(dir, matches = []) {
  if (!existsSync(dir)) return matches;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      matches.push(child);
      continue;
    }
    if (entry.isDirectory()) findAppDirs(child, matches);
  }
  return matches;
}

function normalizeAppDir(arch) {
  const expected = join(root, "release", `mac-${arch}`, `${productName}.app`);
  const appDirs = findAppDirs(join(root, "release"));
  if (appDirs.length === 0) {
    throw new Error(`electron-builder did not produce a ${productName}.app directory for ${arch}`);
  }

  const source = appDirs
    .filter((appPath) => appPath.endsWith(`${productName}.app`))
    .filter((appPath) => appPath !== expected)
    .sort()
    .at(-1);

  if (!source) {
    if (existsSync(expected)) return;
    throw new Error(`Could not find ${productName}.app in release output for ${arch}`);
  }

  rmSync(expected, { force: true, recursive: true });
  mkdirSync(join(root, "release", `mac-${arch}`), { recursive: true });
  cpSync(source, expected, { recursive: true, verbatimSymlinks: true });
}

let exitCode = 0;

try {
  if (target === "universal") {
    run("node", ["scripts/make-mac-universal.mjs"]);
  } else {
    run("npm", ["run", "build:app"]);

    const rebuildArgs = ["--no-install", "electron-rebuild", "-v", electronVersion, "-w", "better-sqlite3", "--force"];
    const builderArgs = ["--no-install", "electron-builder", "--mac", target === "dir" ? "dir" : "zip"];

    if (target !== "dir") {
      rebuildArgs.push("--arch", target);
      builderArgs.push(`--${target}`);
    }

    shouldRestoreHostNativeModules = true;
    run("npx", rebuildArgs);
    run("npx", builderArgs);
    if (target !== "dir") normalizeAppDir(target);
  }
} finally {
  try {
    if (shouldRestoreHostNativeModules) restoreHostNativeModules();
  } catch (error) {
    exitCode = error.exitCode ?? 1;
  }
}

process.exit(exitCode);
