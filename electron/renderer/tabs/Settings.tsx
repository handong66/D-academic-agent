import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  AppConfig,
  EmbedderConfig,
  ExternalHttpProviderConfig,
  ExternalMcpProviderConfig,
  ExternalResearchConfig,
  JudgeConfig,
  PdfConfig,
} from "../../../src/providers/config.js";
import {
  embedderProviders,
  judgeProviders,
  pdfProviders,
  type ProviderDescriptor,
} from "../../../src/providers/registry.js";
import { getLocalModel, MODEL_REGISTRY, NLI_MODEL_REGISTRY, type LocalModel, type NliModelEntry } from "../../../src/providers/model-registry.js";
import { setLang, useLang, useT, type Lang } from "../i18n";
import { friendlyErrorMessage, modelChoiceHelpKey, modelChoiceLabelKey, providerChoiceHelpKey, providerChoiceLabelKey } from "../lib";

const API_KEY_REF = "openai-compatible";
const LOCAL_EMBEDDER_PROVIDER = "transformers-local";
const LOCAL_NLI_PROVIDER = "transformers-nli";
const GROBID_PDF_PROVIDER = "grobid";
const GROBID_DEFAULT_BASE_URL = "http://localhost:8070";
const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const OLLAMA_DEFAULT_MODEL = "llama3.1";
const SCITE_CLIENT_ID_KEY_REF = "scite-client-id";
const SCITE_CLIENT_SECRET_KEY_REF = "scite-client-secret";
const CONSENSUS_API_KEY_REF = "consensus-api-key";
const CONSENSUS_MCP_TOKEN_KEY_REF = "consensus-mcp-token";
const CONSENSUS_MCP_DEFAULT_URL = "https://mcp.consensus.app/mcp";
const CONSENSUS_MCP_DEFAULT_SCOPES = "search";

const fieldStyle: CSSProperties = {
  width: "100%",
  minHeight: 38,
  border: "1px solid var(--line)",
  borderRadius: "var(--r-md)",
  background: "var(--surface)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 13,
  outline: "none",
  padding: "8px 10px",
};

const styles: Record<string, CSSProperties> = {
  body: {
    display: "grid",
    gap: 18,
    overflow: "auto",
    padding: 18,
  },
  statusCluster: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8,
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 28,
    borderRadius: 999,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontSize: 12,
    fontWeight: 800,
    padding: "4px 10px",
    whiteSpace: "nowrap",
  },
  statusPillOffline: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 28,
    borderRadius: 999,
    background: "var(--support-bg)",
    color: "var(--support)",
    fontSize: 12,
    fontWeight: 800,
    padding: "4px 10px",
    whiteSpace: "nowrap",
  },
  statusPillWarning: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 28,
    borderRadius: 999,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12,
    fontWeight: 800,
    padding: "4px 10px",
    whiteSpace: "nowrap",
  },
  sectionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
    gap: 14,
  },
  externalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
    gap: 14,
  },
  section: {
    display: "grid",
    gap: 14,
    minWidth: 0,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    background: "var(--surface)",
    padding: 16,
  },
  sectionTitle: {
    margin: 0,
    color: "var(--ink)",
    fontSize: 14,
    fontWeight: 780,
    letterSpacing: 0,
  },
  sectionHeadingRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  providerForm: {
    display: "grid",
    gap: 12,
    minWidth: 0,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    padding: "12px",
  },
  providerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  providerTitle: {
    margin: 0,
    color: "var(--ink)",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0,
  },
  checkboxField: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    color: "var(--ink-2)",
    fontSize: 12,
    fontWeight: 800,
  },
  fields: {
    display: "grid",
    gap: 12,
  },
  localModelActions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  field: {
    display: "grid",
    gap: 6,
    minWidth: 0,
  },
  label: {
    color: "var(--ink-3)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  hint: {
    margin: 0,
    color: "var(--ink-3)",
    fontSize: 12,
    lineHeight: 1.45,
  },
  details: {
    display: "grid",
    gap: 10,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    padding: "10px 12px",
  },
  statusList: {
    display: "grid",
    gap: 10,
  },
  statusCard: {
    display: "grid",
    gap: 8,
    border: "1px solid var(--line)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    padding: "10px 12px",
  },
  statusCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  capabilityRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  capabilityChip: {
    display: "inline-flex",
    minHeight: 22,
    alignItems: "center",
    borderRadius: 999,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: "2px 8px",
  },
  summary: {
    color: "var(--ink-2)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderTop: "1px solid var(--line)",
    padding: "16px 18px",
  },
  privacy: {
    margin: 0,
    color: "var(--ink-2)",
    fontSize: 13,
    lineHeight: 1.45,
  },
};

type SettingsMessage =
  | { kind: "idle"; key: string; value?: string }
  | { kind: "saving"; key: string; value?: string }
  | { kind: "downloading"; key: string; value?: string }
  | { kind: "success"; key: string; value?: string }
  | { kind: "error"; text: string };

type LocalModelStatus = "present" | "absent";
type LocalModelStatusView = LocalModelStatus | "checking" | "unknown";
type ConsensusMcpOauthFlow = "idle" | "signing-in" | "disconnecting";

type ExternalResearchFormState = {
  sciteEnabled: boolean;
  consensusEnabled: boolean;
  consensusMcpEnabled: boolean;
  sciteClientId: string;
  sciteClientSecret: string;
  consensusApiKey: string;
  consensusMcpUrl: string;
  consensusMcpScopes: string;
};

const emptyExternalResearchForm: ExternalResearchFormState = {
  sciteEnabled: false,
  consensusEnabled: false,
  consensusMcpEnabled: false,
  sciteClientId: "",
  sciteClientSecret: "",
  consensusApiKey: "",
  consensusMcpUrl: CONSENSUS_MCP_DEFAULT_URL,
  consensusMcpScopes: CONSENSUS_MCP_DEFAULT_SCOPES,
};

function sciteProviderConfig(enabled: boolean): ExternalMcpProviderConfig {
  return {
    id: "scite",
    label: "scite",
    enabled,
    allowedTools: ["search_literature"],
    capabilities: ["paper_search", "citation_contexts"],
    transport: {
      kind: "streamable-http",
      url: "https://api.scite.ai/mcp",
      auth: {
        type: "scite-client-credentials",
        clientIdKeyRef: SCITE_CLIENT_ID_KEY_REF,
        clientSecretKeyRef: SCITE_CLIENT_SECRET_KEY_REF,
      },
    },
  };
}

function consensusProviderConfig(enabled: boolean): ExternalHttpProviderConfig {
  return {
    id: "consensus",
    label: "Consensus",
    enabled,
    baseURL: "https://api.consensus.app",
    capabilities: ["paper_search", "study_snapshot"],
    auth: {
      type: "api-key-header",
      header: "x-api-key",
      keyRef: CONSENSUS_API_KEY_REF,
    },
  };
}

function scopeList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function consensusMcpProviderConfig(enabled: boolean, url: string, scopes: string): ExternalMcpProviderConfig {
  return {
    id: "consensus-mcp",
    label: "Consensus (MCP)",
    enabled,
    allowedTools: ["search"],
    capabilities: ["paper_search"],
    transport: {
      kind: "streamable-http",
      url: url.trim(),
      auth: {
        type: "oauth-pkce",
        scopes: scopeList(scopes),
        tokenKeyRef: CONSENSUS_MCP_TOKEN_KEY_REF,
      },
    },
  };
}

function externalResearchFormFromConfig(config: AppConfig): ExternalResearchFormState {
  const externalResearch = config.externalResearch ?? { mcpProviders: [], httpProviders: [] };
  const scite = externalResearch.mcpProviders.find((provider) => provider.id === "scite");
  const consensus = externalResearch.httpProviders.find((provider) => provider.id === "consensus");
  const consensusMcp = externalResearch.mcpProviders.find((provider) => provider.id === "consensus-mcp");
  const consensusMcpTransport = consensusMcp?.transport.kind === "streamable-http" ? consensusMcp.transport : undefined;
  const consensusMcpAuth = consensusMcpTransport?.auth.type === "oauth-pkce" ? consensusMcpTransport.auth : undefined;

  return {
    ...emptyExternalResearchForm,
    sciteEnabled: scite?.enabled ?? false,
    consensusEnabled: consensus?.enabled ?? false,
    consensusMcpEnabled: consensusMcp?.enabled ?? false,
    consensusMcpUrl: consensusMcpTransport?.url ?? CONSENSUS_MCP_DEFAULT_URL,
    consensusMcpScopes: consensusMcpAuth?.scopes.join(" ") ?? CONSENSUS_MCP_DEFAULT_SCOPES,
  };
}

function buildExternalResearchConfig(form: ExternalResearchFormState): ExternalResearchConfig {
  return {
    mcpProviders: [
      sciteProviderConfig(form.sciteEnabled),
      consensusMcpProviderConfig(form.consensusMcpEnabled, form.consensusMcpUrl, form.consensusMcpScopes),
    ],
    httpProviders: [consensusProviderConfig(form.consensusEnabled)],
  };
}

function settingsExternalProviderLabelKey(providerId: HarnessExternalProviderStatus["id"]): string {
  if (providerId === "scite") return "settings.external.provider.scite";
  if (providerId === "consensus-mcp") return "settings.external.provider.consensusMcp";
  return "settings.external.provider.consensus";
}

function providerLocationKey(location: ProviderDescriptor["location"]): string {
  if (location === "builtin") return "settings.provider.builtin";
  if (location === "remote") return "settings.provider.remote";
  return "settings.provider.localDownload";
}

function providerLabel(provider: ProviderDescriptor, t: (key: string) => string): string {
  const suffix = provider.needsKey ? t("settings.provider.keyRequired") : t(providerLocationKey(provider.location));
  return `${t(providerChoiceLabelKey(provider.kind, provider.id))} · ${suffix}`;
}

function firstLocalModel(): LocalModel {
  const model = MODEL_REGISTRY[0];
  if (!model) throw new Error("MODEL_REGISTRY is empty");
  return model;
}

function firstNliModel(): NliModelEntry {
  const model = NLI_MODEL_REGISTRY[0];
  if (!model) throw new Error("NLI_MODEL_REGISTRY is empty");
  return model;
}

function resolveLocalModel(id: string | undefined): LocalModel {
  return (id ? getLocalModel(id) : undefined) ?? firstLocalModel();
}

function resolveNliModel(id: string | undefined): NliModelEntry {
  return (id ? NLI_MODEL_REGISTRY.find((model) => model.id === id) : undefined) ?? firstNliModel();
}

function localModelLabel(model: LocalModel, t: (key: string) => string): string {
  return `${t(modelChoiceLabelKey("embedder", model.id))} · ${model.sizeLabel}`;
}

function nliModelLabel(model: NliModelEntry, t: (key: string) => string): string {
  return `${t(modelChoiceLabelKey("judge", model.id))} · ${model.sizeLabel}`;
}

function localStatusLabel(status: LocalModelStatusView, t: (key: string) => string): string {
  if (status === "checking") return t("common.checking");
  if (status === "unknown") return t("common.unknown");
  if (status === "present") return t("common.present");
  return t("common.absent");
}

function localStatusStyle(status: LocalModelStatusView): CSSProperties {
  if (status === "present") return styles.statusPillOffline!;
  if (status === "absent") return styles.statusPillWarning!;
  return styles.statusPill!;
}

function optionalText(value: string | undefined): string {
  return value ?? "";
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanPositiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeConfig(config: AppConfig, needsKey: boolean): AppConfig {
  const localModel = config.embedder.provider === LOCAL_EMBEDDER_PROVIDER ? resolveLocalModel(config.embedder.model) : undefined;
  const nliModel = config.judge.provider === LOCAL_NLI_PROVIDER ? resolveNliModel(config.judge.model) : undefined;
  const next: AppConfig = {
    embedder: localModel
      ? {
          provider: LOCAL_EMBEDDER_PROVIDER,
          model: localModel.id,
          dim: localModel.dim,
        }
      : {
          provider: config.embedder.provider,
          model: cleanText(config.embedder.model),
          baseURL: cleanText(config.embedder.baseURL),
          dim: cleanPositiveInteger(config.embedder.dim),
        },
    judge: nliModel
      ? {
          provider: LOCAL_NLI_PROVIDER,
          model: nliModel.id,
          baseURL: undefined,
        }
      : {
          provider: config.judge.provider,
          model: cleanText(config.judge.model),
          baseURL: cleanText(config.judge.baseURL),
        },
    pdf: {
      provider: config.pdf.provider,
      baseURL: config.pdf.provider === GROBID_PDF_PROVIDER ? cleanText(config.pdf.baseURL) : undefined,
    },
    corpus: cleanText(config.corpus) ?? "./corpus",
    library: config.library, // install-level path; preserve it so Settings Apply round-trips it
    keyRef: needsKey ? API_KEY_REF : undefined,
    externalResearch: config.externalResearch, // preserve external-provider config untouched (edited in Milestone C)
  };

  return next;
}

function readDim(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function needsKey(config: AppConfig, providers: ProviderDescriptor[]): boolean {
  return providers.some((provider) => {
    if (provider.kind === "embedder") return provider.id === config.embedder.provider && provider.needsKey;
    if (provider.kind === "judge") return provider.id === config.judge.provider && provider.needsKey;
    return provider.id === config.pdf.provider && provider.needsKey;
  });
}

function settingsMessageText(message: SettingsMessage, t: (key: string) => string): string {
  if (message.kind === "error") return message.text;
  if (message.key === "settings.message.downloadingModel") return `${t(message.key)} ${message.value ?? ""}...`;
  if (message.key === "settings.message.modelDownloaded") return `${message.value ?? ""} ${t(message.key)}`;
  return t(message.key);
}

function remoteSelected(config: AppConfig, providers: ProviderDescriptor[]): boolean {
  return providers.some((provider) => {
    if (provider.kind === "embedder") return provider.id === config.embedder.provider && provider.location === "remote";
    if (provider.kind === "judge") return provider.id === config.judge.provider && provider.location === "remote";
    return provider.id === config.pdf.provider && provider.location === "remote";
  });
}

export function SettingsTab() {
  const t = useT();
  const lang = useLang();
  const embedderOptions = useMemo(() => embedderProviders(), []);
  const judgeOptions = useMemo(() => judgeProviders(), []);
  const pdfOptions = useMemo(() => pdfProviders(), []);
  const allProviders = useMemo(
    () => [...embedderOptions, ...judgeOptions, ...pdfOptions],
    [embedderOptions, judgeOptions, pdfOptions],
  );

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [externalForm, setExternalForm] = useState<ExternalResearchFormState>(emptyExternalResearchForm);
  const [externalStatus, setExternalStatus] = useState<HarnessExternalProviderStatus[] | null>(null);
  const [externalStatusChecking, setExternalStatusChecking] = useState(false);
  const [externalStatusError, setExternalStatusError] = useState<string | null>(null);
  const [consensusMcpOauthFlow, setConsensusMcpOauthFlow] = useState<ConsensusMcpOauthFlow>("idle");
  const [consensusMcpOauthStatus, setConsensusMcpOauthStatus] = useState<HarnessExternalProviderStatus | null>(null);
  const [consensusMcpOauthError, setConsensusMcpOauthError] = useState<string | null>(null);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [localStatus, setLocalStatus] = useState<LocalModelStatusView>("unknown");
  const [localStatusError, setLocalStatusError] = useState<string | null>(null);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [nliStatus, setNliStatus] = useState<LocalModelStatusView>("unknown");
  const [nliStatusError, setNliStatusError] = useState<string | null>(null);
  const [downloadingNliModel, setDownloadingNliModel] = useState(false);
  const [message, setMessage] = useState<SettingsMessage>({
    kind: "idle",
    key: "settings.message.loadingCurrentProviderConfig",
  });

  useEffect(() => {
    let cancelled = false;

    void window.harness
      .getConfig()
      .then((currentConfig) => {
        if (cancelled) return;
        setConfig(currentConfig);
        setExternalForm(externalResearchFormFromConfig(currentConfig));
        setMessage({ kind: "idle", key: "settings.message.currentProviderConfigLoaded" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage({ kind: "error", text: friendlyErrorMessage(error, t) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const selectedNeedsKey = config ? needsKey(config, allProviders) : false;
  const selectedRemote = config ? remoteSelected(config, allProviders) : false;
  const localEmbedderSelected = config?.embedder.provider === LOCAL_EMBEDDER_PROVIDER;
  const apiEmbedderSelected = config?.embedder.provider === API_KEY_REF;
  const selectedLocalModel = config && localEmbedderSelected ? resolveLocalModel(config.embedder.model) : undefined;
  const localNliSelected = config?.judge.provider === LOCAL_NLI_PROVIDER;
  const apiJudgeSelected = config?.judge.provider === API_KEY_REF;
  const selectedNliModel = config && localNliSelected ? resolveNliModel(config.judge.model) : undefined;
  const providerMode = selectedRemote ? t("settings.mode.onlineProvider") : t("settings.mode.offline");
  const networkMode = networkOnline ? t("settings.mode.networkOnline") : t("settings.mode.networkOffline");
  const applying = message.kind === "saving";
  const messageText = settingsMessageText(message, t);
  const consensusMcpOauthBusy = consensusMcpOauthFlow !== "idle";

  useEffect(() => {
    if (!localEmbedderSelected || !selectedLocalModel) {
      setLocalStatus("unknown");
      setLocalStatusError(null);
      return;
    }

    let cancelled = false;
    setLocalStatus("checking");
    setLocalStatusError(null);
    void window.harness
      .modelStatus(selectedLocalModel.id)
      .then((status) => {
        if (cancelled) return;
        setLocalStatus(status);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLocalStatus("unknown");
        setLocalStatusError(friendlyErrorMessage(error, t));
      });

    return () => {
      cancelled = true;
    };
  }, [localEmbedderSelected, selectedLocalModel?.id]);

  useEffect(() => {
    if (!localNliSelected || !selectedNliModel) {
      setNliStatus("unknown");
      setNliStatusError(null);
      return;
    }

    let cancelled = false;
    setNliStatus("checking");
    setNliStatusError(null);
    void window.harness
      .modelStatus(selectedNliModel.id)
      .then((status) => {
        if (cancelled) return;
        setNliStatus(status);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNliStatus("unknown");
        setNliStatusError(friendlyErrorMessage(error, t));
      });

    return () => {
      cancelled = true;
    };
  }, [localNliSelected, selectedNliModel?.id]);

  function updateEmbedder(next: Partial<EmbedderConfig>): void {
    setConfig((current) => (current ? { ...current, embedder: { ...current.embedder, ...next } } : current));
    setMessage({ kind: "idle", key: "settings.message.unsavedProviderChanges" });
  }

  function updateEmbedderProvider(provider: string): void {
    if (provider === LOCAL_EMBEDDER_PROVIDER) {
      const model = resolveLocalModel(config?.embedder.model);
      updateEmbedder({ provider, model: model.id, dim: model.dim, baseURL: undefined });
      return;
    }
    updateEmbedder({ provider });
  }

  function updateLocalModel(id: string): void {
    const model = resolveLocalModel(id);
    updateEmbedder({ model: model.id, dim: model.dim, baseURL: undefined });
  }

  function updateJudge(next: Partial<JudgeConfig>): void {
    setConfig((current) => (current ? { ...current, judge: { ...current.judge, ...next } } : current));
    setMessage({ kind: "idle", key: "settings.message.unsavedProviderChanges" });
  }

  function updateJudgeProvider(provider: string): void {
    if (provider === LOCAL_NLI_PROVIDER) {
      const model = resolveNliModel(config?.judge.model);
      updateJudge({ provider, model: model.id, baseURL: undefined });
      return;
    }
    updateJudge({ provider });
  }

  function updateNliModel(id: string): void {
    const model = resolveNliModel(id);
    updateJudge({ model: model.id, baseURL: undefined });
  }

  // Ollama speaks the OpenAI-compatible API, so a local generative judge needs no new provider —
  // just point openai-compatible at localhost:11434 (no key). One click fills that in.
  function applyOllamaPreset(): void {
    updateJudge({ provider: "openai-compatible", baseURL: OLLAMA_BASE_URL, model: OLLAMA_DEFAULT_MODEL });
    setMessage({ kind: "idle", key: "settings.message.ollamaPreset" });
  }

  function updatePdf(next: Partial<PdfConfig>): void {
    setConfig((current) => (current ? { ...current, pdf: { ...current.pdf, ...next } } : current));
    setMessage({ kind: "idle", key: "settings.message.unsavedProviderChanges" });
  }

  function updateCorpus(corpus: string): void {
    setConfig((current) => (current ? { ...current, corpus } : current));
    setMessage({ kind: "idle", key: "settings.message.unsavedProviderChanges" });
  }

  function updateExternalForm(next: Partial<ExternalResearchFormState>): void {
    setExternalForm((current) => ({ ...current, ...next }));
    setExternalStatus(null);
    setExternalStatusError(null);
    setConsensusMcpOauthStatus(null);
    setConsensusMcpOauthError(null);
    setMessage({ kind: "idle", key: "settings.message.unsavedProviderChanges" });
  }

  function upsertExternalStatus(status: HarnessExternalProviderStatus): void {
    setExternalStatus((current) => {
      const statuses = current ?? [];
      if (!statuses.some((candidate) => candidate.id === status.id)) return [...statuses, status];
      return statuses.map((candidate) => (candidate.id === status.id ? status : candidate));
    });
  }

  function clearExternalCredentialFields(): void {
    setExternalForm((current) => ({
      ...current,
      sciteClientId: "",
      sciteClientSecret: "",
      consensusApiKey: "",
    }));
  }

  async function applySettings(): Promise<void> {
    if (!config) return;

    const nextConfig = {
      ...normalizeConfig(config, selectedNeedsKey),
      externalResearch: buildExternalResearchConfig(externalForm),
    };
    const trimmedKey = apiKey.trim();
    const trimmedSciteClientId = externalForm.sciteClientId.trim();
    const trimmedSciteClientSecret = externalForm.sciteClientSecret.trim();
    const trimmedConsensusApiKey = externalForm.consensusApiKey.trim();
    const externalCredentialTyped =
      trimmedSciteClientId.length > 0 || trimmedSciteClientSecret.length > 0 || trimmedConsensusApiKey.length > 0;
    const anyCredentialTyped = trimmedKey.length > 0 || externalCredentialTyped;

    setMessage({ kind: "saving", key: "settings.message.applyingProviderConfig" });
    try {
      if (trimmedKey.length > 0) {
        await window.harness.setKey(API_KEY_REF, trimmedKey);
      }
      if (trimmedSciteClientId.length > 0) {
        await window.harness.setKey(SCITE_CLIENT_ID_KEY_REF, trimmedSciteClientId);
      }
      if (trimmedSciteClientSecret.length > 0) {
        await window.harness.setKey(SCITE_CLIENT_SECRET_KEY_REF, trimmedSciteClientSecret);
      }
      if (trimmedConsensusApiKey.length > 0) {
        await window.harness.setKey(CONSENSUS_API_KEY_REF, trimmedConsensusApiKey);
      }
      if (externalCredentialTyped) clearExternalCredentialFields();
      await window.harness.setConfig(nextConfig);
      setConfig(nextConfig);
      setApiKey("");
      setExternalStatus(null);
      setExternalStatusError(null);
      setMessage({
        kind: "success",
        key: anyCredentialTyped ? "settings.message.settingsAppliedWithSecrets" : "settings.message.settingsApplied",
      });
    } catch (error) {
      if (externalCredentialTyped) clearExternalCredentialFields();
      setMessage({ kind: "error", text: friendlyErrorMessage(error, t) });
    }
  }

  async function persistExternalResearchConfig(): Promise<AppConfig | undefined> {
    if (!config) return undefined;

    const nextConfig = {
      ...normalizeConfig(config, selectedNeedsKey),
      externalResearch: buildExternalResearchConfig(externalForm),
    };
    await window.harness.setConfig(nextConfig);
    setConfig(nextConfig);
    return nextConfig;
  }

  async function signInConsensusMcp(): Promise<void> {
    if (!config || consensusMcpOauthFlow !== "idle") return;

    setConsensusMcpOauthFlow("signing-in");
    setConsensusMcpOauthError(null);
    setExternalStatusError(null);
    setMessage({ kind: "saving", key: "settings.external.oauth.signingIn" });

    try {
      const savedConfig = await persistExternalResearchConfig();
      if (!savedConfig) return;
      const status = await window.harness.oauthSignIn("consensus-mcp");
      setConsensusMcpOauthStatus(status);
      upsertExternalStatus(status);
      setMessage({
        kind: status.connected ? "success" : "idle",
        key: status.connected ? "settings.external.oauth.connected" : "settings.external.oauth.notConnected",
      });
    } catch (error) {
      const text = friendlyErrorMessage(error, t);
      setConsensusMcpOauthStatus(null);
      setConsensusMcpOauthError(text);
      setMessage({ kind: "error", text });
    } finally {
      setConsensusMcpOauthFlow("idle");
    }
  }

  async function disconnectConsensusMcp(): Promise<void> {
    if (!config || consensusMcpOauthFlow !== "idle") return;

    setConsensusMcpOauthFlow("disconnecting");
    setConsensusMcpOauthError(null);
    setExternalStatusError(null);
    setMessage({ kind: "saving", key: "settings.external.oauth.disconnecting" });

    try {
      const status = await window.harness.oauthDisconnect("consensus-mcp");
      setConsensusMcpOauthStatus(status);
      upsertExternalStatus(status);
      setMessage({ kind: "success", key: "settings.external.oauth.disconnected" });
    } catch (error) {
      const text = friendlyErrorMessage(error, t);
      setConsensusMcpOauthError(text);
      setMessage({ kind: "error", text });
    } finally {
      setConsensusMcpOauthFlow("idle");
    }
  }

  async function checkExternalProviders(): Promise<void> {
    setExternalStatusChecking(true);
    setExternalStatusError(null);

    try {
      setExternalStatus(await window.harness.externalProviderStatus());
    } catch (error) {
      setExternalStatus(null);
      setExternalStatusError(friendlyErrorMessage(error, t));
    } finally {
      setExternalStatusChecking(false);
    }
  }

  async function downloadSelectedLocalModel(): Promise<void> {
    if (!selectedLocalModel) return;

    setDownloadingModel(true);
    setLocalStatusError(null);
    setMessage({ kind: "downloading", key: "settings.message.downloadingModel", value: selectedLocalModel.id });
    try {
      await window.harness.downloadModel(selectedLocalModel.id);
      const status = await window.harness.modelStatus(selectedLocalModel.id);
      setLocalStatus(status);
      setMessage({ kind: "success", key: "settings.message.modelDownloaded", value: selectedLocalModel.id });
    } catch (error) {
      setMessage({ kind: "error", text: friendlyErrorMessage(error, t) });
    } finally {
      setDownloadingModel(false);
    }
  }

  async function downloadSelectedNliModel(): Promise<void> {
    if (!selectedNliModel) return;

    setDownloadingNliModel(true);
    setNliStatusError(null);
    setMessage({ kind: "downloading", key: "settings.message.downloadingModel", value: selectedNliModel.id });
    try {
      await window.harness.downloadModel(selectedNliModel.id);
      const status = await window.harness.modelStatus(selectedNliModel.id);
      setNliStatus(status);
      setMessage({ kind: "success", key: "settings.message.modelDownloaded", value: selectedNliModel.id });
    } catch (error) {
      setMessage({ kind: "error", text: friendlyErrorMessage(error, t) });
    } finally {
      setDownloadingNliModel(false);
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="settings-title">
      <header className="workspace-header">
        <div>
          <h2 id="settings-title" className="workspace-title">
            {t("settings.title")}
          </h2>
          <p className="workspace-kicker">{t("settings.kicker")}</p>
        </div>
        <div style={styles.statusCluster}>
          <span style={selectedRemote ? styles.statusPill : styles.statusPillOffline}>{providerMode}</span>
          <span style={networkOnline ? styles.statusPill : styles.statusPillOffline}>{networkMode}</span>
        </div>
      </header>

      {message.kind === "error" ? <div className="error-banner">{message.text}</div> : null}

      <div style={styles.body}>
        <section style={styles.section} aria-label={t("settings.language")}>
          <label style={styles.field}>
            <span style={styles.label}>{t("settings.language")}</span>
            <select style={fieldStyle} value={lang} onChange={(event) => setLang(event.currentTarget.value as Lang)}>
              <option value="en">{t("settings.languageEnglish")}</option>
              <option value="zh">{t("settings.languageChinese")}</option>
            </select>
          </label>
        </section>

        {config ? (
          <>
            <div style={styles.sectionGrid}>
              <section style={styles.section} aria-label={t("settings.aria.embedderProviderSettings")}>
                <h3 style={styles.sectionTitle}>{t("settings.embedder")}</h3>
                <div style={styles.fields}>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("common.provider")}</span>
                    <select
                      style={fieldStyle}
                      value={config.embedder.provider}
                      onChange={(event) => updateEmbedderProvider(event.currentTarget.value)}
                    >
                      {embedderOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {providerLabel(provider, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p style={styles.hint}>{t(providerChoiceHelpKey("embedder", config.embedder.provider))}</p>
                  {localEmbedderSelected && selectedLocalModel ? (
                    <>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.model")}</span>
                        <select style={fieldStyle} value={selectedLocalModel.id} onChange={(event) => updateLocalModel(event.currentTarget.value)}>
                          {MODEL_REGISTRY.map((model) => (
                            <option key={model.id} value={model.id}>
                              {localModelLabel(model, t)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p style={styles.hint}>{t(modelChoiceHelpKey("embedder", selectedLocalModel.id))}</p>
                      <div style={styles.localModelActions}>
                        <span style={localStatusStyle(localStatus)}>
                          {t("common.status")} {localStatusLabel(localStatus, t)}
                        </span>
                        <button className="action-button" type="button" onClick={() => void downloadSelectedLocalModel()} disabled={downloadingModel || localStatus === "checking"}>
                          {downloadingModel ? t("common.downloadingDots") : t("common.download")}
                        </button>
                      </div>
                      {localStatusError ? <p style={styles.hint}>{t("common.statusCheckFailed")} {localStatusError}</p> : null}
                      <p style={styles.hint}>{t("settings.reindexHint")}</p>
                    </>
                  ) : apiEmbedderSelected ? (
                    <>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.model")}</span>
                        <input
                          style={fieldStyle}
                          value={optionalText(config.embedder.model)}
                          onChange={(event) => updateEmbedder({ model: event.currentTarget.value || undefined })}
                          placeholder={t("settings.placeholder.embeddingModel")}
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.baseUrl")}</span>
                        <input
                          style={fieldStyle}
                          value={optionalText(config.embedder.baseURL)}
                          onChange={(event) => updateEmbedder({ baseURL: event.currentTarget.value || undefined })}
                          placeholder={t("settings.placeholder.openaiBaseUrl")}
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.dimensions")}</span>
                        <input
                          style={fieldStyle}
                          min={1}
                          step={1}
                          type="number"
                          value={config.embedder.dim ?? ""}
                          onChange={(event) => updateEmbedder({ dim: readDim(event.currentTarget.value) })}
                          placeholder={t("settings.placeholder.dimensions")}
                        />
                      </label>
                      <p style={styles.hint}>{t("settings.remoteEmbedderHint")}</p>
                    </>
                  ) : null}
                </div>
              </section>

              <section style={styles.section} aria-label={t("settings.aria.judgeProviderSettings")}>
                <h3 style={styles.sectionTitle}>{t("settings.judge")}</h3>
                <div style={styles.fields}>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("common.provider")}</span>
                    <select
                      style={fieldStyle}
                      value={config.judge.provider}
                      onChange={(event) => updateJudgeProvider(event.currentTarget.value)}
                    >
                      {judgeOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {providerLabel(provider, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p style={styles.hint}>{t(providerChoiceHelpKey("judge", config.judge.provider))}</p>
                  {localNliSelected && selectedNliModel ? (
                    <>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.model")}</span>
                        <select style={fieldStyle} value={selectedNliModel.id} onChange={(event) => updateNliModel(event.currentTarget.value)}>
                          {NLI_MODEL_REGISTRY.map((model) => (
                            <option key={model.id} value={model.id}>
                              {nliModelLabel(model, t)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p style={styles.hint}>{t(modelChoiceHelpKey("judge", selectedNliModel.id))}</p>
                      <div style={styles.localModelActions}>
                        <span style={localStatusStyle(nliStatus)}>
                          {t("common.status")} {localStatusLabel(nliStatus, t)}
                        </span>
                        <button className="action-button" type="button" onClick={() => void downloadSelectedNliModel()} disabled={downloadingNliModel || nliStatus === "checking"}>
                          {downloadingNliModel ? t("common.downloadingDots") : t("common.download")}
                        </button>
                      </div>
                      {nliStatusError ? <p style={styles.hint}>{t("common.statusCheckFailed")} {nliStatusError}</p> : null}
                    </>
                  ) : apiJudgeSelected ? (
                    <>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.model")}</span>
                        <input
                          style={fieldStyle}
                          value={optionalText(config.judge.model)}
                          onChange={(event) => updateJudge({ model: event.currentTarget.value || undefined })}
                          placeholder={t("settings.placeholder.judgeModel")}
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("common.baseUrl")}</span>
                        <input
                          style={fieldStyle}
                          value={optionalText(config.judge.baseURL)}
                          onChange={(event) => updateJudge({ baseURL: event.currentTarget.value || undefined })}
                          placeholder={t("settings.placeholder.openaiBaseUrl")}
                        />
                      </label>
                      <p style={styles.hint}>{t("settings.remoteJudgeHint")}</p>
                      <button type="button" className="action-button" onClick={applyOllamaPreset}>
                        {t("settings.useLocalOllama")}
                      </button>
                      <p style={styles.hint}>
                        {t("settings.ollamaHintBefore")} <code>ollama serve</code> {t("settings.ollamaHintPlus")} <code>ollama pull llama3.1</code>
                        {t("settings.ollamaHintAfter")}
                      </p>
                    </>
                  ) : null}
                </div>
              </section>

              <section style={styles.section} aria-label={t("settings.aria.pdfCorpusSettings")}>
                <h3 style={styles.sectionTitle}>{t("settings.pdfCorpus")}</h3>
                <div style={styles.fields}>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("settings.pdfProvider")}</span>
                    <select style={fieldStyle} value={config.pdf.provider} onChange={(event) => updatePdf({ provider: event.currentTarget.value })}>
                      {pdfOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {providerLabel(provider, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p style={styles.hint}>{t(providerChoiceHelpKey("pdf", config.pdf.provider))}</p>
                  {config.pdf.provider === GROBID_PDF_PROVIDER ? (
                    <>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("settings.grobidBaseUrl")}</span>
                        <input
                          style={fieldStyle}
                          value={optionalText(config.pdf.baseURL)}
                          onChange={(event) => updatePdf({ baseURL: event.currentTarget.value || undefined })}
                          placeholder={GROBID_DEFAULT_BASE_URL}
                        />
                      </label>
                      <p style={styles.hint}>
                        {t("settings.grobidHintBefore")} <code>docker run -p 8070:8070 lfoppiano/grobid:0.8.0</code>
                        {t("settings.grobidHintMiddle")} {GROBID_DEFAULT_BASE_URL}
                        {t("settings.grobidHintAfter")}
                      </p>
                    </>
                  ) : null}
                  <details style={styles.details}>
                    <summary style={styles.summary}>{t("settings.advancedSampleSources")}</summary>
                    <label style={styles.field}>
                      <span style={styles.label}>{t("settings.corpusPath")}</span>
                      <input
                        style={fieldStyle}
                        value={config.corpus}
                        onChange={(event) => updateCorpus(event.currentTarget.value)}
                        placeholder={t("settings.placeholder.corpusPath")}
                      />
                    </label>
                  </details>
                  {selectedNeedsKey ? (
                    <>
                      <label style={styles.field}>
                        <span style={styles.label}>{t("settings.apiKey")}</span>
                        <input
                          style={fieldStyle}
                          autoComplete="off"
                          type="password"
                          value={apiKey}
                          onChange={(event) => setApiKey(event.currentTarget.value)}
                          placeholder={t("settings.placeholder.enterKey")}
                        />
                      </label>
                      <p style={styles.hint}>
                        {t("settings.keysStoredUnder")} {API_KEY_REF}; {t("settings.savedKeysNeverShown")}
                      </p>
                    </>
                  ) : (
                    <p style={styles.hint}>{t("settings.builtInNoKey")}</p>
                  )}
                </div>
              </section>
            </div>

            <section style={styles.section} aria-label={t("settings.external.title")}>
              <div style={styles.sectionHeadingRow}>
                <div>
                  <h3 style={styles.sectionTitle}>{t("settings.external.title")}</h3>
                  <p style={styles.hint}>{t("settings.external.keychainNote")}</p>
                </div>
                <button className="action-button" type="button" onClick={() => void checkExternalProviders()} disabled={externalStatusChecking}>
                  {externalStatusChecking ? t("settings.external.checkingProviders") : t("settings.external.checkProviders")}
                </button>
              </div>

              <div style={styles.externalGrid}>
                <div style={styles.providerForm}>
                  <div style={styles.providerHeader}>
                    <h4 style={styles.providerTitle}>{t("settings.external.provider.scite")}</h4>
                    <label style={styles.checkboxField}>
                      <input
                        type="checkbox"
                        checked={externalForm.sciteEnabled}
                        onChange={(event) => updateExternalForm({ sciteEnabled: event.currentTarget.checked })}
                      />
                      <span>{t("settings.external.enabled")}</span>
                    </label>
                  </div>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("settings.external.sciteClientId")}</span>
                    <input
                      style={fieldStyle}
                      autoComplete="off"
                      type="password"
                      value={externalForm.sciteClientId}
                      onChange={(event) => updateExternalForm({ sciteClientId: event.currentTarget.value })}
                      placeholder={t("settings.external.placeholder.clientId")}
                    />
                  </label>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("settings.external.sciteClientSecret")}</span>
                    <input
                      style={fieldStyle}
                      autoComplete="off"
                      type="password"
                      value={externalForm.sciteClientSecret}
                      onChange={(event) => updateExternalForm({ sciteClientSecret: event.currentTarget.value })}
                      placeholder={t("settings.external.placeholder.clientSecret")}
                    />
                  </label>
                  <p style={styles.hint}>
                    {t("settings.keysStoredUnder")} {SCITE_CLIENT_ID_KEY_REF}, {SCITE_CLIENT_SECRET_KEY_REF};{" "}
                    {t("settings.savedKeysNeverShown")}
                  </p>
                </div>

                <div style={styles.providerForm}>
                  <div style={styles.providerHeader}>
                    <h4 style={styles.providerTitle}>{t("settings.external.provider.consensus")}</h4>
                    <label style={styles.checkboxField}>
                      <input
                        type="checkbox"
                        checked={externalForm.consensusEnabled}
                        onChange={(event) => updateExternalForm({ consensusEnabled: event.currentTarget.checked })}
                      />
                      <span>{t("settings.external.enabled")}</span>
                    </label>
                  </div>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("settings.external.consensusApiKey")}</span>
                    <input
                      style={fieldStyle}
                      autoComplete="off"
                      type="password"
                      value={externalForm.consensusApiKey}
                      onChange={(event) => updateExternalForm({ consensusApiKey: event.currentTarget.value })}
                      placeholder={t("settings.external.placeholder.apiKey")}
                    />
                  </label>
                  <p style={styles.hint}>
                    {t("settings.keysStoredUnder")} {CONSENSUS_API_KEY_REF}; {t("settings.savedKeysNeverShown")}
                  </p>
                </div>

                <div style={styles.providerForm}>
                  <div style={styles.providerHeader}>
                    <h4 style={styles.providerTitle}>{t("settings.external.provider.consensusMcp")}</h4>
                    <label style={styles.checkboxField}>
                      <input
                        type="checkbox"
                        checked={externalForm.consensusMcpEnabled}
                        onChange={(event) => updateExternalForm({ consensusMcpEnabled: event.currentTarget.checked })}
                      />
                      <span>{t("settings.external.enabled")}</span>
                    </label>
                  </div>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("settings.external.consensusMcpUrl")}</span>
                    <input
                      style={fieldStyle}
                      autoComplete="off"
                      value={externalForm.consensusMcpUrl}
                      onChange={(event) => updateExternalForm({ consensusMcpUrl: event.currentTarget.value })}
                      placeholder={t("settings.external.placeholder.mcpUrl")}
                    />
                  </label>
                  <label style={styles.field}>
                    <span style={styles.label}>{t("settings.external.consensusMcpScopes")}</span>
                    <input
                      style={fieldStyle}
                      autoComplete="off"
                      value={externalForm.consensusMcpScopes}
                      onChange={(event) => updateExternalForm({ consensusMcpScopes: event.currentTarget.value })}
                      placeholder={t("settings.external.placeholder.scopes")}
                    />
                  </label>
                  <p style={styles.hint}>{t("settings.external.consensusMcpScopesHint")}</p>
                  <p style={styles.hint}>{t("settings.external.oauth.note")}</p>
                  <div style={styles.localModelActions}>
                    <button className="action-button" type="button" onClick={() => void signInConsensusMcp()} disabled={!config || consensusMcpOauthBusy}>
                      {consensusMcpOauthFlow === "signing-in" ? t("settings.external.oauth.signingIn") : t("settings.external.oauth.signIn")}
                    </button>
                    <button className="action-button" type="button" onClick={() => void disconnectConsensusMcp()} disabled={!config || consensusMcpOauthBusy}>
                      {consensusMcpOauthFlow === "disconnecting" ? t("settings.external.oauth.disconnecting") : t("settings.external.oauth.disconnect")}
                    </button>
                  </div>
                  {consensusMcpOauthStatus ? (
                    <p style={styles.hint}>
                      {t("settings.external.oauth.lastStatus")} {t("settings.external.status.connected")}:{" "}
                      <code>{String(consensusMcpOauthStatus.connected)}</code>
                      {consensusMcpOauthStatus.message ? (
                        <>
                          {" "}
                          · {t("settings.external.oauth.message")}: {consensusMcpOauthStatus.message}
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {consensusMcpOauthError ? (
                    <p style={styles.hint}>
                      {t("settings.external.oauth.failed")} {consensusMcpOauthError}
                    </p>
                  ) : null}
                </div>
              </div>

              {externalStatusError ? (
                <p style={styles.hint}>
                  {t("settings.external.statusCheckFailed")} {externalStatusError}
                </p>
              ) : null}

              {externalStatus ? (
                <div style={styles.statusList}>
                  {externalStatus.length > 0 ? (
                    externalStatus.map((status) => (
                      <article key={status.id} style={styles.statusCard}>
                        <div style={styles.statusCardHeader}>
                          <strong>{t(settingsExternalProviderLabelKey(status.id))}</strong>
                          <span style={status.connected ? styles.statusPill : styles.statusPillWarning}>
                            {status.connected ? t("settings.external.status.connectedValue") : t("settings.external.status.disconnectedValue")}
                          </span>
                        </div>
                        <p style={styles.hint}>
                          {t("settings.external.status.enabled")}: <code>{String(status.enabled)}</code> ·{" "}
                          {t("settings.external.status.connected")}: <code>{String(status.connected)}</code>
                        </p>
                        <div style={styles.capabilityRow} aria-label={t("settings.external.capabilities")}>
                          {status.capabilities.length > 0 ? (
                            status.capabilities.map((capability) => (
                              <span key={capability} style={styles.capabilityChip}>
                                {capability}
                              </span>
                            ))
                          ) : (
                            <span style={styles.capabilityChip}>{t("settings.external.noCapabilities")}</span>
                          )}
                        </div>
                        {status.message ? <p style={styles.hint}>{status.message}</p> : null}
                      </article>
                    ))
                  ) : (
                    <p style={styles.hint}>{t("settings.external.noSavedProviders")}</p>
                  )}
                </div>
              ) : (
                <p style={styles.hint}>{t("settings.external.statusNotChecked")}</p>
              )}
            </section>
          </>
        ) : (
          <div className="empty-state compact-empty">
            <p>{message.kind === "error" ? t("settings.loadFailed") : t("settings.loadingProviderSettings")}</p>
          </div>
        )}
      </div>

      <footer style={styles.footer}>
        <p style={styles.privacy}>
          {selectedRemote ? t("settings.privacy") : t("settings.localPrivacy")}
        </p>
        <div className="status-row" aria-live="polite" style={{ paddingTop: 0 }}>
          <span className={message.kind === "error" ? "status-error" : undefined}>{messageText}</span>
          <button className="action-button" type="button" onClick={() => void applySettings()} disabled={!config || applying}>
            {applying ? t("common.applyingDots") : t("common.apply")}
          </button>
        </div>
      </footer>
    </section>
  );
}
