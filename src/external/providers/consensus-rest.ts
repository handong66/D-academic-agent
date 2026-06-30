import { z } from "zod";
import type { ExternalEvidenceCard, ExternalPaper } from "../types.js";
import type { FetchLike } from "./scite-auth.js";

export interface ConsensusRestConfig {
  baseURL: string;
  apiKey: string;
}

export interface ConsensusRestDeps {
  fetch: FetchLike;
}

const ConsensusStudyTypeKeywordValues = [
  "case report",
  "literature review",
  "meta-analysis",
  "non-rct experimental",
  "non-rct in vitro",
  "non-rct observational study",
  "rct",
  "systematic review",
  "animal",
] as const;

const ConsensusStudyTypeKeywordSchema = z.enum(ConsensusStudyTypeKeywordValues);

export type ConsensusStudyTypeKeyword = z.infer<typeof ConsensusStudyTypeKeywordSchema>;

export const ConsensusQuickSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    year_min: z.number().int().nonnegative().optional(),
    year_max: z.number().int().nonnegative().optional(),
    sample_size_min: z.number().int().nonnegative().optional(),
    duration_min: z.number().int().nonnegative().optional(),
    duration_max: z.number().int().nonnegative().optional(),
    sjr_max: z.number().int().min(1).max(4).optional(),
    study_types: z.array(ConsensusStudyTypeKeywordSchema).optional(),
    human: z.boolean().optional(),
    exclude_preprints: z.boolean().optional(),
    medical_mode: z.boolean().optional(),
  })
  .strict();

type ConsensusQuickSearchInput = z.infer<typeof ConsensusQuickSearchInputSchema>;
export type ConsensusQuickSearchOptions = Omit<ConsensusQuickSearchInput, "query">;

export const ConsensusQueryResultSchema = z
  .object({
    abstract: z.string(),
    authors: z.array(z.string()),
    doi: z.string(),
    journal_name: z.string(),
    pages: z.string(),
    publish_year: z.number().int(),
    title: z.string(),
    url: z.string(),
    volume: z.string(),
    citation_count: z.number().int(),
    study_type: z.string().nullable().optional(),
    takeaway: z.string().nullable().optional(),
  })
  .passthrough();

export const ConsensusQuickSearchResponseSchema = z
  .object({
    results: z.array(ConsensusQueryResultSchema),
  })
  .passthrough();

export type ConsensusQueryResult = z.infer<typeof ConsensusQueryResultSchema>;
export type ConsensusQuickSearchResponse = z.infer<typeof ConsensusQuickSearchResponseSchema>;

export interface ConsensusRest {
  quickSearch: (query: string, opts?: ConsensusQuickSearchOptions) => Promise<ConsensusQuickSearchResponse>;
}

const MAX_429_TRIES = 3;
const MAX_RETRY_DELAY_MS = 10_000;

function endpoint(baseURL: string, path: string): URL {
  return new URL(path.replace(/^\//, ""), baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    accept: "application/json",
    "x-api-key": apiKey,
  };
}

function retryAfterMs(value: string | null): number {
  if (value === null) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return 0;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithBounded429Retry(deps: ConsensusRestDeps, url: URL, init: RequestInit): Promise<Response> {
  let attempts = 0;
  let plannedDelay = 0;

  while (attempts < MAX_429_TRIES) {
    attempts += 1;
    const response = await deps.fetch(url, init);
    if (response.status !== 429) {
      return response;
    }

    const delay = retryAfterMs(response.headers.get("retry-after"));
    if (attempts >= MAX_429_TRIES || plannedDelay + delay > MAX_RETRY_DELAY_MS) {
      return response;
    }
    plannedDelay += delay;
    await sleep(delay);
  }

  throw new Error("Consensus request retry loop ended unexpectedly");
}

function zodIssueSuffix(issue: z.ZodIssue | undefined): string {
  if (issue === undefined) return "";
  const path = issue.path.join(".");
  return path.length === 0 ? `: ${issue.message}` : `: ${path} ${issue.message}`;
}

async function parseJsonResponse<S extends z.ZodTypeAny>(response: Response, schema: S, label: string): Promise<z.output<S>> {
  if (!response.ok) {
    throw new Error(`Consensus ${label} request failed with HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Consensus ${label} response was not valid JSON`);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid consensus ${label} response${zodIssueSuffix(parsed.error.issues[0])}`);
  }
  return parsed.data;
}

function parseQuickSearchInput(query: string, opts: ConsensusQuickSearchOptions): ConsensusQuickSearchInput {
  const parsed = ConsensusQuickSearchInputSchema.safeParse({ query, ...opts });
  if (!parsed.success) {
    throw new Error(`Invalid consensus quick_search input${zodIssueSuffix(parsed.error.issues[0])}`);
  }
  return parsed.data;
}

function appendNumberParam(url: URL, name: string, value: number | undefined): void {
  if (value === undefined) return;
  url.searchParams.set(name, String(value));
}

function appendBooleanParam(url: URL, name: string, value: boolean | undefined): void {
  if (value === undefined) return;
  url.searchParams.set(name, String(value));
}

function appendStudyTypes(url: URL, values: ConsensusStudyTypeKeyword[] | undefined): void {
  if (values === undefined) return;
  for (const value of values) {
    url.searchParams.append("study_types", value);
  }
}

function buildQuickSearchUrl(baseURL: string, input: ConsensusQuickSearchInput): URL {
  const url = endpoint(baseURL, "/v1/quick_search");
  url.searchParams.set("query", input.query);
  appendNumberParam(url, "year_min", input.year_min);
  appendNumberParam(url, "year_max", input.year_max);
  appendStudyTypes(url, input.study_types);
  appendBooleanParam(url, "human", input.human);
  appendNumberParam(url, "sample_size_min", input.sample_size_min);
  appendNumberParam(url, "sjr_max", input.sjr_max);
  appendNumberParam(url, "duration_min", input.duration_min);
  appendNumberParam(url, "duration_max", input.duration_max);
  appendBooleanParam(url, "exclude_preprints", input.exclude_preprints);
  appendBooleanParam(url, "medical_mode", input.medical_mode);
  return url;
}

export function createConsensusRest(config: ConsensusRestConfig, deps: ConsensusRestDeps): ConsensusRest {
  const apiKey = config.apiKey.trim();
  if (apiKey.length === 0) {
    throw new Error("Consensus apiKey must not be blank");
  }

  return {
    async quickSearch(query: string, opts: ConsensusQuickSearchOptions = {}): Promise<ConsensusQuickSearchResponse> {
      // async so synchronous input-validation throws surface as promise rejections (the caller contract)
      const input = parseQuickSearchInput(query, opts);
      const url = buildQuickSearchUrl(config.baseURL, input);
      return fetchWithBounded429Retry(deps, url, {
        method: "GET",
        headers: authHeaders(apiKey),
      }).then((response) => parseJsonResponse(response, ConsensusQuickSearchResponseSchema, "quick_search"));
    },
  };
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function presentAuthors(authors: string[]): string[] {
  return authors.map(present).filter((name): name is string => name !== undefined);
}

export function mapConsensusResultToExternalPaper(result: ConsensusQueryResult): ExternalPaper {
  const doi = present(result.doi);
  const studyType = present(result.study_type);
  return {
    provider: "consensus",
    ...(doi === undefined ? {} : { doi }),
    title: present(result.title) ?? doi ?? "Untitled consensus result",
    authors: presentAuthors(result.authors),
    year: result.publish_year,
    ...(present(result.journal_name) === undefined ? {} : { journal: present(result.journal_name) }),
    ...(present(result.abstract) === undefined ? {} : { abstract: present(result.abstract) }),
    ...(present(result.url) === undefined ? {} : { url: present(result.url) }),
    citationCount: result.citation_count,
    ...(studyType === undefined ? {} : { qualitySignals: { study_type: studyType } }),
  };
}

export function mapConsensusResultToEvidenceCard(result: ConsensusQueryResult): ExternalEvidenceCard | undefined {
  const quote = present(result.takeaway);
  if (quote === undefined) return undefined;

  const paper = mapConsensusResultToExternalPaper(result);
  return {
    provider: "consensus",
    paper,
    quote,
    relation: "mentions",
    ...(paper.doi === undefined ? {} : { sourceDoi: paper.doi }),
  };
}
