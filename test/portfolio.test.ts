import test from "node:test";
import assert from "node:assert/strict";
import { calculatePortfolio } from "../src/portfolio.js";

test("decimal valuation includes locked balances and alerts only strictly above a limit", () => {
  const balances = [
    { asset: "BTC", free: "0.1", locked: "0.2" },
    { asset: "USDT", free: "0.2", locked: "0" }
  ];
  const p = calculatePortfolio(balances, new Map([["BTCUSDT", "1"]]), 60);
  assert.equal(p.totalPricedValue, "0.5");
  assert.equal(p.holdings[0].quantity, "0.3");
  assert.equal(p.holdings[0].allocation, 60);
  assert.equal(p.alerts.length, 0);
  assert.deepEqual(calculatePortfolio(balances, new Map([["BTCUSDT", "1"]]), 59.9).alerts.map(a => a.asset), ["BTC"]);
  assert.equal(p.concentrationIndex, 0.52);
});

test("missing direct prices are excluded and marked partial, never treated as zero-valued assets", () => {
  const p = calculatePortfolio([
    { asset: "UNKNOWN", free: "100000", locked: "0" },
    { asset: "USDT", free: "100", locked: "0" }
  ], new Map(), 40);
  assert.equal(p.totalPricedValue, "100");
  assert.equal(p.complete, false);
  assert.deepEqual(p.unpriced, ["UNKNOWN"]);
  assert.equal(p.holdings.find(h => h.asset === "UNKNOWN")?.allocation, null);
  assert.equal(p.alerts[0].allocation, 100);
  assert.equal(p.concentrationIndex, 1);
});

test("empty and entirely unpriced portfolios have no fictitious allocations or concentration index", () => {
  const empty = calculatePortfolio([{ asset: "BTC", free: "0", locked: "0" }], new Map(), 40);
  assert.equal(empty.totalPricedValue, "0");
  assert.deepEqual(empty.holdings, []);
  assert.equal(empty.concentrationIndex, null);
  const unknown = calculatePortfolio([{ asset: "NEW", free: "2", locked: "0" }], new Map(), 40);
  assert.equal(unknown.concentrationIndex, null);
  assert.equal(unknown.holdings[0].value, null);
  assert.deepEqual(unknown.alerts, []);
});

test("invalid balances, nonpositive prices, and limits are rejected", () => {
  const b = [{ asset: "BTC", free: "1", locked: "0" }];
  for (const limit of [0, 101, NaN, Infinity]) assert.throws(() => calculatePortfolio(b, new Map(), limit));
  for (const price of ["0", "-1", "NaN", "Infinity"]) assert.throws(() => calculatePortfolio(b, new Map([["BTCUSDT", price]]), 40));
  assert.throws(() => calculatePortfolio([{ ...b[0], free: "-1" }], new Map(), 40));
});

test("alert comparisons retain decimal precision before display rounding", () => {
  const p = calculatePortfolio([
    { asset: "BTC", free: "0.600000000000000000001", locked: "0" },
    { asset: "USDT", free: "0.399999999999999999999", locked: "0" }
  ], new Map([["BTCUSDT", "1"]]), 60);
  assert.equal(p.holdings[0].allocation, 60);
  assert.equal(p.alerts[0].asset, "BTC");
});
