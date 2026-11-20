import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BinanceService, ServiceError } from "../src/binance.js";
import { loadConfig } from "../src/config.js";
import { createTools, answerQuery } from "../src/tools.js";

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
const ticks = [{ symbol: "BTCUSDT", price: "90000" }, { symbol: "ETHUSDT", price: "3000" }, { symbol: "SOLUSDT", price: "150" }];

test("public prices require no credentials and concurrent calls share the cache", async () => {
  let calls = 0;
  const service = new BinanceService(loadConfig({}), async (url, options) => {
    calls++;
    assert.equal(new URL(String(url)).origin, "https://data-api.binance.vision");
    assert.deepEqual(options?.headers, {});
    assert.equal(options?.redirect, "error");
    return json(ticks);
  });
  await Promise.all([service.market(), service.market(), service.portfolio()]);
  await service.market();
  assert.equal(calls, 1);
});

test("real account uses HMAC and only read-only GET endpoints", async () => {
  const config = loadConfig({ PORTFOLIO_MODE: "binance", BINANCE_API_KEY: "test-key", BINANCE_API_SECRET: "test-secret" });
  const paths: string[] = [];
  const service = new BinanceService(config, async (input, options) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    assert.ok(!options?.method || options.method === "GET");
    if (url.pathname === "/api/v3/time") return json({ serverTime: 1700000000000 });
    if (url.pathname === "/api/v3/account") {
      const params = new URLSearchParams(url.search);
      const signature = params.get("signature");
      params.delete("signature");
      assert.equal(signature, createHmac("sha256", "test-secret").update(params.toString()).digest("hex"));
      assert.equal(new Headers(options?.headers).get("X-MBX-APIKEY"), "test-key");
      assert.equal(params.get("recvWindow"), "5000");
      return json({ balances: [{ asset: "BTC", free: "0.1", locked: "0.1" }] });
    }
    assert.equal(url.pathname, "/api/v3/ticker/price");
    assert.equal(new Headers(options?.headers).get("X-MBX-APIKEY"), null);
    return json(ticks);
  });
  const p = await service.portfolio();
  assert.equal(p.mode, "binance");
  assert.equal(p.totalPricedValue, "18000");
  assert.deepEqual(paths, ["/api/v3/time", "/api/v3/account", "/api/v3/ticker/price"]);
  assert.ok(!JSON.stringify(p).includes("test-key"));
  await assert.rejects(service.portfolio(40, "illustrative"), /only with synthetic/);
});

for (const status of [429, 418]) {
  test(`${status} respects Retry-After and suppresses additional upstream requests`, async () => {
    let calls = 0;
    const service = new BinanceService(loadConfig({}), async () => {
      calls++;
      return json({}, status, { "Retry-After": "90" });
    });
    await assert.rejects(service.market(), e => e instanceof ServiceError && e.retryAfter === 90 && e.status === 429);
    await assert.rejects(service.market(), /cooldown/);
    assert.equal(calls, 1);
    const illustrative = await service.portfolio(40, "illustrative");
    assert.equal(illustrative.priceSource, "illustrative");
    assert.equal(illustrative.priceAsOf, null);
  });
}

test("upstream errors are explicit, sanitized, and never silently replaced with demo prices", async () => {
  const failed = new BinanceService(loadConfig({}), async () => json({ msg: "sensitive-upstream-content" }, 451));
  await assert.rejects(failed.portfolio(), e => e instanceof ServiceError && /Regional/.test(e.message) && !e.message.includes("sensitive"));
  const malformed = new BinanceService(loadConfig({}), async () => json({ invalid: true }));
  await assert.rejects(malformed.market(), /invalid market data/);
  const unreachable = new BinanceService(loadConfig({}), async () => { throw new Error("secret URL"); });
  await assert.rejects(unreachable.market(), /Cannot reach Binance/);
  const invalidJSON = new BinanceService(loadConfig({}), async () => new Response("not-json"));
  await assert.rejects(invalidJSON.market(), /invalid JSON/);
});

test("chat uses controlled tools, reports illustrative data, and refuses performance or execution", async () => {
  let calls = 0;
  const service = new BinanceService(loadConfig({}), async () => { calls++; return json(ticks); });
  const tools = createTools(service);
  const p = await answerQuery("Show my allocation", 40, tools, "illustrative");
  assert.equal(p.tool, "portfolio");
  assert.match(p.answer, /illustrative \(not live\)/);
  const risk = await answerQuery("What concentration alerts are active?", 50, tools, "illustrative");
  assert.equal(risk.tool, "risk");
  assert.match(risk.answer, /above your 50%/);
  for (const message of ["buy BTC", "portfolio profit", "sell ETH"]) {
    assert.equal((await answerQuery(message, 40, tools)).tool, null);
  }
  assert.equal(calls, 0);
  const price = await answerQuery("What is the price of BTC?", 40, tools);
  assert.equal(price.tool, "market");
  assert.match(price.answer, /90000/);
  const unknown = await answerQuery("write a poem", 40, tools);
  assert.match(unknown.answer, /not an LLM/);
  await assert.rejects(tools.market({ symbol: "BADUSDT" }), /No market price/);
  await assert.rejects(tools.market({ symbol: "BTCUSDT", trade: true }));
});

test("invalid configuration never leaks supplied credential values", () => {
  assert.throws(() => loadConfig({ PORTFOLIO_MODE: "binance" }), /requires server-side/);
  assert.throws(() => loadConfig({ BINANCE_BASE_URL: "https://secret-value.invalid" }),
    error => error instanceof Error && !error.message.includes("secret-value"));
});
