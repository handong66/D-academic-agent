import { z } from "zod";

export interface SciteClientCredentials {
  clientId: string;
  clientSecret: string;
  baseURL: string;
}

export interface ResolvedSciteBearerToken {
  token: string;
  expiresAt: number;
}

export interface SciteAuthDeps {
  fetch: FetchLike;
  now: () => number;
}

export interface SciteTokenCache {
  getToken: () => Promise<string>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().positive().optional(),
    expire_in: z.number().positive().optional(),
  })
  .passthrough();

function endpoint(baseURL: string, path: string): string {
  return new URL(path.replace(/^\//, ""), baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
}

function expiryFromResponse(parsed: z.infer<typeof TokenResponseSchema>, now: number): number {
  if (parsed.expires_in !== undefined) {
    return now + parsed.expires_in * 1000;
  }

  // C0 captured an OpenAPI prose example using expire_in. Treat large values as epoch seconds.
  if (parsed.expire_in !== undefined) {
    return parsed.expire_in > 10_000_000 ? parsed.expire_in * 1000 : now + parsed.expire_in * 1000;
  }

  return now + DEFAULT_TOKEN_TTL_MS;
}

export async function resolveSciteBearerToken(
  creds: SciteClientCredentials,
  deps: SciteAuthDeps,
): Promise<ResolvedSciteBearerToken> {
  const response = await deps.fetch(endpoint(creds.baseURL, "/auth_token_users/token"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    throw new Error(`Scite token request failed with HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Scite token response was not valid JSON");
  }

  const parsed = TokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Scite token response was malformed: missing access_token");
  }

  return {
    token: parsed.data.access_token,
    expiresAt: expiryFromResponse(parsed.data, deps.now()),
  };
}

export function createSciteTokenCache(creds: SciteClientCredentials, deps: SciteAuthDeps): SciteTokenCache {
  let cached: ResolvedSciteBearerToken | undefined;
  let inFlight: Promise<ResolvedSciteBearerToken> | undefined;

  async function refresh(): Promise<ResolvedSciteBearerToken> {
    if (inFlight !== undefined) return inFlight;
    inFlight = resolveSciteBearerToken(creds, deps).finally(() => {
      inFlight = undefined;
    });
    cached = await inFlight;
    return cached;
  }

  return {
    async getToken(): Promise<string> {
      if (cached !== undefined && deps.now() < cached.expiresAt - TOKEN_REFRESH_SKEW_MS) {
        return cached.token;
      }
      return (await refresh()).token;
    },
  };
}
