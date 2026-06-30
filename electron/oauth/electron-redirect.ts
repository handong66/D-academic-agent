import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { BrowserWindow } from "electron";
import type { OAuthRedirectResult } from "./sign-in.js";

const DEFAULT_REDIRECT_TIMEOUT_MS = 120_000;
const CALLBACK_PATH = "/callback";

export type OAuthRedirectErrorCode =
  | "redirect_timeout"
  | "redirect_window_closed"
  | "redirect_invalid_callback"
  | "redirect_already_used"
  | "redirect_disposed";

export class OAuthRedirectError extends Error {
  readonly code: OAuthRedirectErrorCode;

  constructor(code: OAuthRedirectErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthRedirectError";
    this.code = code;
  }
}

export interface ElectronRedirectCapture {
  redirectUrl: string;
  captureRedirect: (authorizeUrl: URL) => Promise<OAuthRedirectResult>;
  dispose: () => void;
}

export interface ElectronRedirectCaptureDeps {
  timeoutMs?: number;
  createWindow?: () => BrowserWindow;
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(address);
        return;
      }
      reject(new Error("OAuth redirect server did not expose a TCP address"));
    });
  });
}

function respondHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>OAuth</title><p>${body}</p>`);
}

function defaultWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 520,
    height: 720,
    title: "Sign in",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

export async function createElectronRedirectCapture(deps: ElectronRedirectCaptureDeps = {}): Promise<ElectronRedirectCapture> {
  let redirectUrl = "";
  let used = false;
  let settled = false;
  let window: BrowserWindow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let serverClosed = false;
  let settle:
    | {
        resolve: (result: OAuthRedirectResult) => void;
        reject: (error: Error) => void;
      }
    | undefined;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === undefined || redirectUrl.length === 0) {
      respondHtml(response, 400, "Invalid OAuth redirect.");
      return;
    }

    const callbackUrl = new URL(request.url, redirectUrl);
    if (callbackUrl.pathname !== CALLBACK_PATH) {
      respondHtml(response, 404, "Not found.");
      return;
    }

    if (settled || settle === undefined) {
      respondHtml(response, 200, "OAuth sign-in has already been handled. You can close this window.");
      return;
    }

    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    if (code === null || state === null) {
      respondHtml(response, 400, "OAuth redirect was missing required fields. You can close this window.");
      cleanup(new OAuthRedirectError("redirect_invalid_callback", "OAuth redirect was missing required fields"));
      return;
    }

    respondHtml(response, 200, "You can close this window.");
    settle?.resolve({ code, state });
    cleanup();
  });

  function cleanup(error?: Error): void {
    if (!settled && settle !== undefined && error !== undefined) {
      settle.reject(error);
    }
    settled = true;
    settle = undefined;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (window !== undefined && !window.isDestroyed()) {
      window.close();
    }
    window = undefined;
    if (!serverClosed) {
      serverClosed = true;
      server.close();
    }
  }

  const address = await listen(server);
  redirectUrl = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;

  return {
    redirectUrl,
    captureRedirect: async (authorizeUrl: URL): Promise<OAuthRedirectResult> => {
      if (used) {
        throw new OAuthRedirectError("redirect_already_used", "OAuth redirect capture is single-use");
      }
      used = true;

      return new Promise<OAuthRedirectResult>((resolve, reject) => {
        settle = { resolve, reject };
        timer = setTimeout(() => {
          cleanup(new OAuthRedirectError("redirect_timeout", "OAuth redirect capture timed out"));
        }, deps.timeoutMs ?? DEFAULT_REDIRECT_TIMEOUT_MS);

        window = deps.createWindow?.() ?? defaultWindow();
        window.once("closed", () => {
          cleanup(new OAuthRedirectError("redirect_window_closed", "OAuth sign-in window was closed"));
        });

        window.loadURL(String(authorizeUrl)).catch((error: unknown) => {
          cleanup(error instanceof Error ? error : new Error("OAuth sign-in window failed to load"));
        });
      });
    },
    dispose: () => cleanup(new OAuthRedirectError("redirect_disposed", "OAuth redirect capture was disposed")),
  };
}
