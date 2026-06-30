import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { buildMockContext } from "../cli-ctx.js";
import { createMcpServer } from "./server.js";

// MCP stdio entry for host registration (manual smoke). Real providers can replace the mock ctx.
export async function startStdioServer(): Promise<void> {
  const { ctx } = await buildMockContext();
  await createMcpServer(ctx).connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startStdioServer().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
