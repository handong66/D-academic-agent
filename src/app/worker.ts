import { createInterface } from "node:readline";
import { createWorkerRuntime } from "./worker-runtime.js";

async function main(): Promise<void> {
  const rt = await createWorkerRuntime({
    corpusDir: "fixtures/corpus",
    libraryPath: process.env.HARNESS_LIBRARY ?? "library.db",
    emit: (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`),
  });
  const lines = createInterface({ input: process.stdin });

  // Serialize line handling so a set_config rebuild fully completes before the next message —
  // a concurrent audit must never run against a half-swapped ctx (Codex M5a advisory).
  let chain: Promise<void> = Promise.resolve();
  lines.on("line", (line) => {
    chain = chain.then(async () => {
      process.stdout.write(`${await rt.handleLine(line)}\n`);
    });
  });
}

void main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    id: "worker-init",
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
});
