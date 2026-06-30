import { mkdir, stat } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("electron/dist", { recursive: true });
await mkdir("electron/renderer/dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["electron/main.ts"],
    outfile: "electron/dist/main.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2022",
    external: ["electron"],
  }),
  build({
    entryPoints: ["electron/preload.ts"],
    outfile: "electron/dist/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2022",
    external: ["electron"],
  }),
  build({
    entryPoints: ["electron/renderer/main.tsx"],
    outfile: "electron/renderer/dist/bundle.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    loader: {
      ".woff2": "dataurl",
      // Inline only the modern woff2 (Chromium picks it first); drop the legacy
      // woff/ttf/eot the Tabler icon @font-face also lists, to avoid duplicate bloat.
      ".woff": "empty",
      ".ttf": "empty",
      ".eot": "empty",
    },
  }),
  build({
    entryPoints: ["src/app/worker.ts"],
    outfile: "electron/dist/worker.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2022",
    external: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node", "electron"],
  }),
]);

async function logBuilt(path) {
  const { size } = await stat(path);
  console.log(`Built ${path} (${size.toLocaleString("en-US")} bytes)`);
}

await Promise.all([
  logBuilt("electron/dist/main.cjs"),
  logBuilt("electron/dist/preload.cjs"),
  logBuilt("electron/dist/worker.cjs"),
  logBuilt("electron/renderer/dist/bundle.js"),
  logBuilt("electron/renderer/dist/bundle.css"),
]);
