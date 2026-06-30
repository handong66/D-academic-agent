import {
  discoverAuthorizationServerMetadata,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata, OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export type OAuthSignInErrorCode = "metadata_unavailable" | "dcr_unavailable" | "state_mismatch" | "timeout";

export class OAuthSignInError extends Error {
  readonly code: OAuthSignInErrorCode;

  constructor(code: OAuthSignInErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthSignInError";
    this.code = code;
  }
}

export interface OAuthRedirectResult {
  code: string;
  state: string;
}

export interface OAuthSignInDeps {
  fetchFn: FetchLike;
  captureRedirect: (authorizeUrl: URL) => Promise<OAuthRedirectResult>;
  timeoutMs?: number;
}

export type OAuthSignInProvider = OAuthClientProvider & {
  resource?: string;
};

export interface OAuthSignInResult {
  ok: true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OAuthSignInError("timeout", "OAuth sign-in timed out"));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resourceUrl(resource: string | undefined): URL | undefined {
  if (resource === undefined) return undefined;
  try {
    return new URL(resource);
  } catch {
    return undefined;
  }
}

async function ensureClientInformation(
  authorizationServerUrl: string | URL,
  provider: OAuthSignInProvider,
  metadata: AuthorizationServerMetadata | undefined,
  fetchFn: FetchLike,
): Promise<OAuthClientInformationMixed> {
  const existing = await provider.clientInformation();
  if (existing !== undefined) return existing;

  if (metadata !== undefined && metadata.registration_endpoint === undefined) {
    throw new OAuthSignInError(
      "dcr_unavailable",
      "OAuth dynamic client registration is unavailable; configure a pre-registered clientIdKeyRef for this provider",
    );
  }

  const registered = await registerClient(authorizationServerUrl, {
    metadata,
    clientMetadata: provider.clientMetadata,
    scope: provider.clientMetadata.scope,
    fetchFn,
  });
  await provider.saveClientInformation?.(registered);
  return registered;
}

async function runSignIn(
  serverUrl: string | URL,
  provider: OAuthSignInProvider,
  deps: OAuthSignInDeps,
): Promise<OAuthSignInResult> {
  const metadata = await discoverAuthorizationServerMetadata(serverUrl, { fetchFn: deps.fetchFn });
  if (metadata === undefined) {
    throw new OAuthSignInError("metadata_unavailable", "OAuth authorization server metadata is unavailable");
  }

  const clientInformation = await ensureClientInformation(serverUrl, provider, metadata, deps.fetchFn);
  const expectedState = provider.state === undefined ? undefined : await provider.state();
  const redirectUrl = provider.redirectUrl;
  if (redirectUrl === undefined) throw new Error("OAuth redirectUrl is required for authorization-code sign-in");

  const { authorizationUrl, codeVerifier } = await startAuthorization(serverUrl, {
    metadata,
    clientInformation,
    redirectUrl,
    scope: provider.clientMetadata.scope,
    state: expectedState,
    resource: resourceUrl(provider.resource),
  });

  await provider.saveCodeVerifier(codeVerifier);
  await provider.redirectToAuthorization(authorizationUrl);

  const redirected = await deps.captureRedirect(authorizationUrl);
  if (expectedState !== undefined && redirected.state !== expectedState) {
    throw new OAuthSignInError("state_mismatch", "OAuth state mismatch");
  }

  const tokens = await exchangeAuthorization(serverUrl, {
    metadata,
    clientInformation,
    authorizationCode: redirected.code,
    codeVerifier: await provider.codeVerifier(),
    redirectUri: redirectUrl,
    resource: resourceUrl(provider.resource),
    addClientAuthentication: provider.addClientAuthentication,
    fetchFn: deps.fetchFn,
  });

  await provider.saveTokens(tokens);
  return { ok: true };
}

export function signInWithOAuth(
  serverUrl: string | URL,
  provider: OAuthSignInProvider,
  deps: OAuthSignInDeps,
): Promise<OAuthSignInResult> {
  return withTimeout(runSignIn(serverUrl, provider, deps), deps.timeoutMs);
}
