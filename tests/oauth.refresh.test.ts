import { describe, expect, it } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { resolveOAuthAccessToken } from "../electron/oauth/resolve-access-token.js";
import { parseOAuthState, serializeOAuthState } from "../electron/oauth/keychain-oauth-provider.js";
import { InMemoryKeyStore } from "../src/providers/keystore.js";
import type { ExternalMcpProviderConfig } from "../src/providers/config.js";

const issuer = "https://auth.example/";
const tokenKeyRef = "CONSENSUS_OAUTH_TOKEN";

const clientInformation: OAuthClientInformationFull = {
  client_id: "stored-client",
  redirect_uris: ["http://127.0.0.1:49152/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: "search",
};

const providerCfg: ExternalMcpProviderConfig = {
  id: "consensus",
  label: "Consensus MCP",
  enabled: true,
  allowedTools: ["search"],
  capabilities: ["paper_search"],
  transport: {
    kind: "streamable-http",
    url: issuer,
    auth: {
      type: "oauth-pkce",
      scopes: ["search"],
      tokenKeyRef,
    },
  },
};

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OAuth access-token resolver", () => {
  it("returns the current access token without refreshing when it is not expired", async () => {
    const store = new InMemoryKeyStore();
    const calls: FetchCall[] = [];
    await store.set(
      tokenKeyRef,
      serializeOAuthState({
        tokens: {
          access_token: "current-access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          expires_at: 1_700_003_600,
        },
        clientInformation,
      }),
    );

    await expect(
      resolveOAuthAccessToken(store, providerCfg, {
        now: () => 1_700_000_000_000,
        fetchFn: async (input, init) => {
          calls.push({ url: String(input), init });
          return jsonResponse({ error: "unexpected refresh" }, 500);
        },
      }),
    ).resolves.toBe("current-access-token");
    expect(calls).toEqual([]);
  });

  it("refreshes an expired token with the SDK flow, persists the new blob, and returns only the new access token", async () => {
    const store = new InMemoryKeyStore();
    const calls: FetchCall[] = [];
    await store.set(
      tokenKeyRef,
      serializeOAuthState({
        tokens: {
          access_token: "expired-access-token",
          refresh_token: "old-refresh-token",
          token_type: "Bearer",
          expires_at: 1_699_999_999,
        },
        clientInformation,
      }),
    );

    const accessToken = await resolveOAuthAccessToken(store, providerCfg, {
      now: () => 1_700_000_000_000,
      fetchFn: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });

        if (url === new URL("/.well-known/oauth-authorization-server", issuer).href) {
          return jsonResponse({
            issuer,
            authorization_endpoint: new URL("/authorize", issuer).href,
            token_endpoint: new URL("/token", issuer).href,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
          });
        }

        if (url === new URL("/token", issuer).href) {
          const params = new URLSearchParams(String(init?.body ?? ""));
          expect(params.get("grant_type")).toBe("refresh_token");
          expect(params.get("refresh_token")).toBe("old-refresh-token");
          expect(params.get("client_id")).toBe("stored-client");
          return jsonResponse({
            access_token: "new-access-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        return jsonResponse({ error: "unexpected URL" }, 404);
      },
    });

    expect(accessToken).toBe("new-access-token");
    expect(calls.map((call) => call.url)).toEqual([
      new URL("/.well-known/oauth-authorization-server", issuer).href,
      new URL("/token", issuer).href,
    ]);

    const refreshed = parseOAuthState(await store.get(tokenKeyRef));
    expect(refreshed.tokens).toEqual({
      access_token: "new-access-token",
      refresh_token: "old-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      expires_at: 1_700_003_600,
    });
    expect(refreshed.clientInformation).toEqual(clientInformation);
  });

  it("does not hand off an expired token when no refresh token is available", async () => {
    const store = new InMemoryKeyStore();
    const calls: FetchCall[] = [];
    await store.set(
      tokenKeyRef,
      serializeOAuthState({
        tokens: {
          access_token: "expired-access-token",
          token_type: "Bearer",
          expires_at: 1_699_999_999,
        },
        clientInformation,
      }),
    );

    await expect(
      resolveOAuthAccessToken(store, providerCfg, {
        now: () => 1_700_000_000_000,
        fetchFn: async (input, init) => {
          calls.push({ url: String(input), init });
          return jsonResponse({ error: "unexpected refresh" }, 500);
        },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});
