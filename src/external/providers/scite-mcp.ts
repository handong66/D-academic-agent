import { z } from "zod";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  callAllowedExternalTool,
  connectExternalMcpProvider,
  type ExternalToolCallResult,
} from "../mcp-client.js";
import type { ExternalPaper } from "../types.js";
import type { ExternalMcpProviderConfig } from "../../providers/config.js";

export interface SciteSearchLiteratureArgs {
  query: string;
  limit?: number;
}

export interface SciteSearchLiteratureDeps {
  transport: Transport;
}

export const sciteMcpProviderConfig: ExternalMcpProviderConfig = {
  id: "scite",
  label: "scite MCP",
  enabled: true,
  allowedTools: ["search_literature"],
  capabilities: ["paper_search"],
  transport: {
    kind: "streamable-http",
    url: "https://api.scite.ai/mcp",
    auth: {
      type: "bearer",
      tokenKeyRef: "SCITE_BEARER_TOKEN",
    },
  },
};

const nullableString = z.string().nullish();

const SciteMcpSearchLiteratureResultSchema = z
  .object({
    // doi is the stable identifier present on every C0-captured result — require it so a wholesale field
    // rename fails loudly here rather than silently yielding empty/"Untitled" papers (Codex milestone-C 🟡).
    doi: z.string().min(1),
    title: nullableString,
    url: nullableString,
  })
  .passthrough();

export const SciteMcpSearchLiteratureResponseSchema = z
  .object({
    results: z.array(SciteMcpSearchLiteratureResultSchema),
  })
  .passthrough();

const McpTextContentBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

const McpContentBlockSchema = z.union([McpTextContentBlockSchema, z.object({ type: z.string() }).passthrough()]);

const McpToolResultEnvelopeSchema = z
  .object({
    structuredContent: z.record(z.unknown()).nullish(),
    content: z.array(McpContentBlockSchema).default([]),
  })
  .passthrough();

type SciteMcpSearchLiteratureResponse = z.infer<typeof SciteMcpSearchLiteratureResponseSchema>;
type SciteMcpSearchLiteratureResult = z.infer<typeof SciteMcpSearchLiteratureResultSchema>;
type McpTextContentBlock = z.infer<typeof McpTextContentBlockSchema>;
type McpToolResultEnvelope = z.infer<typeof McpToolResultEnvelopeSchema>;

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function validationErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "";
  return `: ${issue.path.join(".")} ${issue.message}`.trimEnd();
}

function parseSearchLiteraturePayload(payload: unknown): SciteMcpSearchLiteratureResponse {
  const parsed = SciteMcpSearchLiteratureResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid scite MCP search_literature response${validationErrorMessage(parsed.error)}`);
  }
  return parsed.data;
}

function parseToolResultEnvelope(result: ExternalToolCallResult): McpToolResultEnvelope {
  const parsed = McpToolResultEnvelopeSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`Invalid scite MCP tool result envelope${validationErrorMessage(parsed.error)}`);
  }
  return parsed.data;
}

function parseTextContentPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Scite MCP search_literature text content was not valid JSON");
  }
}

function extractSearchLiteraturePayload(result: ExternalToolCallResult): unknown {
  const envelope = parseToolResultEnvelope(result);
  const structured = envelope.structuredContent;
  if (structured !== undefined && structured !== null && Object.prototype.hasOwnProperty.call(structured, "results")) {
    return structured;
  }

  const textBlock = envelope.content.find((block): block is McpTextContentBlock => McpTextContentBlockSchema.safeParse(block).success);
  const text = textBlock?.text;
  if (text === undefined) {
    throw new Error("Scite MCP search_literature result did not include structuredContent or JSON text content");
  }
  return parseTextContentPayload(text);
}

function mapSearchLiteratureResult(result: SciteMcpSearchLiteratureResult): ExternalPaper {
  const title = present(result.title);
  const doi = present(result.doi);
  const url = present(result.url);
  return {
    provider: "scite",
    title: title ?? doi ?? url ?? "Untitled scite MCP result",
    authors: [],
    ...(doi === undefined ? {} : { doi }),
    ...(url === undefined ? {} : { url }),
  };
}

export function mapSciteMcpSearchLiteratureResponse(response: SciteMcpSearchLiteratureResponse): ExternalPaper[] {
  return response.results.map(mapSearchLiteratureResult);
}

export async function sciteSearchLiterature(
  args: SciteSearchLiteratureArgs,
  deps: SciteSearchLiteratureDeps,
): Promise<ExternalPaper[]> {
  const connection = await connectExternalMcpProvider(sciteMcpProviderConfig, deps);
  if (connection.client === undefined) {
    throw new Error(connection.status.message ?? "Scite MCP provider did not connect");
  }

  try {
    const toolArgs: Record<string, unknown> = {
      query: args.query,
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    };
    const result = await callAllowedExternalTool(connection.client, sciteMcpProviderConfig, "search_literature", toolArgs);
    return mapSciteMcpSearchLiteratureResponse(parseSearchLiteraturePayload(extractSearchLiteraturePayload(result)));
  } finally {
    await connection.client.close();
  }
}
