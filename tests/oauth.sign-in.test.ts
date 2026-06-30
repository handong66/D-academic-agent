import { describe, expect, it } from "vitest";
import { KeychainOAuthProvider, readAccessToken } from "../electron/oauth/keychain-oauth-provider.js";
import { OAuthSignInError, signInWithOAuth } from "../electron/oauth/sign-in.js";
import { InMemoryKeyStore } from "../src/providers/keystore.js";

const issuer = "https://auth.example/";
const serverUrl = issuer;
const redirectUrl = "http://127.0.0.1:49152/callback";

interface FakeServerOptions {
  dcr?: boolean;
}

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

function fakeAuthorizationServer(options: FakeServerOptions = {}): {
  calls: FetchCall[];
  fetchFn: (input: string | URL, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  const metadata = {
    issuer,
    authorization_endpoint: new URL("/authorize", issuer).href,
    token_endpoint: new URL("/token", issuer).href,
    ...(options.dcr === false ? {} : { registration_endpoint: new URL("/register", issuer).href }),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
  };

  return {
    calls,
    fetchFn: async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, init });

      if (url === new URL("/.well-known/oauth-authorization-server", issuer).href) {
        return jsonResponse(metadata);
      }

      if (url === new URL("/register", issuer).href) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({
          ...body,
          client_id: "registered-client",
          client_secret: "registered-secret",
          client_id_issued_at: 1,
          client_secret_expires_at: 0,
        });
      }

      if (url === new URL("/token", issuer).href) {
        const params = new URLSearchParams(String(init?.body ?? ""));
        if (params.get("grant_type") !== "authorization_code") return jsonResponse({ error: "unsupported_grant_type" }, 400);
        if (params.get("code") !== "authorization-code") return jsonResponse({ error: "invalid_grant" }, 400);
        if (!params.get("code_verifier")) return jsonResponse({ error: "invalid_request" }, 400);
        if (params.get("redirect_uri") !== redirectUrl) return jsonResponse({ error: "invalid_request" }, 400);
        return jsonResponse({
          access_token: "saved-access-token",
          refresh_token: "saved-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "search",
        });
      }

      return jsonResponse({ error: "unexpected URL" }, 404);
    },
  };
}

function provider(options: { preRegistered?: boolean; opened?: string[] } = {}): {
  keystore: InMemoryKeyStore;
  provider: KeychainOAuthProvider;
} {
  const keystore = new InMemoryKeyStore();
  return {
    keystore,
    provider: new KeychainOAuthProvider({
      keystore,
      tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
      redirectUrl,
      scopes: ["search"],
      openAuthorizationUrl: async (url) => {
        options.opened?.push(String(url));
      },
      ...(options.preRegistered
        ? {
            preRegisteredClient: {
              clientId: "pre-registered-client",
              clientSecret: "pre-registered-secret",
            },
          }
        : {}),
    }),
  };
}

describe("OAuth sign-in orchestration", () => {
  it("discovers metadata, dynamically registers, captures a redirect, exchanges the code, and saves tokens", async () => {
    const fakeServer = fakeAuthorizationServer();
    const opened: string[] = [];
    const { keystore, provider: oauthProvider } = provider({ opened });

    await expect(
      signInWithOAuth(serverUrl, oauthProvider, {
        fetchFn: fakeServer.fetchFn,
        captureRedirect: async (authorizationUrl) => ({
          code: "authorization-code",
          state: authorizationUrl.searchParams.get("state") ?? "",
        }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(opened).toHaveLength(1);
    const authorizeUrl = new URL(opened[0]!);
    expect(authorizeUrl.searchParams.get("client_id")).toBe("registered-client");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("scope")).toBe("search");
    expect(authorizeUrl.searchParams.get("state")).toBeTruthy();
    expect(await readAccessToken(keystore, "CONSENSUS_OAUTH_TOKEN")).toBe("saved-access-token");
    expect(fakeServer.calls.map((call) => call.url)).toContain(new URL("/register", issuer).href);
    expect(fakeServer.calls.map((call) => call.url)).toContain(new URL("/token", issuer).href);
  });

  it("rejects when the returned redirect state does not match the provider state", async () => {
    const fakeServer = fakeAuthorizationServer();
    const { keystore, provider: oauthProvider } = provider();

    await expect(
      signInWithOAuth(serverUrl, oauthProvider, {
        fetchFn: fakeServer.fetchFn,
        captureRedirect: async () => ({ code: "authorization-code", state: "wrong-state" }),
      }),
    ).rejects.toThrow(/OAuth state mismatch/);

    expect(await readAccessToken(keystore, "CONSENSUS_OAUTH_TOKEN")).toBeUndefined();
  });

  it("rejects clearly when DCR is unavailable and no pre-registered client was injected", async () => {
    const fakeServer = fakeAuthorizationServer({ dcr: false });
    const { provider: oauthProvider } = provider();

    await expect(
      signInWithOAuth(serverUrl, oauthProvider, {
        fetchFn: fakeServer.fetchFn,
        captureRedirect: async () => ({ code: "authorization-code", state: "unused" }),
      }),
    ).rejects.toThrow(/pre-registered clientIdKeyRef/i);
  });

  it("succeeds without DCR when a pre-registered client has been injected from key refs", async () => {
    const fakeServer = fakeAuthorizationServer({ dcr: false });
    const { keystore, provider: oauthProvider } = provider({ preRegistered: true });

    await expect(
      signInWithOAuth(serverUrl, oauthProvider, {
        fetchFn: fakeServer.fetchFn,
        captureRedirect: async (authorizationUrl) => ({
          code: "authorization-code",
          state: authorizationUrl.searchParams.get("state") ?? "",
        }),
      }),
    ).resolves.toEqual({ ok: true });

    expect(await readAccessToken(keystore, "CONSENSUS_OAUTH_TOKEN")).toBe("saved-access-token");
    expect(fakeServer.calls.map((call) => call.url)).not.toContain(new URL("/register", issuer).href);
  });

  it("rejects with a typed timeout error when redirect capture does not finish", async () => {
    const fakeServer = fakeAuthorizationServer();
    const { provider: oauthProvider } = provider();

    await expect(
      signInWithOAuth(serverUrl, oauthProvider, {
        fetchFn: fakeServer.fetchFn,
        captureRedirect: async () => new Promise(() => undefined),
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      name: "OAuthSignInError",
      code: "timeout",
    } satisfies Partial<OAuthSignInError>);
  });
});
