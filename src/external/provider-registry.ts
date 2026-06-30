import type { ExternalHttpProviderConfig, ExternalMcpProviderConfig, ExternalResearchConfig } from "../providers/config.js";
import type { ExternalProviderId, ExternalResearchCapability } from "./types.js";

export type ExternalProviderConfig = ExternalMcpProviderConfig | ExternalHttpProviderConfig;

const EXTERNAL_PROVIDER_IDS = new Set<ExternalProviderId>(["scite", "consensus", "consensus-mcp"]);

const EXTERNAL_RESEARCH_CAPABILITIES = new Set<ExternalResearchCapability>([
  "paper_search",
  "paper_metadata",
  "full_text_excerpts",
  "citation_contexts",
  "citation_polarity",
  "editorial_notices",
  "study_snapshot",
  "consensus_meter",
  "reference_health",
]);

function isExternalResearchCapability(value: string): value is ExternalResearchCapability {
  return EXTERNAL_RESEARCH_CAPABILITIES.has(value as ExternalResearchCapability);
}

export function isExternalProviderId(value: string): value is ExternalProviderId {
  return EXTERNAL_PROVIDER_IDS.has(value as ExternalProviderId);
}

export function enabledProviders(cfg: ExternalResearchConfig): ExternalProviderConfig[] {
  return [...cfg.mcpProviders, ...cfg.httpProviders].filter((provider) => provider.enabled);
}

export function providerById(cfg: ExternalResearchConfig, id: ExternalProviderId): ExternalProviderConfig | undefined {
  return [...cfg.mcpProviders, ...cfg.httpProviders].find((provider) => provider.id === id);
}

export function declaredCapabilities(providerCfg: Pick<ExternalProviderConfig, "capabilities">): ExternalResearchCapability[] {
  return providerCfg.capabilities.filter(isExternalResearchCapability);
}
