import { z } from "zod";
import {
  SciteTallySchema,
  type ExternalEvidenceCard,
  type ExternalPaper,
  type ReferenceEditorialNotice,
  type ReferenceExternalSignal,
  type ReferenceExternalSignalRisk,
  type SciteTally,
} from "../types.js";
import type { FetchLike } from "./scite-auth.js";

export interface SciteRestConfig {
  baseURL: string;
  token?: string;
}

export interface SciteRestDeps {
  fetch: FetchLike;
}

// Egress allowlist: the only opts that may leave the process on a scite search are these
// named pagination params. .strict() rejects any other field so nothing can be smuggled
// into the outbound URL beyond the query + these (mirrors the Consensus .strict input schema).
export const SciteSearchOptionsSchema = z
  .object({
    limit: z.number().int().optional(),
    offset: z.number().int().optional(),
    page: z.number().int().optional(),
  })
  .strict();

export type SciteSearchOptions = z.infer<typeof SciteSearchOptionsSchema>;

const nullableString = z.string().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();
const nullableNumber = z.number().nullable().optional();

const SciteAuthorSchema = z
  .union([
    z.string(),
    z
      .object({
        name: nullableString,
        fullName: nullableString,
        first: nullableString,
        last: nullableString,
        given: nullableString,
        family: nullableString,
      })
      .passthrough(),
  ])
  .optional();

export const SciteEditorialNoticeSchema = z
  .object({
    status: nullableString,
    date: nullableString,
    noticeDoi: nullableString,
    urls: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

const CitationSearchSchema = z.object({ doi: nullableString }).passthrough();

export const SciteSearchHitSchema = z
  .object({
    id: nullableString,
    doi: nullableString,
    title: nullableString,
    slug: nullableString,
    authors: z.array(SciteAuthorSchema).nullable().optional(),
    journal: nullableString,
    shortJournal: nullableString,
    publisher: nullableString,
    memberId: nullableInteger,
    abstract: nullableString,
    year: nullableInteger,
    date: nullableString,
    lastUpdate: nullableInteger,
    volume: nullableString,
    issue: nullableString,
    page: nullableString,
    tally: SciteTallySchema.nullable().optional(),
    issns: z.array(z.string()).nullable().optional(),
    editorialNotices: z.array(SciteEditorialNoticeSchema).default([]),
    normalizedTypes: z.array(z.string()).default([]),
    isOa: z.boolean().default(false),
    oaStatus: z.string().default("closed"),
    meshTypes: z.array(z.unknown()).default([]),
    relevancyScore: nullableNumber,
    citations: z.array(CitationSearchSchema).default([]),
    fulltextExcerpts: z.array(z.string()).default([]),
    highlightedFields: z.array(z.string()).default([]),
  })
  .passthrough();

export const SciteSearchResultsResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
    countIsApproximate: z.boolean().default(false),
    aggregations: z.record(z.unknown()),
    hits: z.array(SciteSearchHitSchema),
    suggestedTerm: nullableString,
    restrictedCites: z.boolean().default(false),
  })
  .passthrough();

export const ScitePaperResponseSchema = z
  .object({
    abstract: nullableString,
    authors: z.array(SciteAuthorSchema).nullable().optional(),
    doi: nullableString,
    editorialNotices: z.array(SciteEditorialNoticeSchema).default([]),
    id: nullableString,
    issns: z.array(z.string()).nullable().optional(),
    issue: nullableString,
    journal: nullableString,
    journalSlug: nullableString,
    keywords: z.array(z.string()).nullable().optional(),
    memberId: nullableInteger,
    normalizedTypes: z.array(z.string()).default([]),
    page: nullableString,
    preprintLinks: z.array(z.unknown()).default([]),
    publicationLinks: z.array(z.unknown()).default([]),
    publisher: nullableString,
    retracted: z.boolean().nullable().optional(),
    shortJournal: nullableString,
    slug: nullableString,
    title: nullableString,
    type: nullableString,
    volume: nullableString,
    year: nullableInteger,
  })
  .passthrough();

const SciteAggregateTalliesResponseSchema = z.union([
  z.array(SciteTallySchema),
  z.record(SciteTallySchema),
  z.object({ tallies: z.array(SciteTallySchema) }).passthrough(),
]);

export type SciteSearchHit = z.infer<typeof SciteSearchHitSchema>;
export type SciteSearchResultsResponse = z.infer<typeof SciteSearchResultsResponseSchema>;
export type ScitePaperResponse = z.infer<typeof ScitePaperResponseSchema>;
type SciteAggregateTalliesResponse = z.infer<typeof SciteAggregateTalliesResponseSchema>;

export interface SciteRest {
  getPaper: (doi: string) => Promise<ScitePaperResponse>;
  getTally: (doi: string) => Promise<SciteTally>;
  aggregateTallies: (dois: string[]) => Promise<SciteTally[]>;
  search: (query: string, opts?: SciteSearchOptions) => Promise<SciteSearchResultsResponse>;
}

const MAX_429_TRIES = 3;
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_SEARCH_QUERY_LENGTH = 1_000;

function endpoint(baseURL: string, path: string): URL {
  return new URL(path.replace(/^\//, ""), baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
}

function authHeaders(token: string | undefined, contentType?: string): Record<string, string> {
  return {
    accept: "application/json",
    ...(contentType === undefined ? {} : { "content-type": contentType }),
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
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

async function fetchWithBounded429Retry(deps: SciteRestDeps, url: URL, init: RequestInit): Promise<Response> {
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

  throw new Error("Scite request retry loop ended unexpectedly");
}

async function parseJsonResponse<S extends z.ZodTypeAny>(response: Response, schema: S, label: string): Promise<z.output<S>> {
  if (!response.ok) {
    throw new Error(`Scite ${label} request failed with HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Scite ${label} response was not valid JSON`);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const suffix = issue === undefined ? "" : `: ${issue.path.join(".")} ${issue.message}`.trimEnd();
    throw new Error(`Invalid scite ${label} response${suffix}`);
  }
  return parsed.data;
}

function appendIntParam(url: URL, name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Scite search option "${name}" must be a non-negative integer`);
  }
  url.searchParams.set(name, String(value));
}

async function requestJson<S extends z.ZodTypeAny>(
  config: SciteRestConfig,
  deps: SciteRestDeps,
  path: string,
  label: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.output<S>> {
  const url = endpoint(config.baseURL, path);
  const response = await fetchWithBounded429Retry(deps, url, {
    ...init,
    headers: {
      ...authHeaders(config.token, init.body === undefined ? undefined : "application/json"),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  return parseJsonResponse(response, schema, label);
}

function aggregateTalliesToArray(parsed: SciteAggregateTalliesResponse): SciteTally[] {
  if (Array.isArray(parsed)) return parsed;
  const maybeTallies = (parsed as { tallies?: unknown }).tallies;
  if (Array.isArray(maybeTallies)) return maybeTallies as SciteTally[];
  return Object.values(parsed) as SciteTally[];
}

export function createSciteRest(config: SciteRestConfig, deps: SciteRestDeps): SciteRest {
  return {
    getPaper(doi: string): Promise<ScitePaperResponse> {
      return requestJson(config, deps, `/papers/${encodeURIComponent(doi)}`, "paper", ScitePaperResponseSchema);
    },

    getTally(doi: string): Promise<SciteTally> {
      return requestJson(config, deps, `/tallies/${encodeURIComponent(doi)}`, "tally", SciteTallySchema);
    },

    async aggregateTallies(dois: string[]): Promise<SciteTally[]> {
      if (dois.length > 100) {
        throw new Error("Scite aggregateTallies accepts at most 100 DOIs");
      }
      const parsed = await requestJson(config, deps, "/tallies/aggregate", "aggregate tallies", SciteAggregateTalliesResponseSchema, {
        method: "POST",
        body: JSON.stringify({ dois }),
      });
      return aggregateTalliesToArray(parsed);
    },

    async search(query: string, opts: SciteSearchOptions = {}): Promise<SciteSearchResultsResponse> {
      const parsedOpts = SciteSearchOptionsSchema.safeParse(opts);
      if (!parsedOpts.success) {
        throw new Error(`Invalid scite search options: ${parsedOpts.error.issues[0]?.message ?? "unexpected field"}`);
      }
      const options = parsedOpts.data;
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0) {
        throw new Error("Scite search query must not be empty");
      }
      if (normalizedQuery.length > MAX_SEARCH_QUERY_LENGTH) {
        throw new Error(`Scite search query must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer`);
      }
      const url = endpoint(config.baseURL, "/api_partner/search");
      url.searchParams.set("query", normalizedQuery);
      appendIntParam(url, "limit", options.limit);
      appendIntParam(url, "offset", options.offset);
      appendIntParam(url, "page", options.page);
      return fetchWithBounded429Retry(deps, url, {
        method: "GET",
        headers: authHeaders(config.token),
      }).then((response) => parseJsonResponse(response, SciteSearchResultsResponseSchema, "search"));
    },
  };
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return value === null ? undefined : value;
}

function authorName(author: z.infer<typeof SciteAuthorSchema>): string | undefined {
  if (author === undefined) return undefined;
  if (typeof author === "string") return present(author);
  const record = author as Record<string, unknown>;
  const direct = present(typeof record.name === "string" ? record.name : undefined) ?? present(typeof record.fullName === "string" ? record.fullName : undefined);
  if (direct !== undefined) return direct;

  const first = present(typeof record.first === "string" ? record.first : undefined) ?? present(typeof record.given === "string" ? record.given : undefined);
  const last = present(typeof record.last === "string" ? record.last : undefined) ?? present(typeof record.family === "string" ? record.family : undefined);
  return present([first, last].filter((part): part is string => part !== undefined).join(" "));
}

function mapAuthors(authors: Array<z.infer<typeof SciteAuthorSchema>> | null | undefined): string[] {
  return (authors ?? []).map(authorName).filter((name): name is string => name !== undefined);
}

function doiUrl(doi: string | null | undefined): string | undefined {
  const value = present(doi);
  return value === undefined ? undefined : `https://doi.org/${encodeURIComponent(value)}`;
}

function normalizedNotices(
  notices: z.infer<typeof SciteEditorialNoticeSchema>[],
): ReferenceEditorialNotice[] {
  return notices
    .map((notice) => ({
      ...(present(notice.status) === undefined ? {} : { status: present(notice.status) }),
      ...(present(notice.date) === undefined ? {} : { date: present(notice.date) }),
      ...(present(notice.noticeDoi) === undefined ? {} : { noticeDoi: present(notice.noticeDoi) }),
      ...(notice.urls === undefined || notice.urls === null ? {} : { urls: notice.urls }),
    }))
    .filter((notice) => Object.keys(notice).length > 0);
}

interface ReferenceRiskInput {
  tally?: SciteTally;
  editorialNotices?: ReferenceEditorialNotice[];
  retracted?: boolean;
}

interface ReferenceSignalInput extends ReferenceRiskInput {
  doi?: string;
}

const riskSeverity: Record<ReferenceExternalSignalRisk, number> = {
  unknown: 0,
  ok: 1,
  needs_care: 2,
  risky: 3,
  blocked: 4,
};

function mostSevereRisk(left: ReferenceExternalSignalRisk, right: ReferenceExternalSignalRisk): ReferenceExternalSignalRisk {
  return riskSeverity[left] >= riskSeverity[right] ? left : right;
}

function noticeStatusMatches(notices: ReferenceEditorialNotice[] | undefined, pattern: RegExp): boolean {
  return (notices ?? []).some((notice) => pattern.test(notice.status ?? ""));
}

function tallyRisk(tally: SciteTally | undefined): ReferenceExternalSignalRisk {
  if (tally === undefined) return "unknown";
  const considered = Math.max(tally.supporting + tally.contradicting + tally.mentioning, 1);
  const pushbackRatio = tally.contradicting / considered;
  if (pushbackRatio >= 0.4) return "risky";
  if (pushbackRatio >= 0.2) return "needs_care";
  return "ok";
}

function noticeRisk(input: ReferenceRiskInput): ReferenceExternalSignalRisk {
  const notices = input.editorialNotices ?? [];
  if (input.retracted === true || noticeStatusMatches(notices, /retract/i)) return "blocked";
  if (noticeStatusMatches(notices, /concern|withdraw/i)) return "risky";
  if (notices.length > 0) return "needs_care";
  return "unknown";
}

export function classifyReferenceRisk(input: ReferenceRiskInput): ReferenceExternalSignalRisk {
  return mostSevereRisk(tallyRisk(input.tally), noticeRisk(input));
}

export function buildReferenceSignal(input: ReferenceSignalInput): ReferenceExternalSignal {
  const notices = input.editorialNotices ?? [];
  const noticeRetracted = noticeStatusMatches(notices, /retract/i);
  const retracted = input.retracted ?? (noticeRetracted ? true : undefined);
  return {
    provider: "scite",
    ...(input.doi === undefined ? {} : { doi: input.doi }),
    ...(input.tally === undefined
      ? {}
      : {
          supportCount: input.tally.supporting,
          pushbackCount: input.tally.contradicting,
          mentionCount: input.tally.mentioning,
          unclassifiedCount: input.tally.unclassified,
          ...(input.tally.citingPublications === undefined ? {} : { citingPublicationCount: input.tally.citingPublications }),
        }),
    ...(notices.length === 0 ? {} : { editorialNotices: notices }),
    ...(retracted === undefined ? {} : { retracted }),
    risk: classifyReferenceRisk({ tally: input.tally, editorialNotices: notices, retracted }),
  };
}

export function mapSciteTallyToReferenceSignal(tally: SciteTally): ReferenceExternalSignal {
  const signal = buildReferenceSignal({ tally, doi: tally.doi });
  return signal.risk === "risky" ? { ...signal, risk: "needs_care" } : signal;
}

export function mapPaperToExternalPaper(paper: ScitePaperResponse): ExternalPaper {
  const doi = present(paper.doi);
  return {
    provider: "scite",
    ...(present(paper.id) === undefined ? {} : { providerPaperId: present(paper.id) }),
    ...(doi === undefined ? {} : { doi }),
    title: present(paper.title) ?? doi ?? "Untitled scite paper",
    authors: mapAuthors(paper.authors),
    ...(numberOrUndefined(paper.year) === undefined ? {} : { year: numberOrUndefined(paper.year) }),
    ...(present(paper.journal) === undefined ? {} : { journal: present(paper.journal) }),
    ...(present(paper.abstract) === undefined ? {} : { abstract: present(paper.abstract) }),
    ...(doiUrl(doi) === undefined ? {} : { url: doiUrl(doi) }),
    qualitySignals: {
      source: "papers",
      editorialNotices: normalizedNotices(paper.editorialNotices),
      ...(paper.retracted === undefined || paper.retracted === null ? {} : { retracted: paper.retracted }),
    },
  };
}

export function mapSearchHitToExternalPaper(hit: SciteSearchHit): ExternalPaper {
  const doi = present(hit.doi);
  const editorialNotices = normalizedNotices(hit.editorialNotices);
  const tally = hit.tally ?? undefined;
  const referenceSignal =
    tally === undefined && editorialNotices.length === 0 ? undefined : buildReferenceSignal({ tally, editorialNotices, doi });
  return {
    provider: "scite",
    ...(present(hit.id) === undefined ? {} : { providerPaperId: present(hit.id) }),
    ...(doi === undefined ? {} : { doi }),
    title: present(hit.title) ?? doi ?? "Untitled scite search result",
    authors: mapAuthors(hit.authors),
    ...(numberOrUndefined(hit.year) === undefined ? {} : { year: numberOrUndefined(hit.year) }),
    ...(present(hit.journal) === undefined ? {} : { journal: present(hit.journal) }),
    ...(present(hit.abstract) === undefined ? {} : { abstract: present(hit.abstract) }),
    ...(doiUrl(doi) === undefined ? {} : { url: doiUrl(doi) }),
    citationCount: hit.citations.length,
    ...(referenceSignal === undefined ? {} : { referenceSignal }),
    qualitySignals: {
      source: "api_partner/search",
      isOa: hit.isOa,
      oaStatus: hit.oaStatus,
      relevancyScore: hit.relevancyScore,
    },
  };
}

export function mapSearchHitToEvidenceCards(hit: SciteSearchHit): ExternalEvidenceCard[] {
  const paper = mapSearchHitToExternalPaper(hit);
  const editorialNotices = normalizedNotices(hit.editorialNotices);
  const noticePayload = editorialNotices.length === 0 ? undefined : editorialNotices;
  const excerptCards = hit.fulltextExcerpts
    .map(present)
    .filter((quote): quote is string => quote !== undefined)
    .map((quote) => ({
      provider: "scite" as const,
      paper,
      quote,
      relation: "mentions" as const,
      ...(paper.doi === undefined ? {} : { sourceDoi: paper.doi }),
      ...(noticePayload === undefined ? {} : { editorialNotices: noticePayload }),
    }));

  if (noticePayload === undefined) {
    return excerptCards;
  }

  return [
    ...excerptCards,
    {
      provider: "scite",
      paper,
      relation: "unclear",
      ...(paper.doi === undefined ? {} : { sourceDoi: paper.doi }),
      editorialNotices: noticePayload,
    },
  ];
}
