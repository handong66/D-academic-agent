import {
  discoverAuthorizationServerMetadata,
  refreshAuthorization,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ExternalMcpProviderConfig } from "../../src/providers/config.js";
import type { KeyStore } from "../../src/providers/keystore.js";
import {
  parseOAuthState,
  readAccessToken,
  serializeOAuthState,
  tokensWithExpiry,
  type OAuthStateBlob,
  type OAuthStoredTokens,
} from "./keychain-oauth-provider.js";

const DEFAULT_EXPIRY_SKEW_MS = 60_000;

export interface ResolveOAuthAccessTokenDeps {
  fetchFn: FetchLike;
  now?: () => number;
  expirySkewMs?: number;
  discoverAuthorizationServerMetadataFn?: typeof discoverAuthorizationServerMetadata;
  refreshAuthorizationFn?: typeof refreshAuthorization;
  addClientAuthentication?: OAuthClientProvider["addClientAuthentication"];
}

function resourceUrl(resource: string | undefined): URL | undefined {
  if (resource === undefined) return undefined;
  try {
    return new URL(resource);
  } catch {
    return undefined;
  }
}

function expiresAtMs(expiresAt: number): number {
  return expiresAt > 1_000_000_000_000 ? expiresAt : expiresAt * 1000;
}

function isExpired(tokens: OAuthStoredTokens, nowMs: number, skewMs: number): boolean {
  if (tokens.expires_at !== undefined) return expiresAtMs(tokens.expires_at) <= nowMs + skewMs;
  if (tokens.expires_in !== undefined) return tokens.expires_in <= Math.ceil(skewMs / 1000);
  return false;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

async function clientInformation(
  keystore: KeyStore,
  providerCfg: ExternalMcpProviderConfig,
  state: OAuthStateBlob,
): Promise<OAuthClientInformationMixed | undefined> {
  if (state.clientInformation !== undefined) return state.clientInformation;
  if (providerCfg.transport.kind !== "streamable-http" || providerCfg.transport.auth.type !== "oauth-pkce") return undefined;

  const auth = providerCfg.transport.auth;
  const clientId = auth.clientIdKeyRef === undefined ? undefined : nonEmpty(await keystore.get(auth.clientIdKeyRef));
  if (clientId === undefined) return undefined;

  const clientSecret = auth.clientSecretKeyRef === undefined ? undefined : nonEmpty(await keystore.get(auth.clientSecretKeyRef));
  return {
    client_id: clientId,
    ...(clientSecret === undefined ? {} : { client_secret: clientSecret }),
  };
}

export async function resolveOAuthAccessToken(
  keystore: KeyStore,
  providerCfg: ExternalMcpProviderConfig,
  deps: ResolveOAuthAccessTokenDeps,
): Promise<string | undefined> {
  if (providerCfg.transport.kind !== "streamable-http" || providerCfg.transport.auth.type !== "oauth-pkce") return undefined;

  const auth = providerCfg.transport.auth;
  const state = parseOAuthState(await keystore.get(auth.tokenKeyRef));
  const tokens = state.tokens;
  if (tokens?.access_token === undefined) return undefined;

  const nowMs = deps.now?.() ?? Date.now();
  const skewMs = deps.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
  if (!isExpired(tokens, nowMs, skewMs)) return readAccessToken(keystore, auth.tokenKeyRef);
  if (tokens.refresh_token === undefined) return undefined;

  const refreshedClientInformation = await clientInformation(keystore, providerCfg, state);
  if (refreshedClientInformation === undefined) return undefined;

  const discover = deps.discoverAuthorizationServerMetadataFn ?? discoverAuthorizationServerMetadata;
  const refresh = deps.refreshAuthorizationFn ?? refreshAuthorization;
  const metadata = await discover(providerCfg.transport.url, { fetchFn: deps.fetchFn });
  const refreshed = await refresh(providerCfg.transport.url, {
    metadata,
    clientInformation: refreshedClientInformation,
    refreshToken: tokens.refresh_token,
    resource: resourceUrl(auth.resource),
    addClientAuthentication: deps.addClientAuthentication,
    fetchFn: deps.fetchFn,
  });

  const refreshedTokens = tokensWithExpiry(refreshed, nowMs);
  await keystore.set(
    auth.tokenKeyRef,
    serializeOAuthState({
      ...state,
      tokens: refreshedTokens,
    }),
  );
  return readAccessToken(keystore, auth.tokenKeyRef);
}
