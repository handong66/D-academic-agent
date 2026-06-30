import { describe, expect, it } from "vitest";
import { createSciteTokenCache, resolveSciteBearerToken } from "../src/external/providers/scite-auth.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("scite client-credentials auth", () => {
  it("fetches and parses a bearer token without reading any global secret state", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init });
      return jsonResponse({ access_token: "token-123", expires_in: 3600, token_type: "bearer" });
    };

    const result = await resolveSciteBearerToken(
      { clientId: "client-1", clientSecret: "secret-1", baseURL: "https://api.scite.ai/" },
      { fetch, now: () => 1_000 },
    );

    expect(result).toEqual({ token: "token-123", expiresAt: 3_601_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.scite.ai/auth_token_users/token");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      client_id: "client-1",
      client_secret: "secret-1",
      grant_type: "client_credentials",
    });
  });

  it("caches tokens inside the validity window and refreshes once past expiry minus 60s", async () => {
    let now = 0;
    let issued = 0;
    const fetch = async (): Promise<Response> => {
      issued += 1;
      return jsonResponse({ access_token: `token-${issued}`, expires_in: 120 });
    };
    const cache = createSciteTokenCache(
      { clientId: "client-1", clientSecret: "secret-1", baseURL: "https://api.scite.ai" },
      { fetch, now: () => now },
    );

    await expect(cache.getToken()).resolves.toBe("token-1");
    now = 59_999;
    await expect(cache.getToken()).resolves.toBe("token-1");
    now = 60_001;
    await expect(cache.getToken()).resolves.toBe("token-2");
    await expect(cache.getToken()).resolves.toBe("token-2");
    expect(issued).toBe(2);
  });

  it("redacts token-exchange failures so client secrets and response bodies are not echoed", async () => {
    const fetch = async (): Promise<Response> =>
      new Response("401 for secret-should-not-leak", { status: 401, statusText: "Unauthorized" });

    let error: Error | undefined;
    try {
      await resolveSciteBearerToken(
        { clientId: "client-1", clientSecret: "secret-should-not-leak", baseURL: "https://api.scite.ai" },
        { fetch, now: () => 0 },
      );
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/401/);
    expect(error!.message).not.toContain("secret-should-not-leak");
    expect(error!.message).not.toContain("401 for");
  });
});
