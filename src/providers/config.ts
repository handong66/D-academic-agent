import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { getProvider } from "./registry.js";

export const KeyRefSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be a key reference, not a secret value");

const providerId = (kind: "embedder" | "judge" | "pdf") =>
  z.string().refine((id) => getProvider(kind, id) !== undefined, { message: `unknown ${kind} provider` });

// Config holds the NON-SECRET, persisted provider settings (provider id + model/baseURL/dim).
// The API key is NOT here — it lives in the keystore, referenced by keyRef and injected at runtime.
export const EmbedderConfigSchema = z.object({
  provider: providerId("embedder"),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  dim: z.number().int().positive().optional(),
});
export const JudgeConfigSchema = z.object({
  provider: providerId("judge"),
  model: z.string().optional(),
  baseURL: z.string().optional(),
});
export const PdfConfigSchema = z.object({
  provider: providerId("pdf"),
  baseURL: z.string().optional(),
});

export const ExternalMcpProviderConfigSchema = z.object({
  id: z.enum(["scite", "consensus", "consensus-mcp"]),
  label: z.string(),
  enabled: z.boolean().default(true),
  allowedTools: z.array(z.string()).min(1),
  capabilities: z.array(z.string()).default([]),
  transport: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("stdio"),
      command: z.string(),
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
      secretEnvKeyRefs: z.record(KeyRefSchema).optional(),
    }),
    z.object({
      kind: z.literal("streamable-http"),
      url: z.string().url(),
      headers: z.record(z.string()).optional(),
      auth: z.discriminatedUnion("type", [
        z.object({ type: z.literal("none") }),
        z.object({ type: z.literal("bearer"), tokenKeyRef: KeyRefSchema }),
        z.object({
          type: z.literal("oauth-pkce"),
          resource: z.string().optional(),
          scopes: z.array(z.string()).min(1),
          tokenKeyRef: KeyRefSchema,
          clientIdKeyRef: KeyRefSchema.optional(),
          clientSecretKeyRef: KeyRefSchema.optional(),
        }),
        z.object({
          type: z.literal("scite-client-credentials"),
          clientIdKeyRef: KeyRefSchema,
          clientSecretKeyRef: KeyRefSchema,
        }),
      ]),
    }),
  ]),
});

export const ExternalHttpProviderConfigSchema = z.object({
  id: z.enum(["scite", "consensus"]),
  label: z.string(),
  enabled: z.boolean().default(true),
  baseURL: z.string().url(),
  capabilities: z.array(z.string()).default([]),
  auth: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), tokenKeyRef: KeyRefSchema }),
    z.object({
      type: z.literal("api-key-header"),
      header: z.string().min(1),
      keyRef: KeyRefSchema,
    }),
  ]),
});

export const ExternalResearchConfigSchema = z.object({
  mcpProviders: z.array(ExternalMcpProviderConfigSchema).default([]),
  httpProviders: z.array(ExternalHttpProviderConfigSchema).default([]),
});

export const AppConfigSchema = z.object({
  embedder: EmbedderConfigSchema,
  judge: JudgeConfigSchema,
  pdf: PdfConfigSchema,
  corpus: z.string(),
  library: z.string().optional(),
  keyRef: KeyRefSchema.optional(), // a reference, not a secret value — same slug guarantee as the external keyRefs
  externalResearch: ExternalResearchConfigSchema.default({ mcpProviders: [], httpProviders: [] }),
});

export type KeyRef = z.infer<typeof KeyRefSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type EmbedderConfig = z.infer<typeof EmbedderConfigSchema>;
export type JudgeConfig = z.infer<typeof JudgeConfigSchema>;
export type PdfConfig = z.infer<typeof PdfConfigSchema>;
export type ExternalMcpProviderConfig = z.infer<typeof ExternalMcpProviderConfigSchema>;
export type ExternalHttpProviderConfig = z.infer<typeof ExternalHttpProviderConfigSchema>;
export type ExternalResearchConfig = z.infer<typeof ExternalResearchConfigSchema>;

export const defaultConfig: AppConfig = {
  embedder: { provider: "hash", dim: 256 },
  judge: { provider: "mock" },
  pdf: { provider: "unpdf" },
  corpus: "./corpus",
  externalResearch: { mcpProviders: [], httpProviders: [] },
};

// parse() STRIPS unknown keys (default zod), so a stray secret can never be persisted into config.
export async function loadConfig(path: string): Promise<AppConfig> {
  return AppConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
export async function saveConfig(path: string, config: AppConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(AppConfigSchema.parse(config), null, 2)}\n`, "utf8");
}
