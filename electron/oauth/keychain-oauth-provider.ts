import { randomBytes } from "node:crypto";
import type { OAuthClientInformationFull, OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { KeyStore } from "../../src/providers/keystore.js";

export interface OAuthStateBlob {
  tokens?: OAuthStoredTokens;
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
  state?: string;
}

export type OAuthStoredTokens = OAuthTokens & {
  expires_at?: number;
};

export interface PreRegisteredOAuthClient {
  clientId: string;
  clientSecret?: string;
}

export interface KeychainOAuthProviderOptions {
  keystore: KeyStore;
  tokenKeyRef: string;
  redirectUrl: string;
  scopes: string[];
  resource?: string;
  openAuthorizationUrl: (url: URL) => void | Promise<void>;
  preRegisteredClient?: PreRegisteredOAuthClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function parseTokens(value: unknown): OAuthStoredTokens | undefined {
  const record = objectField(value);
  const accessToken = stringField(record?.access_token);
  const tokenType = stringField(record?.token_type);
  if (record === undefined || accessToken === undefined || tokenType === undefined) return undefined;
  return {
    access_token: accessToken,
    token_type: tokenType,
    ...(stringField(record.id_token) === undefined ? {} : { id_token: stringField(record.id_token) }),
    ...(typeof record.expires_in === "number" ? { expires_in: record.expires_in } : {}),
    ...(typeof record.expires_at === "number" ? { expires_at: record.expires_at } : {}),
    ...(stringField(record.scope) === undefined ? {} : { scope: stringField(record.scope) }),
    ...(stringField(record.refresh_token) === undefined ? {} : { refresh_token: stringField(record.refresh_token) }),
  };
}

function parseClientInformation(value: unknown): OAuthClientInformationFull | undefined {
  const record = objectField(value);
  const clientId = stringField(record?.client_id);
  const redirectUris = Array.isArray(record?.redirect_uris) ? record.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  const responseTypes = Array.isArray(record?.response_types) ? record.response_types.filter((item): item is string => typeof item === "string") : [];
  if (record === undefined || clientId === undefined || redirectUris.length === 0 || responseTypes.length === 0) return undefined;
  const grantTypes = Array.isArray(record.grant_types) ? record.grant_types.filter((item): item is string => typeof item === "string") : undefined;
  return {
    client_id: clientId,
    redirect_uris: redirectUris,
    response_types: responseTypes,
    ...(stringField(record.client_secret) === undefined ? {} : { client_secret: stringField(record.client_secret) }),
    ...(typeof record.client_id_issued_at === "number" ? { client_id_issued_at: record.client_id_issued_at } : {}),
    ...(typeof record.client_secret_expires_at === "number" ? { client_secret_expires_at: record.client_secret_expires_at } : {}),
    ...(stringField(record.token_endpoint_auth_method) === undefined ? {} : { token_endpoint_auth_method: stringField(record.token_endpoint_auth_method) }),
    ...(grantTypes === undefined ? {} : { grant_types: grantTypes }),
    ...(stringField(record.client_name) === undefined ? {} : { client_name: stringField(record.client_name) }),
    ...(stringField(record.client_uri) === undefined ? {} : { client_uri: stringField(record.client_uri) }),
    ...(stringField(record.logo_uri) === undefined ? {} : { logo_uri: stringField(record.logo_uri) }),
    ...(stringField(record.scope) === undefined ? {} : { scope: stringField(record.scope) }),
    ...(Array.isArray(record.contacts) ? { contacts: record.contacts.filter((item): item is string => typeof item === "string") } : {}),
    ...(stringField(record.tos_uri) === undefined ? {} : { tos_uri: stringField(record.tos_uri) }),
    ...(stringField(record.policy_uri) === undefined ? {} : { policy_uri: stringField(record.policy_uri) }),
    ...(stringField(record.jwks_uri) === undefined ? {} : { jwks_uri: stringField(record.jwks_uri) }),
    ...(record.jwks === undefined ? {} : { jwks: record.jwks }),
    ...(stringField(record.software_id) === undefined ? {} : { software_id: stringField(record.software_id) }),
    ...(stringField(record.software_version) === undefined ? {} : { software_version: stringField(record.software_version) }),
    ...(stringField(record.software_statement) === undefined ? {} : { software_statement: stringField(record.software_statement) }),
  };
}

export function serializeOAuthState(state: OAuthStateBlob): string {
  return JSON.stringify(state);
}

export function tokensWithExpiry(tokens: OAuthTokens, nowMs = Date.now()): OAuthStoredTokens {
  if (tokens.expires_in === undefined) return tokens;
  return {
    ...tokens,
    expires_at: Math.floor(nowMs / 1000) + Math.max(0, Math.floor(tokens.expires_in)),
  };
}

export function parseOAuthState(raw: string | undefined): OAuthStateBlob {
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    return {
      ...(parseTokens(parsed.tokens) === undefined ? {} : { tokens: parseTokens(parsed.tokens) }),
      ...(parseClientInformation(parsed.clientInformation) === undefined ? {} : { clientInformation: parseClientInformation(parsed.clientInformation) }),
      ...(stringField(parsed.codeVerifier) === undefined ? {} : { codeVerifier: stringField(parsed.codeVerifier) }),
      ...(stringField(parsed.state) === undefined ? {} : { state: stringField(parsed.state) }),
    };
  } catch {
    return {};
  }
}

export async function readAccessToken(keystore: KeyStore, tokenKeyRef: string): Promise<string | undefined> {
  return parseOAuthState(await keystore.get(tokenKeyRef)).tokens?.access_token;
}

export class KeychainOAuthProvider implements OAuthClientProvider {
  private readonly keystore: KeyStore;
  private readonly tokenKeyRef: string;
  private readonly redirectUrlValue: string;
  private readonly scopes: string[];
  private readonly openAuthorizationUrl: (url: URL) => void | Promise<void>;
  private readonly preRegisteredClient?: PreRegisteredOAuthClient;
  readonly resource?: string;

  constructor(options: KeychainOAuthProviderOptions) {
    this.keystore = options.keystore;
    this.tokenKeyRef = options.tokenKeyRef;
    this.redirectUrlValue = options.redirectUrl;
    this.scopes = options.scopes;
    this.resource = options.resource;
    this.openAuthorizationUrl = options.openAuthorizationUrl;
    this.preRegisteredClient = options.preRegisteredClient;
  }

  get redirectUrl(): string {
    return this.redirectUrlValue;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: this.preRegisteredClient?.clientSecret ? "client_secret_post" : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: this.scopes.join(" "),
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.preRegisteredClient !== undefined) {
      return {
        client_id: this.preRegisteredClient.clientId,
        ...(this.preRegisteredClient.clientSecret === undefined ? {} : { client_secret: this.preRegisteredClient.clientSecret }),
      };
    }
    return (await this.readState()).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.updateState({
      clientInformation: {
        ...this.clientMetadata,
        ...clientInformation,
      },
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.readState()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.updateState({ tokens: tokensWithExpiry(tokens) });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.openAuthorizationUrl(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.updateState({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (await this.readState()).codeVerifier;
    if (codeVerifier === undefined) throw new Error("OAuth code verifier is not available");
    return codeVerifier;
  }

  async state(): Promise<string> {
    const existing = (await this.readState()).state;
    if (existing !== undefined) return existing;
    const generated = randomBytes(32).toString("base64url");
    await this.updateState({ state: generated });
    return generated;
  }

  private async readState(): Promise<OAuthStateBlob> {
    return parseOAuthState(await this.keystore.get(this.tokenKeyRef));
  }

  private async updateState(update: OAuthStateBlob): Promise<void> {
    const current = await this.readState();
    await this.keystore.set(this.tokenKeyRef, serializeOAuthState({ ...current, ...update }));
  }
}
