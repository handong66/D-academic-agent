import { describe, expect, it } from "vitest";
import { bearerAuth, noneAuth } from "../src/external/mcp-client.js";

describe("external MCP auth strategies", () => {
  it("builds bearer Authorization headers without touching a transport", () => {
    expect(bearerAuth("token-123")).toEqual({ headers: { Authorization: "Bearer token-123" } });
  });

  it("builds empty options for no auth", () => {
    expect(noneAuth()).toEqual({});
  });
});
