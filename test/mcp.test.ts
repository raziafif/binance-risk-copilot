import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP advertises only read-only capabilities and returns a usable demo portfolio", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "src/mcp.ts"],
    cwd: process.cwd(),
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), PORTFOLIO_MODE: "demo" },
    stderr: "pipe"
  });
  const client = new Client({ name: "lookout-tests", version: "1.0.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(t => t.name).sort(), ["market", "portfolio", "risk"]);
    assert.ok(listed.tools.every(t => t.annotations?.readOnlyHint && t.annotations.destructiveHint === false));
    const result = await client.callTool({ name: "portfolio", arguments: { threshold: 40, priceMode: "illustrative" } });
    assert.ok(!result.isError);
    const content = result.content;
    assert.ok(Array.isArray(content));
    const first = content[0];
    assert.equal(first.type, "text");
    const portfolio = JSON.parse(first.text);
    assert.equal(portfolio.mode, "demo");
    assert.equal(portfolio.priceSource, "illustrative");
    assert.equal(portfolio.totalPricedValue, "30900");
    assert.equal(portfolio.alerts[0].asset, "BTC");
    const invalid = await client.callTool({ name: "portfolio", arguments: { threshold: 0 } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});
