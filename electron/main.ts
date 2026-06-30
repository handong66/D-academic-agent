import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { ElectronKeyStore } from "./keystore.js";
import { createElectronRedirectCapture, OAuthRedirectError } from "./oauth/electron-redirect.js";
import { KeychainOAuthProvider, type PreRegisteredOAuthClient } from "./oauth/keychain-oauth-provider.js";
import { resolveOAuthAccessToken } from "./oauth/resolve-access-token.js";
import { OAuthSignInError, signInWithOAuth } from "./oauth/sign-in.js";
import { declaredCapabilities } from "../src/external/provider-registry.js";
import type { ExternalProviderStatus, ExternalSearchResult, ReferenceExternalSignal } from "../src/external/types.js";
import { AppConfigSchema, type AppConfig, type ExternalMcpProviderConfig } from "../src/providers/config.js";
import type { WritingDeskReport } from "../src/writing/report.js";

type WorkerReference = { title?: string; author?: string; year?: string; doi?: string };

type WorkerResponse =
  | { id: string; type: "audit_result"; result: unknown }
  | { id: string; type: "plan_stage"; stage: string; detail: string }
  | { id: string; type: "sources"; sources: unknown }
  | { id: string; type: "library"; sources: unknown }
  | { id: string; type: "imported"; source: unknown; duplicate?: boolean }
  | { id: string; type: "removed"; sourceId: string }
  | { id: string; type: "eval_result"; result: unknown }
  | {
      id: string;
      type: "ablation_result";
      rows: { label: string; macro_f1: number; answer_groundedness: number; overclaim_recall: number; retrieval_recall_at_k: number; outbound_chars: number }[];
      mdPath: string;
      skipped: string[];
    }
  | {
      id: string;
      type: "plan_check_result";
      thesis: string;
      subqueries: string[];
      findings: unknown[];
      summary: { supporting_sources: string[]; contradicting_sources: string[] };
      thesis_verdict: { verdict: string; consensus: number; decisiveness: number; supporting: number; contradicting: number; mixed: number };
    }
  | { id: string; type: "writing_report"; report: WritingDeskReport }
  | { id: string; type: "matrix"; dir: string }
  | { id: string; type: "source_text"; sourceId: string; text: string }
  | { id: string; type: "source_references"; sourceId: string; references: WorkerReference[] }
  | { id: string; type: "model_status"; status: "present" | "absent" }
  | { id: string; type: "model_downloaded" }
  | { id: string; type: "config"; config: AppConfig }
  | { id: string; type: "config_applied" }
  | { id: string; type: "external_provider_status_result"; providers: ExternalProviderStatus[] }
  | { id: string; type: "external_search_result"; result: ExternalSearchResult }
  | { id: string; type: "library_reference_health_result"; signals: ReferenceExternalSignal[] }
  | { id: string; type: "error"; message: string };

type WorkerRequestType =
  | "audit"
  | "list_sources"
  | "list_library"
  | "import_pdf"
  | "remove_source"
  | "run_eval"
  | "run_ablation"
  | "plan_and_check"
  | "analyze_paragraph"
  | "external_provider_status"
  | "external_search"
  | "library_reference_health"
  | "build_matrix"
  | "get_source_text"
  | "get_source_references"
  | "model_status"
  | "download_model"
  | "get_config"
  | "set_config";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type StreamableHttpMcpProviderConfig = ExternalMcpProviderConfig & {
  transport: Extract<ExternalMcpProviderConfig["transport"], { kind: "streamable-http" }>;
};

type OAuthPkceMcpProviderConfig = StreamableHttpMcpProviderConfig & {
  transport: StreamableHttpMcpProviderConfig["transport"] & {
    auth: Extract<StreamableHttpMcpProviderConfig["transport"]["auth"], { type: "oauth-pkce" }>;
  };
};

const pendingRequests = new Map<string, PendingRequest>();
const WORKER_TIMEOUT_MS = 30000;
const OAUTH_SIGN_IN_TIMEOUT_MS = 120_000;
let worker: ChildProcessWithoutNullStreams | undefined;
let stdoutBuffer = "";
let mainWindow: BrowserWindow | undefined;
let keyStore: ElectronKeyStore | undefined;

const projectRoot = join(__dirname, "..", "..");
const workerBin = join(projectRoot, "node_modules", ".bin", "tsx");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rejectAllPending(error: Error): void {
  for (const { reject, timer } of pendingRequests.values()) {
    clearTimeout(timer);
    reject(error);
  }
  pendingRequests.clear();
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function dispatchWorkerLine(line: string): void {
  if (line.trim().length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    console.error("Ignoring malformed worker response:", error);
    return;
  }

  if (!isWorkerResponse(parsed)) return;

  if (parsed.type === "plan_stage") {
    mainWindow?.webContents.send("plan-stage", { id: parsed.id, stage: parsed.stage, detail: parsed.detail });
    return;
  }

  const pending = pendingRequests.get(parsed.id);
  if (!pending) return;

  pendingRequests.delete(parsed.id);
  clearTimeout(pending.timer);
  if (parsed.type === "error") {
    pending.reject(new Error(parsed.message));
    return;
  }

  if (parsed.type === "sources") {
    pending.resolve(parsed.sources);
    return;
  }
  if (parsed.type === "library") {
    pending.resolve(parsed.sources);
    return;
  }
  if (parsed.type === "imported") {
    pending.resolve({ source: parsed.source, duplicate: parsed.duplicate ?? false });
    return;
  }
  if (parsed.type === "removed") {
    pending.resolve(undefined);
    return;
  }
  if (parsed.type === "matrix") {
    pending.resolve({ dir: parsed.dir });
    return;
  }
  if (parsed.type === "source_text") {
    pending.resolve({ sourceId: parsed.sourceId, text: parsed.text });
    return;
  }
  if (parsed.type === "source_references") {
    pending.resolve(parsed.references);
    return;
  }
  if (parsed.type === "ablation_result") {
    pending.resolve({ rows: parsed.rows, mdPath: parsed.mdPath, skipped: parsed.skipped });
    return;
  }
  if (parsed.type === "plan_check_result") {
    pending.resolve({
      thesis: parsed.thesis,
      subqueries: parsed.subqueries,
      findings: parsed.findings,
      summary: parsed.summary,
      thesis_verdict: parsed.thesis_verdict,
    });
    return;
  }
  if (parsed.type === "writing_report") {
    pending.resolve(parsed.report);
    return;
  }
  if (parsed.type === "external_provider_status_result") {
    pending.resolve(parsed.providers);
    return;
  }
  if (parsed.type === "external_search_result") {
    pending.resolve(parsed.result);
    return;
  }
  if (parsed.type === "library_reference_health_result") {
    pending.resolve(parsed.signals);
    return;
  }
  if (parsed.type === "model_status") {
    pending.resolve(parsed.status);
    return;
  }
  if (parsed.type === "model_downloaded") {
    pending.resolve(undefined);
    return;
  }
  if (parsed.type === "config") {
    pending.resolve(parsed.config);
    return;
  }
  if (parsed.type === "config_applied") {
    pending.resolve({ type: "config_applied" });
    return;
  }
  pending.resolve(parsed.result);
}

function handleWorkerStdout(chunk: Buffer): void {
  stdoutBuffer += chunk.toString("utf8");

  for (;;) {
    const newlineIndex = stdoutBuffer.indexOf("\n");
    if (newlineIndex < 0) break;

    const line = stdoutBuffer.slice(0, newlineIndex);
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    dispatchWorkerLine(line);
  }
}

function startWorker(): ChildProcessWithoutNullStreams {
  const env = { ...process.env, HARNESS_LIBRARY: join(app.getPath("userData"), "library.db") };
  let child: ChildProcessWithoutNullStreams;
  if (app.isPackaged) {
    const workerCjsPath = join(__dirname, "worker.cjs");
    child = spawn(process.execPath, [workerCjsPath], {
      cwd: process.resourcesPath,
      // Packaged builds need asarUnpack for native modules and @electron/rebuild for Electron ABI.
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    });
  } else {
    child = spawn(workerBin, ["src/app/worker.ts"], {
      cwd: projectRoot,
      env,
    });
  }

  child.stdout.on("data", handleWorkerStdout);
  child.stderr.on("data", (chunk: Buffer) => {
    // Gate raw worker stderr behind HARNESS_DEBUG so an uncontrolled stream isn't forwarded by default (Codex M5a advisory).
    if (process.env.HARNESS_DEBUG) console.error(`[worker] ${chunk.toString("utf8").trimEnd()}`);
  });
  child.on("error", (error) => {
    rejectAllPending(error);
  });
  child.on("exit", (code, signal) => {
    worker = undefined;
    rejectAllPending(new Error(`worker exited (code=${String(code)}, signal=${String(signal)})`));
  });

  return child;
}

function stopWorker(): void {
  if (!worker || worker.killed) return;
  worker.kill();
}

function requestWorker(type: WorkerRequestType, payload: Record<string, unknown> = {}, requestId: string = randomUUID()): Promise<unknown> {
  if (!worker || worker.killed || !worker.stdin.writable) {
    throw new Error("worker is not running");
  }

  const request = JSON.stringify({ id: requestId, type, ...payload });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = pendingRequests.get(requestId);
      if (!pending) return;
      pendingRequests.delete(requestId);
      pending.reject(new Error(`${type} timed out`));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timer });
    worker?.stdin.write(`${request}\n`, (error) => {
      if (!error) return;
      const pending = pendingRequests.get(requestId);
      if (!pending) return;
      pendingRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(error);
    });
  });
}

function requireKeyStore(): ElectronKeyStore {
  if (!keyStore) throw new Error("keystore is not ready");
  return keyStore;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function addKeyRef(refs: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0) refs.add(value);
}

function collectAuthKeyRefs(auth: unknown, refs: Set<string>): void {
  if (!isRecord(auth)) return;

  if (auth.type === "bearer" || auth.type === "oauth-pkce") {
    addKeyRef(refs, auth.tokenKeyRef);
    return;
  }

  if (auth.type === "scite-client-credentials") {
    addKeyRef(refs, auth.clientIdKeyRef);
    addKeyRef(refs, auth.clientSecretKeyRef);
    return;
  }

  if (auth.type === "api-key-header") {
    addKeyRef(refs, auth.keyRef);
  }
}

function collectKeyRefs(config: unknown): string[] {
  const refs = new Set<string>();
  if (!isRecord(config)) return [];

  addKeyRef(refs, config.keyRef);

  const externalResearch = config.externalResearch;
  if (!isRecord(externalResearch)) return [...refs];

  const mcpProviders = externalResearch.mcpProviders;
  if (Array.isArray(mcpProviders)) {
    for (const provider of mcpProviders) {
      if (!isRecord(provider)) continue;
      const transport = provider.transport;
      if (!isRecord(transport)) continue;

      if (transport.kind === "stdio") {
        const secretEnvKeyRefs = transport.secretEnvKeyRefs;
        if (isRecord(secretEnvKeyRefs)) {
          for (const keyRef of Object.values(secretEnvKeyRefs)) {
            addKeyRef(refs, keyRef);
          }
        }
        continue;
      }

      if (transport.kind === "streamable-http") {
        collectAuthKeyRefs(transport.auth, refs);
      }
    }
  }

  const httpProviders = externalResearch.httpProviders;
  if (Array.isArray(httpProviders)) {
    for (const provider of httpProviders) {
      if (isRecord(provider)) collectAuthKeyRefs(provider.auth, refs);
    }
  }

  return [...refs];
}

function isOAuthPkceMcpProvider(value: unknown): value is OAuthPkceMcpProviderConfig {
  if (!isRecord(value)) return false;
  const transport = value.transport;
  if (!isRecord(transport) || transport.kind !== "streamable-http" || typeof transport.url !== "string") return false;
  const auth = transport.auth;
  return isRecord(auth) && auth.type === "oauth-pkce" && typeof auth.tokenKeyRef === "string";
}

function collectOAuthPkceMcpProviders(config: unknown): OAuthPkceMcpProviderConfig[] {
  if (!isRecord(config)) return [];
  const externalResearch = config.externalResearch;
  if (!isRecord(externalResearch) || !Array.isArray(externalResearch.mcpProviders)) return [];
  return externalResearch.mcpProviders.filter(isOAuthPkceMcpProvider);
}

async function resolveConfigSecrets(config: unknown): Promise<Record<string, string>> {
  const keyRefs = collectKeyRefs(config);
  const oauthProviders = collectOAuthPkceMcpProviders(config);
  if (keyRefs.length === 0 && oauthProviders.length === 0) return {};

  const store = requireKeyStore();
  const secrets: Record<string, string> = {};
  const oauthTokenKeyRefs = new Set(oauthProviders.map((provider) => provider.transport.auth.tokenKeyRef));
  for (const keyRef of keyRefs) {
    if (oauthTokenKeyRefs.has(keyRef)) continue;
    const value = await store.get(keyRef);
    if (value !== undefined) secrets[keyRef] = value;
  }
  for (const provider of oauthProviders) {
    const accessToken = await resolveOAuthAccessToken(store, provider, { fetchFn: fetch });
    if (accessToken !== undefined) secrets[provider.transport.auth.tokenKeyRef] = accessToken;
  }
  return secrets;
}

async function applyConfigToWorker(config: unknown): Promise<unknown> {
  const secrets = await resolveConfigSecrets(config);
  return requestWorker("set_config", { config, secrets });
}

async function currentConfig(): Promise<AppConfig> {
  return AppConfigSchema.parse(await requestWorker("get_config"));
}

function findOAuthPkceProvider(config: AppConfig, providerId: string): OAuthPkceMcpProviderConfig | undefined {
  const provider = config.externalResearch.mcpProviders.find((candidate) => candidate.id === providerId);
  return isOAuthPkceMcpProvider(provider) ? provider : undefined;
}

function oauthProviderStatus(providerCfg: OAuthPkceMcpProviderConfig, connected: boolean, message?: string): ExternalProviderStatus {
  return {
    id: providerCfg.id,
    enabled: providerCfg.enabled,
    connected,
    capabilities: declaredCapabilities(providerCfg),
    ...(message === undefined ? {} : { message }),
  };
}

function unknownOAuthProviderStatus(providerId: string, message: string): ExternalProviderStatus {
  return {
    id: providerId as ExternalProviderStatus["id"],
    enabled: false,
    connected: false,
    capabilities: [],
    message,
  };
}

function oauthFailureMessage(error: unknown): string {
  if (error instanceof OAuthSignInError || error instanceof OAuthRedirectError) return error.code;
  return "oauth_sign_in_failed";
}

async function resolvePreRegisteredClient(providerCfg: OAuthPkceMcpProviderConfig, store: ElectronKeyStore): Promise<PreRegisteredOAuthClient | undefined> {
  const auth = providerCfg.transport.auth;
  const clientId = auth.clientIdKeyRef === undefined ? undefined : nonEmpty(await store.get(auth.clientIdKeyRef));
  if (clientId === undefined) return undefined;

  const clientSecret = auth.clientSecretKeyRef === undefined ? undefined : nonEmpty(await store.get(auth.clientSecretKeyRef));
  return {
    clientId,
    ...(clientSecret === undefined ? {} : { clientSecret }),
  };
}

ipcMain.handle("audit", (_event, draftText: unknown) => {
  if (typeof draftText !== "string") {
    throw new Error("draftText must be a string");
  }
  return requestWorker("audit", { draftText });
});

ipcMain.handle("list_sources", () => {
  return requestWorker("list_sources");
});

ipcMain.handle("list_library", () => {
  return requestWorker("list_library");
});

ipcMain.handle("import_pdf", (_event, bytesBase64: unknown) => {
  if (typeof bytesBase64 !== "string") {
    throw new Error("bytesBase64 must be a string");
  }
  return requestWorker("import_pdf", { bytesBase64 });
});

ipcMain.handle("remove_source", (_event, sourceId: unknown) => {
  if (typeof sourceId !== "string") {
    throw new Error("sourceId must be a string");
  }
  return requestWorker("remove_source", { sourceId });
});

ipcMain.handle("run_eval", () => {
  return requestWorker("run_eval");
});

ipcMain.handle("run_ablation", () => {
  return requestWorker("run_ablation");
});

ipcMain.handle("plan_and_check", (_event, thesis: unknown) => {
  if (typeof thesis !== "string") {
    throw new Error("thesis must be a string");
  }
  return requestWorker("plan_and_check", { thesis });
});

ipcMain.handle("analyze_paragraph", (_event, paragraph: unknown) => {
  if (typeof paragraph !== "string") {
    throw new Error("paragraph must be a string");
  }
  return requestWorker("analyze_paragraph", { paragraph });
});

ipcMain.handle("external_provider_status", () => {
  return requestWorker("external_provider_status");
});

ipcMain.handle("oauth_sign_in", async (_event, providerId: unknown) => {
  if (typeof providerId !== "string") {
    throw new Error("providerId must be a string");
  }

  const config = await currentConfig();
  const providerCfg = findOAuthPkceProvider(config, providerId);
  if (providerCfg === undefined) {
    return unknownOAuthProviderStatus(providerId, "oauth_provider_not_configured");
  }

  const store = requireKeyStore();
  const redirect = await createElectronRedirectCapture({ timeoutMs: OAUTH_SIGN_IN_TIMEOUT_MS });
  try {
    const preRegisteredClient = await resolvePreRegisteredClient(providerCfg, store);
    const auth = providerCfg.transport.auth;
    const provider = new KeychainOAuthProvider({
      keystore: store,
      tokenKeyRef: auth.tokenKeyRef,
      redirectUrl: redirect.redirectUrl,
      scopes: auth.scopes,
      resource: auth.resource,
      openAuthorizationUrl: async () => undefined,
      ...(preRegisteredClient === undefined ? {} : { preRegisteredClient }),
    });

    await signInWithOAuth(providerCfg.transport.url, provider, {
      fetchFn: fetch,
      captureRedirect: redirect.captureRedirect,
      timeoutMs: OAUTH_SIGN_IN_TIMEOUT_MS,
    });
    await applyConfigToWorker(config);
    return oauthProviderStatus(providerCfg, true);
  } catch (error) {
    return oauthProviderStatus(providerCfg, false, oauthFailureMessage(error));
  } finally {
    redirect.dispose();
  }
});

ipcMain.handle("oauth_disconnect", async (_event, providerId: unknown) => {
  if (typeof providerId !== "string") {
    throw new Error("providerId must be a string");
  }

  const config = await currentConfig();
  const providerCfg = findOAuthPkceProvider(config, providerId);
  if (providerCfg === undefined) {
    return unknownOAuthProviderStatus(providerId, "oauth_provider_not_configured");
  }

  await requireKeyStore().delete(providerCfg.transport.auth.tokenKeyRef);
  await applyConfigToWorker(config);
  return oauthProviderStatus(providerCfg, false);
});

ipcMain.handle("external_search", (_event, providerId: unknown, query: unknown, opts: unknown) => {
  if (typeof providerId !== "string") {
    throw new Error("providerId must be a string");
  }
  if (typeof query !== "string") {
    throw new Error("query must be a string");
  }
  if (opts !== undefined && (!isRecord(opts) || Array.isArray(opts))) {
    throw new Error("opts must be an object");
  }
  return requestWorker("external_search", {
    providerId,
    query,
    ...(opts === undefined ? {} : { opts }),
  });
});

ipcMain.handle("library_reference_health", (_event, dois: unknown) => {
  if (!Array.isArray(dois) || !dois.every((doi: unknown): doi is string => typeof doi === "string")) {
    throw new Error("dois must be a string[]");
  }
  return requestWorker("library_reference_health", { dois });
});

ipcMain.handle("build_matrix", async (_event, outDir: unknown) => {
  if (typeof outDir !== "string") {
    throw new Error("outDir must be a string");
  }
  // Read matrix.md HERE in main (full node access) rather than in the sandboxed preload —
  // a sandboxed preload can't import node:fs/promises, which crashed the whole renderer.
  const result = await requestWorker("build_matrix", { outDir });
  const dir = (result as { dir?: unknown } | undefined)?.dir;
  if (typeof dir !== "string") {
    throw new Error("build_matrix returned an invalid response");
  }
  return { dir, markdown: await readFile(join(dir, "matrix.md"), "utf8") };
});

ipcMain.handle("get_source_text", (_event, sourceId: unknown) => {
  if (typeof sourceId !== "string") {
    throw new Error("bad arg");
  }
  return requestWorker("get_source_text", { sourceId });
});

ipcMain.handle("get_source_references", (_event, sourceId: unknown) => {
  if (typeof sourceId !== "string") {
    throw new Error("bad arg");
  }
  return requestWorker("get_source_references", { sourceId });
});

ipcMain.handle("model_status", (_event, id: unknown) => {
  if (typeof id !== "string") {
    throw new Error("id must be a string");
  }
  return requestWorker("model_status", {}, id);
});

ipcMain.handle("download_model", (_event, id: unknown) => {
  if (typeof id !== "string") {
    throw new Error("id must be a string");
  }
  return requestWorker("download_model", {}, id);
});

ipcMain.handle("set_key", (_event, keyRef: unknown, key: unknown) => {
  if (typeof keyRef !== "string" || typeof key !== "string") {
    throw new Error("keyRef and key must be strings");
  }
  return requireKeyStore().set(keyRef, key);
});

ipcMain.handle("get_config", () => {
  return requestWorker("get_config");
});

ipcMain.handle("set_config", async (_event, config: unknown) => {
  return applyConfigToWorker(config);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    title: "D-academic-agent",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
    },
  });

  void mainWindow.loadFile(join(projectRoot, "electron", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    stopWorker();
    mainWindow = undefined;
  });
}

app.whenReady().then(() => {
  keyStore = new ElectronKeyStore();
  worker = startWorker();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      worker = startWorker();
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopWorker();
});

app.on("window-all-closed", () => {
  app.quit();
});
