import { declaredCapabilities, type ExternalProviderConfig } from "./provider-registry.js";
import type { ExternalProviderStatus, ExternalSearchResult, ReferenceEditorialNotice, ReferenceExternalSignal, SciteTally } from "./types.js";
import { createConsensusRest, mapConsensusResultToEvidenceCard, mapConsensusResultToExternalPaper } from "./providers/consensus-rest.js";
import type { ConsensusQuickSearchOptions } from "./providers/consensus-rest.js";
import { createSciteTokenCache } from "./providers/scite-auth.js";
import type { FetchLike } from "./providers/scite-auth.js";
import { buildReferenceSignal, createSciteRest, mapSearchHitToEvidenceCards, mapSearchHitToExternalPaper } from "./providers/scite-rest.js";
import type { ScitePaperResponse, SciteSearchOptions } from "./providers/scite-rest.js";

export type ExternalSearchOptions = Record<string, unknown>;

export interface ExternalProviderHandle {
  status: ExternalProviderStatus;
  search?: (query: string, opts?: ExternalSearchOptions) => Promise<ExternalSearchResult>;
  referenceHealth?: (dois: string[]) => Promise<ReferenceExternalSignal[]>;
}

export interface ExternalProviderFactoryDeps {
  fetch: FetchLike;
}

function baseStatus(providerCfg: ExternalProviderConfig, connected: boolean): ExternalProviderStatus {
  return {
    id: providerCfg.id,
    enabled: providerCfg.enabled,
    connected,
    capabilities: declaredCapabilities(providerCfg),
  };
}

function secretValue(secrets: Record<string, string>, keyRef: string): string | undefined {
  const value = secrets[keyRef];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}

const MAX_REFERENCE_HEALTH_DOIS = 100;
const MAX_REFERENCE_HEALTH_PAPER_CONCURRENCY = 5;

function uniqueCappedDois(dois: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const doi of dois) {
    const normalized = doi.trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= MAX_REFERENCE_HEALTH_DOIS) break;
  }
  return unique;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function mapWithConcurrency<T, U>(items: T[], limit: number, fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  if (items.length === 0) return [];
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function tallyMap(tallies: SciteTally[]): Map<string, SciteTally> {
  const out = new Map<string, SciteTally>();
  for (const tally of tallies) {
    if (tally.doi !== undefined) out.set(tally.doi, tally);
  }
  return out;
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function normalizePaperNotices(notices: ScitePaperResponse["editorialNotices"] | undefined): ReferenceEditorialNotice[] | undefined {
  const normalized = (notices ?? [])
    .map((notice) => ({
      ...(present(notice.status) === undefined ? {} : { status: present(notice.status) }),
      ...(present(notice.date) === undefined ? {} : { date: present(notice.date) }),
      ...(present(notice.noticeDoi) === undefined ? {} : { noticeDoi: present(notice.noticeDoi) }),
      ...(notice.urls === undefined || notice.urls === null ? {} : { urls: notice.urls }),
    }))
    .filter((notice) => Object.keys(notice).length > 0);
  return normalized.length === 0 ? undefined : normalized;
}

export function buildExternalProvider(
  providerCfg: ExternalProviderConfig,
  secrets: Record<string, string>,
  deps: ExternalProviderFactoryDeps,
): ExternalProviderHandle {
  if (
    providerCfg.id === "scite" &&
    "transport" in providerCfg &&
    providerCfg.transport.kind === "streamable-http" &&
    providerCfg.transport.auth.type === "scite-client-credentials"
  ) {
    const { clientIdKeyRef, clientSecretKeyRef } = providerCfg.transport.auth;
    const clientId = secretValue(secrets, clientIdKeyRef);
    const clientSecret = secretValue(secrets, clientSecretKeyRef);
    const connected = clientId !== undefined && clientSecret !== undefined;

    if (!connected) {
      return { status: baseStatus(providerCfg, false) };
    }

    const baseURL = new URL(providerCfg.transport.url).origin;
    const cache = createSciteTokenCache({ clientId, clientSecret, baseURL }, { fetch: deps.fetch, now: Date.now });
    return {
      status: baseStatus(providerCfg, true),
      search: async (query: string, opts?: ExternalSearchOptions): Promise<ExternalSearchResult> => {
        const token = await cache.getToken();
        const response = await createSciteRest({ baseURL, token }, { fetch: deps.fetch }).search(query, opts as SciteSearchOptions);
        return {
          provider: "scite",
          papers: response.hits.map(mapSearchHitToExternalPaper),
          evidence: response.hits.flatMap(mapSearchHitToEvidenceCards),
        };
      },
      referenceHealth: async (inputDois: string[]): Promise<ReferenceExternalSignal[]> => {
        const dois = uniqueCappedDois(inputDois);
        if (dois.length === 0) return [];

        const token = await cache.getToken();
        const rest = createSciteRest({ baseURL, token }, { fetch: deps.fetch });
        const tallyBatches = await Promise.all(chunks(dois, MAX_REFERENCE_HEALTH_DOIS).map((chunk) => rest.aggregateTallies(chunk)));
        const talliesByDoi = tallyMap(tallyBatches.flat());
        const papers = await mapWithConcurrency<string, ScitePaperResponse | undefined>(
          dois,
          MAX_REFERENCE_HEALTH_PAPER_CONCURRENCY,
          async (doi) => {
            try {
              return await rest.getPaper(doi);
            } catch {
              return undefined;
            }
          },
        );

        return dois.map((doi, index) => {
          const paper = papers[index];
          return buildReferenceSignal({
            tally: talliesByDoi.get(doi),
            editorialNotices: normalizePaperNotices(paper?.editorialNotices),
            retracted: paper?.retracted ?? undefined,
            doi,
          });
        });
      },
    };
  }

  if (providerCfg.id === "consensus" && "auth" in providerCfg && providerCfg.auth.type === "api-key-header") {
    const apiKey = secretValue(secrets, providerCfg.auth.keyRef);
    if (apiKey === undefined) {
      return { status: baseStatus(providerCfg, false) };
    }

    const rest = createConsensusRest({ baseURL: providerCfg.baseURL, apiKey }, { fetch: deps.fetch });
    return {
      status: baseStatus(providerCfg, true),
      search: async (query: string, opts?: ExternalSearchOptions): Promise<ExternalSearchResult> => {
        const response = await rest.quickSearch(query, opts as ConsensusQuickSearchOptions);
        return {
          provider: "consensus",
          papers: response.results.map(mapConsensusResultToExternalPaper),
          evidence: response.results
            .map(mapConsensusResultToEvidenceCard)
            .filter((card): card is NonNullable<typeof card> => card !== undefined),
        };
      },
    };
  }

  return { status: baseStatus(providerCfg, false) };
}
