import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ExternalProviderStatus } from "./types.js";
import { declaredCapabilities } from "./provider-registry.js";
import type { ExternalMcpProviderConfig } from "../providers/config.js";

export interface AuthTransportOptions {
  headers?: Record<string, string>;
}

export type AuthStrategy = () => AuthTransportOptions;

export class UnsupportedAuthError extends Error {
  constructor(strategy: string) {
    super(`${strategy} auth is deferred; live auth lands in C/D`);
    this.name = "UnsupportedAuthError";
  }
}

export const noneAuth: AuthStrategy = () => ({});

export function bearerAuth(token: string): AuthTransportOptions {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export function oauthPkceAuth(accessToken: string): AuthTransportOptions {
  return bearerAuth(accessToken);
}

export function sciteClientCredentialsAuth(): AuthTransportOptions {
  throw new UnsupportedAuthError("scite-client-credentials");
}

export interface ExternalMcpConnection {
  client?: Client;
  status: ExternalProviderStatus;
}

export interface ExternalMcpConnectionDeps {
  transport: Transport;
  secrets?: Record<string, string>;
}

export type ExternalToolCallResult = Awaited<ReturnType<Client["callTool"]>>;
type StreamableHttpAuthType = Extract<ExternalMcpProviderConfig["transport"], { kind: "streamable-http" }>["auth"]["type"];

function isDeferredAuthType(authType: StreamableHttpAuthType): boolean {
  return authType === "scite-client-credentials";
}

function secretValue(secrets: Record<string, string> | undefined, keyRef: string): string | undefined {
  const value = secrets?.[keyRef];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}

function providerStatus(providerCfg: ExternalMcpProviderConfig, connected: boolean, message?: string): ExternalProviderStatus {
  return {
    id: providerCfg.id,
    enabled: providerCfg.enabled,
    connected,
    capabilities: declaredCapabilities(providerCfg),
    ...(message === undefined ? {} : { message }),
  };
}

export async function connectExternalMcpProvider(
  providerCfg: ExternalMcpProviderConfig,
  deps: ExternalMcpConnectionDeps,
): Promise<ExternalMcpConnection> {
  if (providerCfg.transport.kind === "streamable-http" && providerCfg.transport.auth.type === "oauth-pkce") {
    // Gate only: a signed-in provider (access-token scalar present) falls through to connect; the bearer header itself
    // is applied by the transport builder via oauthPkceAuth (same as bearer auth). No token yet → deferred status.
    if (secretValue(deps.secrets, providerCfg.transport.auth.tokenKeyRef) === undefined) {
      return {
        status: providerStatus(providerCfg, false, "oauth-pkce auth is waiting for sign-in"),
      };
    }
  }

  if (providerCfg.transport.kind === "streamable-http" && isDeferredAuthType(providerCfg.transport.auth.type)) {
    const authType = providerCfg.transport.auth.type;
    return {
      status: providerStatus(providerCfg, false, `${authType} auth lands in C/D`),
    };
  }

  const client = new Client({ name: `d-academic-agent-${providerCfg.id}`, version: "0.0.0" }, { capabilities: {} });
  await client.connect(deps.transport);
  await client.listTools();

  return {
    client,
    status: providerStatus(providerCfg, true),
  };
}

export async function callAllowedExternalTool(
  client: Client,
  providerCfg: ExternalMcpProviderConfig,
  name: string,
  args?: Record<string, unknown>,
): Promise<ExternalToolCallResult> {
  if (!providerCfg.allowedTools.includes(name)) {
    throw new Error(`External tool "${name}" is not allowed for provider "${providerCfg.id}"`);
  }
  return client.callTool({ name, arguments: args });
}
