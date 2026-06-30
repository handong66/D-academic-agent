/**
 * Env-gated live scite smoke. This hits the real scite API only when explicitly enabled with:
 * - SCITE_LIVE_TEST=1
 * - SCITE_CLIENT_ID
 * - SCITE_CLIENT_SECRET
 *
 * The smoke confirms the client-credentials token endpoint's real fields and whether the bearer
 * token also authorizes MCP search_literature for this account; MCP may require premium access.
 */
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { bearerAuth } from "../src/external/mcp-client.js";
import { resolveSciteBearerToken } from "../src/external/providers/scite-auth.js";
import { sciteSearchLiterature } from "../src/external/providers/scite-mcp.js";
import { createSciteRest } from "../src/external/providers/scite-rest.js";

const requiredEnv = ["SCITE_LIVE_TEST", "SCITE_CLIENT_ID", "SCITE_CLIENT_SECRET"] as const;
const missingEnv = requiredEnv.filter((name) => (name === "SCITE_LIVE_TEST" ? process.env[name] !== "1" : !process.env[name]));
const liveEnabled = missingEnv.length === 0;

if (!liveEnabled) {
  console.info(`Skipping live scite smoke; missing env vars: ${missingEnv.join(", ")}`);
}

describe.skipIf(!liveEnabled)("scite live adapter smoke", () => {
  it("exchanges client credentials, reads a real tally, and searches the real MCP endpoint", async () => {
    // C0 deferred the exact token-lifetime field (expires_in vs expire_in) to this live run — capture which
    // the server actually sends, without ever logging the token value (Codex milestone-C 🟡).
    const rawTokenResponse = await fetch("https://api.scite.ai/auth_token_users/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: process.env.SCITE_CLIENT_ID!, client_secret: process.env.SCITE_CLIENT_SECRET!, grant_type: "client_credentials" }),
    });
    expect(rawTokenResponse.ok).toBe(true);
    const rawTokenBody = (await rawTokenResponse.json()) as Record<string, unknown>;
    expect(Object.keys(rawTokenBody)).toContain("access_token");
    const lifetimeField = ["expires_in", "expire_in", "expiresIn"].find((key) => key in rawTokenBody);
    console.info(`scite token lifetime field: ${lifetimeField ?? "(none — 2h default)"}; non-secret keys: ${Object.keys(rawTokenBody).filter((key) => key !== "access_token").join(", ")}`);

    const token = await resolveSciteBearerToken(
      {
        clientId: process.env.SCITE_CLIENT_ID!,
        clientSecret: process.env.SCITE_CLIENT_SECRET!,
        baseURL: "https://api.scite.ai",
      },
      { fetch, now: Date.now },
    );

    expect(token.token.length).toBeGreaterThan(0);
    expect(token.expiresAt).toBeGreaterThan(Date.now());

    const rest = createSciteRest({ baseURL: "https://api.scite.ai", token: token.token }, { fetch });
    const tally = await rest.getTally("10.1371/journal.pone.0000308");

    expect(tally).toMatchObject({
      total: expect.any(Number),
      supporting: expect.any(Number),
      contradicting: expect.any(Number),
      mentioning: expect.any(Number),
      unclassified: expect.any(Number),
    });
    expect(tally.total).toBeGreaterThanOrEqual(0);
    if (tally.doi !== undefined) expect(tally.doi).toEqual(expect.any(String));
    if (tally.citingPublications !== undefined) expect(tally.citingPublications).toEqual(expect.any(Number));

    const auth = bearerAuth(token.token);
    const transport = new StreamableHTTPClientTransport(new URL("https://api.scite.ai/mcp"), {
      requestInit: { headers: auth.headers },
    });
    const papers = await sciteSearchLiterature({ query: "sleep and academic performance", limit: 3 }, { transport });

    expect(papers.length).toBeGreaterThanOrEqual(1);
    expect(papers[0]).toMatchObject({ provider: "scite", title: expect.any(String) });
  });
});
