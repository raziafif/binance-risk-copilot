import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { BinanceService } from "../src/binance.js";

test("HTTP surface validates input, isolates localhost, and exposes no credentials", async () => {
  const config = loadConfig({ BINANCE_API_KEY: "not-for-browser", BINANCE_API_SECRET: "server-only-test" });
  const service = new BinanceService(config, async () => new Response("[]"));
  const server = createApp(config, service).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  config.PORT = address.port;
  const base = `http://127.0.0.1:${address.port}`;
  const headers = {};
  try {
    const status = await fetch(`${base}/api/status`, { headers });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { mode: "demo", ai: false, assistant: "deterministic", scope: "Spot balances only" });
    assert.match(status.headers.get("Content-Security-Policy")!, /frame-ancestors 'none'/);
    const p = await fetch(`${base}/api/portfolio?priceMode=illustrative&threshold=60`, { headers });
    assert.equal(p.status, 200);
    assert.equal(p.headers.get("cache-control"), "no-store");
    const body = await p.text();
    assert.ok(body.includes('"totalPricedValue":"30900"'));
    assert.ok(!body.includes("not-for-browser") && !body.includes("server-only-test"));
    for (const query of ["threshold=0", "threshold=101", "threshold=invalid", "priceMode=invalid"]) {
      assert.equal((await fetch(`${base}/api/portfolio?${query}`, { headers })).status, 400);
    }
    const chat = await fetch(`${base}/api/chat`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Show my portfolio", priceMode: "illustrative" }) });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).tool, "portfolio");
    const cross = await fetch(`${base}/api/chat`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(cross.status, 403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/api/status`, { headers: { Host: "untrusted.invalid" } }, res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    const invalid = await fetch(`${base}/api/chat`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: '{"invalid":true}' });
    assert.equal(invalid.status, 400);
    const large = await fetch(`${base}/api/chat`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ message: "x".repeat(9000) }) });
    assert.equal(large.status, 413);
    const env = await fetch(`${base}/.env`, { headers });
    assert.equal(env.status, 404);
    const home = await fetch(base, { headers });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Not an LLM/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
