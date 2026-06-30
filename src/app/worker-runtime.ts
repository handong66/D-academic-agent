import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAblation, type AblationVariant } from "../coevo/ablation.js";
import { AppConfigSchema, defaultConfig, type AppConfig } from "../providers/config.js";
import { buildContext, resolveEmbedder, resolveJudge } from "../providers/context.js";
import { modelStatus } from "../providers/models.js";
import { GrobidParser, grobidAvailable } from "../library/grobid.js";
import { importPdf } from "../library/import.js";
import { openLibrary } from "../library/library.js";
import { UnpdfParser, type PdfParser } from "../library/parser.js";
import { buildIndexFromStored } from "../retrieve/index.js";
import type { Chunk } from "../retrieve/types.js";
import { makeToolContext, type ToolContext } from "../tools/tools.js";
import { buildExternalProvider } from "../external/provider-factory.js";
import { providerById, type ExternalProviderConfig } from "../external/provider-registry.js";
import type { FetchLike } from "../external/providers/scite-auth.js";
import { handleWorkerMessage, sourceReferences, validateWorkerRequest } from "./protocol.js";

export interface WorkerRuntime {
  config(): AppConfig;
  handleLine(line: string): Promise<string>;
}

interface RuntimeOptions {
  corpusDir: string;
  libraryPath: string;
  initialConfig?: AppConfig;
  emit?: (obj: unknown) => void;
  fetch?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : "unknown";
}

function parseSecrets(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("invalid secrets");

  const secrets: Record<string, string> = {};
  for (const [key, secret] of Object.entries(value)) {
    if (typeof secret !== "string") throw new Error("invalid secrets");
    secrets[key] = secret;
  }
  return secrets;
}

function encode(value: unknown): string {
  return JSON.stringify(value);
}

// Redact any known secret value that may have surfaced in a downstream response (e.g. a provider
// error message echoing the API key). The runtime owns `secrets`, so it scrubs at the boundary —
// closing the red-line for the generic handler path, not just the secret-bearing control messages.
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const secret of Object.values(secrets)) {
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}

const DEFAULT_GROBID_BASE_URL = "http://localhost:8070";
const ABLATION_GOLD_PATH = "fixtures/gold_claims.jsonl";
const MINI_LM_MODEL_ID = "all-MiniLM-L6-v2";
const NLI_MODEL_ID = "nli-deberta-v3-xsmall";
const MAX_LIBRARY_REFERENCE_HEALTH_DOIS = 100;

function sanitizeAblationLabel(label: string): string {
  const safe = label
    .trim()
    .replace(/[^A-Za-z0-9._+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "variant";
}

async function defaultAblationVariants(): Promise<{ variants: AblationVariant[]; skipped: string[] }> {
  const variants: AblationVariant[] = [
    {
      label: sanitizeAblationLabel("hash+mock"),
      embedder: resolveEmbedder({ provider: "hash", dim: 256 }, {}),
      judge: resolveJudge({ provider: "mock" }, {}),
    },
    {
      label: sanitizeAblationLabel("hash+mock+agentic diagnostic-probe"),
      embedder: resolveEmbedder({ provider: "hash", dim: 256 }, {}),
      judge: resolveJudge({ provider: "mock" }, {}),
      maxCandidates: 3,
    },
  ];
  const skipped: string[] = [];

  const miniPresent = (await modelStatus(MINI_LM_MODEL_ID)) === "present";
  const nliPresent = miniPresent && (await modelStatus(NLI_MODEL_ID)) === "present";

  if (miniPresent) {
    variants.push({
      label: sanitizeAblationLabel("all-MiniLM+mock"),
      embedder: resolveEmbedder({ provider: "transformers-local", model: MINI_LM_MODEL_ID }, {}),
      judge: resolveJudge({ provider: "mock" }, {}),
    });
  } else {
    skipped.push("all-MiniLM+mock");
  }

  if (miniPresent && nliPresent) {
    variants.push({
      label: sanitizeAblationLabel("all-MiniLM+NLI"),
      embedder: resolveEmbedder({ provider: "transformers-local", model: MINI_LM_MODEL_ID }, {}),
      judge: resolveJudge({ provider: "transformers-nli", model: NLI_MODEL_ID }, {}),
    });
  } else {
    skipped.push("all-MiniLM+NLI");
  }

  return { variants, skipped };
}

export async function createWorkerRuntime(opts: RuntimeOptions): Promise<WorkerRuntime> {
  const fetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const library = openLibrary(opts.libraryPath);
  // Initialize config.corpus from the actual corpusDir so get_config returns a corpus that exists and
  // set_config (Settings "Apply") can rebuild from it — avoids the defaultConfig "./corpus" mismatch.
  let config = AppConfigSchema.parse({
    ...(opts.initialConfig ?? defaultConfig),
    corpus: opts.initialConfig?.corpus ?? opts.corpusDir,
    library: opts.initialConfig?.library ?? opts.libraryPath,
  });
  let secrets: Record<string, string> = {};
  let ctx: ToolContext;

  function emit(obj: unknown): void {
    if (!opts.emit) return;
    opts.emit(JSON.parse(redactSecrets(encode(obj), secrets)) as unknown);
  }

  function encodeRedacted(value: unknown): string {
    return redactSecrets(encode(value), secrets);
  }

  function configuredExternalProviders(): ExternalProviderConfig[] {
    return [...config.externalResearch.mcpProviders, ...config.externalResearch.httpProviders];
  }

  function textsFromChunks(chunks: Chunk[]): Map<string, string> {
    const grouped = new Map<string, string[]>();
    for (const chunk of chunks) {
      const parts = grouped.get(chunk.source_id) ?? [];
      parts.push(chunk.text);
      grouped.set(chunk.source_id, parts);
    }
    return new Map([...grouped.entries()].map(([sourceId, parts]) => [sourceId, parts.join("\n")]));
  }

  async function buildRuntimeContext(nextConfig: AppConfig, nextSecrets: Record<string, string>): Promise<ToolContext> {
    const embedder = resolveEmbedder(nextConfig.embedder, nextSecrets);
    const judge = resolveJudge(nextConfig.judge, nextSecrets);

    if (library.listSources().length > 0) {
      if (library.staleFor(embedder.model, embedder.dim)) await library.reindex(embedder);
      const { sources, chunks, vectors } = library.loadAll();
      return makeToolContext(sources, textsFromChunks(chunks), buildIndexFromStored(chunks, vectors, embedder), judge, embedder);
    }

    return buildContext(nextConfig, nextConfig.corpus ?? opts.corpusDir, nextSecrets);
  }

  async function rebuildCtx(): Promise<void> {
    ctx = await buildRuntimeContext(config, secrets);
  }

  async function resolvePdfParser(): Promise<PdfParser> {
    if (config.pdf.provider !== "grobid") return new UnpdfParser();

    const baseURL = config.pdf.baseURL ?? DEFAULT_GROBID_BASE_URL;
    if (await grobidAvailable(baseURL)) return new GrobidParser({ baseURL });
    return new UnpdfParser();
  }

  await rebuildCtx();

  return {
    config(): AppConfig {
      return AppConfigSchema.parse(config);
    },

    async handleLine(line: string): Promise<string> {
      let msg: unknown;
      try {
        msg = JSON.parse(line) as unknown;
      } catch {
        return encode({ id: randomUUID(), type: "error", message: "malformed JSON line" });
      }

      if (isRecord(msg) && msg.type === "get_config") {
        return encode({ id: stringId(msg), type: "config", config });
      }

      if (isRecord(msg) && msg.type === "set_config") {
        const id = stringId(msg);
        try {
          const nextConfig = AppConfigSchema.parse(msg.config);
          const nextSecrets = parseSecrets(msg.secrets);
          const nextCtx = await buildRuntimeContext(nextConfig, nextSecrets);
          ctx = nextCtx;
          config = nextConfig;
          secrets = nextSecrets;
          return encode({ id, type: "config_applied" });
        } catch {
          return encode({ id, type: "error", message: "set_config failed: invalid config" });
        }
      }

      if (isRecord(msg) && (msg.type === "external_provider_status" || msg.type === "external_search" || msg.type === "library_reference_health")) {
        const validation = validateWorkerRequest(msg);
        if (!validation.ok) return encodeRedacted(validation.response);
        const { request } = validation;

        try {
          if (request.type === "external_provider_status") {
            return encodeRedacted({
              id: request.id,
              type: "external_provider_status_result",
              providers: configuredExternalProviders().map((providerCfg) => buildExternalProvider(providerCfg, secrets, { fetch }).status),
            });
          }

          if (request.type === "external_search") {
            const providerCfg = providerById(config.externalResearch, request.providerId);
            if (providerCfg === undefined) {
              return encodeRedacted({ id: request.id, type: "error", message: `external provider ${request.providerId} is not configured` });
            }

            const provider = buildExternalProvider(providerCfg, secrets, { fetch });
            if (!provider.status.enabled) {
              return encodeRedacted({ id: request.id, type: "error", message: `external provider ${request.providerId} is disabled` });
            }
            if (provider.search === undefined) {
              return encodeRedacted({ id: request.id, type: "error", message: `external provider ${request.providerId} is not connected` });
            }

            return encodeRedacted({
              id: request.id,
              type: "external_search_result",
              result: await provider.search(request.query, request.opts),
            });
          }

          if (request.type === "library_reference_health") {
            const providerCfg = providerById(config.externalResearch, "scite");
            if (providerCfg === undefined) {
              return encodeRedacted({ id: request.id, type: "library_reference_health_result", signals: [] });
            }

            const provider = buildExternalProvider(providerCfg, secrets, { fetch });
            if (!provider.status.enabled || provider.referenceHealth === undefined) {
              return encodeRedacted({ id: request.id, type: "library_reference_health_result", signals: [] });
            }

            return encodeRedacted({
              id: request.id,
              type: "library_reference_health_result",
              signals: await provider.referenceHealth(request.dois.slice(0, MAX_LIBRARY_REFERENCE_HEALTH_DOIS)),
            });
          }

          return encodeRedacted({ id: request.id, type: "error", message: `unsupported message type: ${request.type}` });
        } catch (error) {
          return encodeRedacted({
            id: request.id,
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (isRecord(msg) && msg.type === "list_library") {
        return encode({ id: stringId(msg), type: "library", sources: library.listSources() });
      }

      if (isRecord(msg) && msg.type === "get_source_references") {
        const validation = validateWorkerRequest(msg);
        if (!validation.ok) return encodeRedacted(validation.response);
        const { request } = validation;
        if (request.type !== "get_source_references") {
          return encodeRedacted({ id: request.id, type: "error", message: `unsupported message type: ${request.type}` });
        }
        return encodeRedacted({
          id: request.id,
          type: "source_references",
          sourceId: request.sourceId,
          references: sourceReferences(ctx, request.sourceId),
        });
      }

      if (isRecord(msg) && msg.type === "import_pdf") {
        const id = stringId(msg);
        try {
          if (typeof msg.bytesBase64 !== "string") throw new Error("bytesBase64 must be a string");
          const bytes = new Uint8Array(Buffer.from(msg.bytesBase64, "base64"));
          const { source, duplicate } = await importPdf(bytes, {
            id: id === "unknown" ? randomUUID() : id,
            parser: await resolvePdfParser(),
            embedder: resolveEmbedder(config.embedder, secrets),
            library,
          });
          await rebuildCtx();
          return encode({
            id,
            type: "imported",
            source: {
              id: source.id,
              title: source.title,
              year: source.year,
              type: source.type,
              ...(source.citation_metadata.doi === undefined ? {} : { doi: source.citation_metadata.doi }),
              ...(Array.isArray(source.citation_metadata.raw?.references) ? { referenceCount: source.citation_metadata.raw.references.length } : {}),
            },
            duplicate,
          });
        } catch {
          return encode({ id, type: "error", message: "import_pdf failed" });
        }
      }

      if (isRecord(msg) && msg.type === "run_ablation") {
        const id = stringId(msg);
        try {
          const { variants, skipped } = await defaultAblationVariants();
          const outDir = mkdtempSync(join(tmpdir(), "ablation-"));
          const result = await runAblation(variants, { corpusDir: opts.corpusDir, goldPath: ABLATION_GOLD_PATH, outDir });
          return encode({ id, type: "ablation_result", rows: result.variants, mdPath: join(outDir, "ablation.md"), skipped });
        } catch {
          return redactSecrets(encode({ id, type: "error", message: "run_ablation failed" }), secrets);
        }
      }

      if (isRecord(msg) && msg.type === "remove_source") {
        const id = stringId(msg);
        try {
          if (typeof msg.sourceId !== "string") throw new Error("sourceId must be a string");
          library.removeSource(msg.sourceId);
          await rebuildCtx();
          return encode({ id, type: "removed", sourceId: msg.sourceId });
        } catch {
          return encode({ id, type: "error", message: "remove_source failed" });
        }
      }

      return redactSecrets(encode(await handleWorkerMessage(msg, ctx, emit)), secrets);
    },
  };
}
