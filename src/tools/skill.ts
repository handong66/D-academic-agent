import { CheckInput } from "./tools.js";

// Portable skill bundle (spec §17): a named tool + snippet-only system prompt, reusable by MCP/app/CLI.
export const CITATION_AUDIT_SKILL = {
  name: "citation_audit",
  tool: "check_claim",
  input: CheckInput,
  system: "Judge whether a CITED SOURCE SNIPPET supports a CLAIM, using only the snippet (see constitutions/CLAIM_CHECK_CONSTITUTION.md). Output verdict + locator + suggested_rewrite.",
} as const;
