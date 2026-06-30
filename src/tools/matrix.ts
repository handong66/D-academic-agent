import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectLocal } from "./projectlocal.js";

// build_matrix (spec §11, writes-local): seed literature matrix; outDir must be project-local.
export interface MatrixRow { source_id: string; claim: string; verdict: string; quote: string; locator: string; }
export function buildLiteratureMatrix(rows: MatrixRow[], outDir: string): string {
  const dir = resolveProjectLocal(outDir);
  mkdirSync(dir, { recursive: true });
  const esc = (s: string) => s.replace(/\|/g, "/");
  const head = "| source | claim | verdict | quote | locator |\n|---|---|---|---|---|";
  const body = rows.map((r) => `| ${r.source_id} | ${esc(r.claim)} | ${r.verdict} | ${esc(r.quote).slice(0, 80)} | ${r.locator} |`).join("\n");
  writeFileSync(join(dir, "matrix.md"), `# Literature Matrix (seed)\n\n${head}\n${body}\n`);
  return dir;
}
