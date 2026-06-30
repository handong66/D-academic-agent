export interface ProviderDescriptor {
  id: string;
  kind: "embedder" | "judge" | "pdf";
  location: "builtin" | "remote" | "local-download";
  needsKey: boolean;
}

export const PROVIDERS: ProviderDescriptor[] = [
  { id: "hash", kind: "embedder", location: "builtin", needsKey: false },
  { id: "openai-compatible", kind: "embedder", location: "remote", needsKey: true },
  { id: "transformers-local", kind: "embedder", location: "local-download", needsKey: false },
  { id: "mock", kind: "judge", location: "builtin", needsKey: false },
  { id: "openai-compatible", kind: "judge", location: "remote", needsKey: true },
  { id: "transformers-nli", kind: "judge", location: "local-download", needsKey: false },
  { id: "unpdf", kind: "pdf", location: "builtin", needsKey: false },
  { id: "grobid", kind: "pdf", location: "local-download", needsKey: false },
];

export function embedderProviders(): ProviderDescriptor[] {
  return PROVIDERS.filter((provider) => provider.kind === "embedder");
}

export function judgeProviders(): ProviderDescriptor[] {
  return PROVIDERS.filter((provider) => provider.kind === "judge");
}

export function pdfProviders(): ProviderDescriptor[] {
  return PROVIDERS.filter((provider) => provider.kind === "pdf");
}

export function getProvider(kind: ProviderDescriptor["kind"], id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((provider) => provider.kind === kind && provider.id === id);
}
