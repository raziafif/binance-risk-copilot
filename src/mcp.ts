import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { BinanceService, ServiceError } from "./binance.js";
import { createTools, toolSchemas } from "./tools.js";

const server = new McpServer({ name: "binance-risk-copilot", version: "0.1.0" });
const tools = createTools(new BinanceService(loadConfig()));
for (const name of ["portfolio", "market", "risk"] as const) {
  server.registerTool(name, {
    description: name === "portfolio" ? "Read Spot balances and USDT valuation. Demo balances are synthetic; missing prices make totals partial."
      : name === "market" ? "Read a public Binance ticker price for a symbol such as BTCUSDT."
        : "Read concentration alerts and a deterministic concentration index; not investment advice.",
    inputSchema: toolSchemas[name].shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input: unknown): Promise<CallToolResult> => {
    try { return { content: [{ type: "text", text: JSON.stringify(await tools[name](input)) }] }; }
    catch (error) {
      return { isError: true, content: [{ type: "text",
        text: error instanceof ServiceError ? JSON.stringify({ error: error.message, retryAfter: error.retryAfter }) : "Invalid tool input or internal tool failure." }] };
    }
  });
}
await server.connect(new StdioServerTransport());
