import { resolve, relative, isAbsolute } from "node:path";

// Writes-local boundary (spec §11): writes-local tools may only write under the project root.
const ROOT = process.cwd();

export function resolveProjectLocal(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`writes-local: path must be project-local, got "${p}"`);
  return abs;
}
