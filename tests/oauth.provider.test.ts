import { describe, expect, it } from "vitest";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  KeychainOAuthProvider,
  parseOAuthState,
  readAccessToken,
  serializeOAuthState,
} from "../electron/oauth/keychain-oauth-provider.js";
import { InMemoryKeyStore } from "../src/providers/keystore.js";

const redirectUrl = "http://127.0.0.1:49152/callback";

function provider(store = new InMemoryKeyStore()): KeychainOAuthProvider {
  return new KeychainOAuthProvider({
    keystore: store,
    tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
    redirectUrl,
    scopes: ["search", "offline_access"],
    openAuthorizationUrl: async () => undefined,
  });
}

describe("OAuth keychain provider state", () => {
  it("round-trips OAuth state and tolerates absent or garbage input as empty state", () => {
    const tokens: OAuthTokens = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "search",
    };
    const clientInformation: OAuthClientInformationFull = {
      client_id: "client-id",
      client_secret: "client-secret",
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "search",
    };

    const serialized = serializeOAuthState({
      tokens,
      clientInformation,
      codeVerifier: "verifier",
      state: "state",
    });

    expect(parseOAuthState(serialized)).toEqual({
      tokens,
      clientInformation,
      codeVerifier: "verifier",
      state: "state",
    });
    expect(parseOAuthState(undefined)).toEqual({});
    expect(parseOAuthState("not json")).toEqual({});
    expect(parseOAuthState(JSON.stringify(["not", "an", "object"]))).toEqual({});
  });

  it("persists tokens, client information, code verifier, and generated state through the keystore blob", async () => {
    const store = new InMemoryKeyStore();
    const oauthProvider = provider(store);
    const tokens: OAuthTokens = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
    };
    const clientInformation: OAuthClientInformationFull = {
      client_id: "registered-client",
      client_secret: "registered-secret",
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "search offline_access",
    };

    await oauthProvider.saveTokens(tokens);
    await oauthProvider.saveClientInformation(clientInformation);
    await oauthProvider.saveCodeVerifier("code-verifier");
    const state = await oauthProvider.state();

    expect(await oauthProvider.tokens()).toEqual(tokens);
    expect(await oauthProvider.clientInformation()).toEqual(clientInformation);
    expect(await oauthProvider.codeVerifier()).toBe("code-verifier");
    expect(await oauthProvider.state()).toBe(state);

    const raw = await store.get("CONSENSUS_OAUTH_TOKEN");
    expect(raw).toBeDefined();
    expect(parseOAuthState(raw)).toEqual({
      tokens,
      clientInformation,
      codeVerifier: "code-verifier",
      state,
    });
  });

  it("prefers an injected pre-registered client over saved dynamic client information", async () => {
    const store = new InMemoryKeyStore();
    const oauthProvider = new KeychainOAuthProvider({
      keystore: store,
      tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
      redirectUrl,
      scopes: ["search"],
      openAuthorizationUrl: async () => undefined,
      preRegisteredClient: {
        clientId: "pre-registered-client",
        clientSecret: "pre-registered-secret",
      },
    });
    await oauthProvider.saveClientInformation({
      client_id: "dynamic-client",
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "search",
    });

    expect(await oauthProvider.clientInformation()).toEqual({
      client_id: "pre-registered-client",
      client_secret: "pre-registered-secret",
    });
  });

  it("extracts only the access token scalar from a stored OAuth blob", async () => {
    const store = new InMemoryKeyStore();
    await provider(store).saveTokens({
      access_token: "access-token-only",
      refresh_token: "refresh-token-that-stays-in-main",
      token_type: "Bearer",
    });

    expect(await readAccessToken(store, "CONSENSUS_OAUTH_TOKEN")).toBe("access-token-only");
    expect(await readAccessToken(store, "MISSING")).toBeUndefined();
    await store.set("GARBAGE", "{");
    expect(await readAccessToken(store, "GARBAGE")).toBeUndefined();
  });

  it("calls the injected authorization opener without importing Electron", async () => {
    const opened: string[] = [];
    const oauthProvider = new KeychainOAuthProvider({
      keystore: new InMemoryKeyStore(),
      tokenKeyRef: "CONSENSUS_OAUTH_TOKEN",
      redirectUrl,
      scopes: ["search"],
      openAuthorizationUrl: async (url) => {
        opened.push(String(url));
      },
    });

    await oauthProvider.redirectToAuthorization(new URL("https://auth.example/authorize?client_id=x"));

    expect(opened).toEqual(["https://auth.example/authorize?client_id=x"]);
  });
});
