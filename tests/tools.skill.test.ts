import { describe, it, expect } from "vitest";
import { CITATION_AUDIT_SKILL } from "../src/tools/skill.js";

describe("CitationAuditSkill", () => {
  it("bundles the tool name + snippet-only system prompt + input schema", () => {
    expect(CITATION_AUDIT_SKILL.tool).toBe("check_claim");
    expect(CITATION_AUDIT_SKILL.system).toMatch(/snippet/i);
    expect(CITATION_AUDIT_SKILL.input.safeParse({ claim: "x", cited_source: "s" }).success).toBe(true);
  });
});
