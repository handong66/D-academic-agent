import { join } from "node:path";
import { auditDraft } from "../draft/audit.js";
import type { DraftAudit } from "../draft/audit.js";
import { runEval } from "../eval/runner.js";
import type { EvalReport } from "../eval/runner.js";
import { runPlanAndCheck, type PlanFinding, type PlanCheckResult } from "../plan/orchestrate.js";
import { HashEmbedder } from "../retrieve/embed.js";
import { loadTrace, summarizeTrace } from "../dx/replay.js";
import { downloadModel, modelStatus } from "../providers/models.js";
import { buildLiteratureMatrix } from "../tools/matrix.js";
import type { MatrixRow } from "../tools/matrix.js";
import { resolveProjectLocal } from "../tools/projectlocal.js";
import type { ToolContext } from "../tools/tools.js";
import type { Source } from "../types.js";
import { analyzeParagraph } from "../writing/report.js";
import type { WritingDeskReport } from "../writing/report.js";
import type { ExternalProviderId, ExternalProviderStatus, ExternalSearchResult, ReferenceExternalSignal } from "../external/types.js";
import type { Reference } from "../library/grobid.js";

export type { Reference } from "../library/grobid.js";

export interface AuditRequest {
  id: string;
  type: "audit";
  draftText: string;
}

export interface ListSourcesRequest {
  id: string;
  type: "list_sources";
}

export interface RunEvalRequest {
  id: string;
  type: "run_eval";
}

export interface PlanAndCheckRequest {
  id: string;
  type: "plan_and_check";
  thesis: string;
  k?: number;
  budget?: number;
  judgeBudget?: number;
}

export interface BuildMatrixRequest {
  id: string;
  type: "build_matrix";
  outDir: string;
}

export interface GetSourceTextRequest {
  id: string;
  type: "get_source_text";
  sourceId: string;
}

export interface GetSourceReferencesRequest {
  id: string;
  type: "get_source_references";
  sourceId: string;
}

export interface ModelStatusRequest {
  id: string;
  type: "model_status";
}

export interface DownloadModelRequest {
  id: string;
  type: "download_model";
}

export interface AnalyzeParagraphRequest {
  id: string;
  type: "analyze_paragraph";
  paragraph: string;
}

export interface ExternalProviderStatusRequest {
  id: string;
  type: "external_provider_status";
}

export interface ExternalSearchRequest {
  id: string;
  type: "external_search";
  providerId: ExternalProviderId;
  query: string;
  opts?: Record<string, unknown>;
}

export interface LibraryReferenceHealthRequest {
  id: string;
  type: "library_reference_health";
  dois: string[];
}

export type WorkerRequest =
  | AuditRequest
  | ListSourcesRequest
  | RunEvalRequest
  | PlanAndCheckRequest
  | BuildMatrixRequest
  | GetSourceTextRequest
  | GetSourceReferencesRequest
  | ModelStatusRequest
  | DownloadModelRequest
  | AnalyzeParagraphRequest
  | ExternalProviderStatusRequest
  | ExternalSearchRequest
  | LibraryReferenceHealthRequest;

export type SourceSummary = Pick<Source, "id" | "title" | "year" | "type"> & { doi?: string; referenceCount?: number };

export type EvalResult = Pick<EvalReport, "macro_f1" | "answer_groundedness" | "policy_compliance" | "per_class" | "confusion" | "failures"> & {
  trace_summary: ReturnType<typeof summarizeTrace>;
};

export type PlanCheckResponse = Pick<PlanCheckResult, "thesis" | "subqueries" | "summary" | "thesis_verdict"> & {
  id: string;
  type: "plan_check_result";
  findings: PlanFinding[];
};

export interface PlanStageResponse {
  id: string;
  type: "plan_stage";
  stage: string;
  detail: string;
}

export interface WritingReportResponse {
  id: string;
  type: "writing_report";
  report: WritingDeskReport;
}

export interface ExternalProviderStatusResponse {
  id: string;
  type: "external_provider_status_result";
  providers: ExternalProviderStatus[];
}

export interface ExternalSearchResponse {
  id: string;
  type: "external_search_result";
  result: ExternalSearchResult;
}

export interface LibraryReferenceHealthResponse {
  id: string;
  type: "library_reference_health_result";
  signals: ReferenceExternalSignal[];
}

export type AuditResponse =
  | { id: string; type: "audit_result"; result: DraftAudit }
  | { id: string; type: "error"; message: string };

export type WorkerResponse =
  | AuditResponse
  | { id: string; type: "sources"; sources: SourceSummary[] }
  | { id: string; type: "eval_result"; result: EvalResult }
  | PlanStageResponse
  | PlanCheckResponse
  | WritingReportResponse
  | { id: string; type: "matrix"; dir: string }
  | { id: string; type: "source_text"; sourceId: string; text: string }
  | { id: string; type: "source_references"; sourceId: string; references: Reference[] }
  | { id: string; type: "model_status"; status: "present" | "absent" }
  | { id: string; type: "model_downloaded" }
  | ExternalProviderStatusResponse
  | ExternalSearchResponse
  | LibraryReferenceHealthResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : "unknown";
}

function isExternalProviderId(value: unknown): value is ExternalProviderId {
  return value === "scite" || value === "consensus";
}

function validationError(msg: unknown, message: string): AuditResponse {
  return { id: stringId(msg), type: "error", message };
}

type ValidationResult =
  | { ok: true; request: AuditRequest }
  | { ok: false; response: AuditResponse };

type WorkerValidationResult =
  | { ok: true; request: WorkerRequest }
  | { ok: false; response: WorkerResponse };

function validateAuditRequest(msg: unknown): ValidationResult {
  if (!isRecord(msg)) return { ok: false, response: validationError(msg, "message must be an object") };
  if (typeof msg.id !== "string") return { ok: false, response: validationError(msg, "id must be a string") };
  if (msg.type !== "audit") return { ok: false, response: validationError(msg, `unsupported message type: ${String(msg.type)}`) };
  if (typeof msg.draftText !== "string") return { ok: false, response: validationError(msg, "draftText must be a string") };
  return { ok: true, request: { id: msg.id, type: "audit", draftText: msg.draftText } };
}

export function validateWorkerRequest(msg: unknown): WorkerValidationResult {
  if (!isRecord(msg)) return { ok: false, response: validationError(msg, "message must be an object") };
  if (typeof msg.id !== "string") return { ok: false, response: validationError(msg, "id must be a string") };

  if (msg.type === "audit") {
    if (typeof msg.draftText !== "string") return { ok: false, response: validationError(msg, "draftText must be a string") };
    return { ok: true, request: { id: msg.id, type: "audit", draftText: msg.draftText } };
  }
  if (msg.type === "list_sources") {
    return { ok: true, request: { id: msg.id, type: "list_sources" } };
  }
  if (msg.type === "run_eval") {
    return { ok: true, request: { id: msg.id, type: "run_eval" } };
  }
  if (msg.type === "plan_and_check") {
    if (typeof msg.thesis !== "string") return { ok: false, response: validationError(msg, "thesis must be a string") };
    const request: PlanAndCheckRequest = { id: msg.id, type: "plan_and_check", thesis: msg.thesis };
    for (const key of ["k", "budget", "judgeBudget"] as const) {
      const value = msg[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, response: validationError(msg, `${key} must be a number`) };
      request[key] = value;
    }
    return { ok: true, request };
  }
  if (msg.type === "model_status") {
    return { ok: true, request: { id: msg.id, type: "model_status" } };
  }
  if (msg.type === "download_model") {
    return { ok: true, request: { id: msg.id, type: "download_model" } };
  }
  if (msg.type === "analyze_paragraph") {
    if (typeof msg.paragraph !== "string") return { ok: false, response: validationError(msg, "paragraph must be a string") };
    if (msg.paragraph.trim().length === 0) return { ok: false, response: validationError(msg, "paragraph must be a non-empty string") };
    return { ok: true, request: { id: msg.id, type: "analyze_paragraph", paragraph: msg.paragraph } };
  }
  if (msg.type === "build_matrix") {
    if (typeof msg.outDir !== "string") return { ok: false, response: validationError(msg, "outDir must be a string") };
    return { ok: true, request: { id: msg.id, type: "build_matrix", outDir: msg.outDir } };
  }
  if (msg.type === "get_source_text") {
    if (typeof msg.sourceId !== "string") return { ok: false, response: validationError(msg, "sourceId must be a string") };
    return { ok: true, request: { id: msg.id, type: "get_source_text", sourceId: msg.sourceId } };
  }
  if (msg.type === "get_source_references") {
    if (typeof msg.sourceId !== "string") return { ok: false, response: validationError(msg, "sourceId must be a string") };
    return { ok: true, request: { id: msg.id, type: "get_source_references", sourceId: msg.sourceId } };
  }
  if (msg.type === "external_provider_status") {
    return { ok: true, request: { id: msg.id, type: "external_provider_status" } };
  }
  if (msg.type === "external_search") {
    if (!isExternalProviderId(msg.providerId)) return { ok: false, response: validationError(msg, "providerId must be scite or consensus") };
    if (typeof msg.query !== "string") return { ok: false, response: validationError(msg, "query must be a string") };
    if (msg.opts !== undefined && (!isRecord(msg.opts) || Array.isArray(msg.opts))) {
      return { ok: false, response: validationError(msg, "opts must be an object") };
    }
    return {
      ok: true,
      request: {
        id: msg.id,
        type: "external_search",
        providerId: msg.providerId,
        query: msg.query,
        ...(msg.opts === undefined ? {} : { opts: msg.opts }),
      },
    };
  }
  if (msg.type === "library_reference_health") {
    if (!Array.isArray(msg.dois) || !msg.dois.every((doi) => typeof doi === "string")) {
      return { ok: false, response: validationError(msg, "dois must be a string array") };
    }
    return { ok: true, request: { id: msg.id, type: "library_reference_health", dois: msg.dois } };
  }

  return { ok: false, response: validationError(msg, `unsupported message type: ${String(msg.type)}`) };
}

function sourceSummaries(ctx: ToolContext): SourceSummary[] {
  return ctx.sources.map(({ id, title, year, type, citation_metadata }) => ({
    id,
    title,
    year,
    type,
    ...(citation_metadata.doi === undefined ? {} : { doi: citation_metadata.doi }),
    ...(Array.isArray(citation_metadata.raw?.references) ? { referenceCount: citation_metadata.raw.references.length } : {}),
  }));
}

function sourceText(ctx: ToolContext, sourceId: string): string {
  const source = ctx.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return "";
  return ctx.texts.get(source.id) ?? "";
}

function referenceFromRaw(value: unknown): Reference | undefined {
  if (!isRecord(value)) return undefined;
  const reference: Reference = {};
  for (const key of ["title", "author", "year", "doi"] as const) {
    const field = value[key];
    if (typeof field === "string" && field.length > 0) reference[key] = field;
  }
  return Object.keys(reference).length > 0 ? reference : undefined;
}

export function sourceReferences(ctx: ToolContext, sourceId: string): Reference[] {
  const source = ctx.sources.find((candidate) => candidate.id === sourceId);
  const references = source?.citation_metadata.raw?.references;
  if (!Array.isArray(references)) return [];
  return references.map(referenceFromRaw).filter((reference): reference is Reference => reference !== undefined);
}

function matrixRows(ctx: ToolContext): MatrixRow[] {
  return ctx.sources.map((source) => {
    const text = ctx.texts.get(source.id) ?? "";
    const quote = text.replace(/\s+/g, " ").trim().slice(0, 240) || source.title;
    return {
      source_id: source.id,
      claim: source.title,
      verdict: source.fulltext_status,
      quote,
      locator: `${source.id}:0-${Math.min(text.length, quote.length)}`,
    };
  });
}

async function runSeedEval(ctx: ToolContext): Promise<EvalResult> {
  const outDir = resolveProjectLocal("out/electron-eval");
  const report = await runEval(
    { corpusDir: "fixtures/corpus", goldPath: "fixtures/gold_claims.jsonl", outDir },
    ctx.embedder ?? new HashEmbedder(256), // reflect the selected embedder when the ctx was built via a provider (Codex M5a advisory)
    ctx.judge,
  );
  return {
    macro_f1: report.macro_f1,
    answer_groundedness: report.answer_groundedness,
    policy_compliance: report.policy_compliance,
    per_class: report.per_class,
    confusion: report.confusion,
    failures: report.failures,
    trace_summary: summarizeTrace(loadTrace(join(outDir, "trace.jsonl"))),
  };
}

export async function handleWorkerMessage(msg: unknown, ctx: ToolContext, emit: (obj: unknown) => void = () => undefined): Promise<WorkerResponse> {
  const validation = validateWorkerRequest(msg);
  if (!validation.ok) return validation.response;
  const { request } = validation;

  try {
    if (request.type === "audit") {
      return {
        id: request.id,
        type: "audit_result",
        result: await auditDraft(request.draftText, ctx),
      };
    }
    if (request.type === "list_sources") {
      return { id: request.id, type: "sources", sources: sourceSummaries(ctx) };
    }
    if (request.type === "run_eval") {
      return { id: request.id, type: "eval_result", result: await runSeedEval(ctx) };
    }
    if (request.type === "get_source_text") {
      return { id: request.id, type: "source_text", sourceId: request.sourceId, text: sourceText(ctx, request.sourceId) };
    }
    if (request.type === "get_source_references") {
      return { id: request.id, type: "source_references", sourceId: request.sourceId, references: sourceReferences(ctx, request.sourceId) };
    }
    if (request.type === "analyze_paragraph") {
      return { id: request.id, type: "writing_report", report: await analyzeParagraph(request.paragraph, ctx) };
    }
    if (request.type === "plan_and_check") {
      const result = await runPlanAndCheck(ctx.retriever, ctx.planner, ctx.judge, request.thesis, {
        k: request.k,
        budget: request.budget,
        judgeBudget: request.judgeBudget,
        onStage: (stage, detail) => emit({ id: request.id, type: "plan_stage", stage, detail }),
      });
      return {
        id: request.id,
        type: "plan_check_result",
        thesis: result.thesis,
        subqueries: result.subqueries,
        findings: result.findings,
        summary: result.summary,
        thesis_verdict: result.thesis_verdict,
      };
    }
    if (request.type === "model_status") {
      return { id: request.id, type: "model_status", status: await modelStatus(request.id) };
    }
    if (request.type === "download_model") {
      await downloadModel(request.id);
      return { id: request.id, type: "model_downloaded" };
    }
    if (request.type === "external_provider_status" || request.type === "external_search" || request.type === "library_reference_health") {
      return {
        id: request.id,
        type: "error",
        message: `${request.type} must be handled by worker runtime`,
      };
    }
    return {
      id: request.id,
      type: "matrix",
      dir: buildLiteratureMatrix(matrixRows(ctx), request.outDir),
    };
  } catch (error) {
    return {
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handleAuditMessage(msg: unknown, ctx: ToolContext): Promise<AuditResponse> {
  const validation = validateAuditRequest(msg);
  if (!validation.ok) return validation.response;
  const res = await handleWorkerMessage(validation.request, ctx);
  if (res.type === "audit_result" || res.type === "error") return res;
  return {
    id: res.id,
    type: "error",
    message: `unsupported message type: ${validation.request.type}`,
  };
}
