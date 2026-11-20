import { z } from "zod";
import { BinanceService, ServiceError } from "./binance.js";
import { thresholdSchema, priceModeSchema, type PriceMode } from "./portfolio.js";

export const toolSchemas = {
  portfolio: z.object({ threshold: thresholdSchema.default(40), priceMode: priceModeSchema }).strict(),
  market: z.object({ symbol: z.string().regex(/^[A-Z0-9]{2,30}$/) }).strict(),
  risk: z.object({ threshold: thresholdSchema.default(40), priceMode: priceModeSchema }).strict()
};
export function createTools(service: BinanceService) {
  return {
    portfolio: async (input: unknown) => {
      const { threshold, priceMode } = toolSchemas.portfolio.parse(input);
      return service.portfolio(threshold, priceMode);
    },
    market: async (input: unknown) => {
      const { symbol } = toolSchemas.market.parse(input);
      const market = await service.market();
      const price = market.prices.get(symbol);
      if (!price) throw new ServiceError(`No market price available for ${symbol}.`, 404);
      return { symbol, price, asOf: new Date(market.at).toISOString(), source: "Binance public ticker" };
    },
    risk: async (input: unknown) => {
      const { threshold, priceMode } = toolSchemas.risk.parse(input);
      const p = await service.portfolio(threshold, priceMode);
      return { mode: p.mode, threshold, alerts: p.alerts, unpriced: p.unpriced,
        complete: p.complete, concentrationIndex: p.concentrationIndex, asOf: p.asOf,
        priceSource: p.priceSource, priceAsOf: p.priceAsOf };
    }
  };
}
export type Tools = ReturnType<typeof createTools>;

export async function answerQuery(message: string, threshold: number, tools: Tools, priceMode: PriceMode = "live") {
  const text = message.trim().toLowerCase();
  if (/\b(buy|sell|trade|withdraw|invest|recommend|profit|return|performance)\b/.test(text)) {
    return { tool: null, answer: "This copilot is read-only. It cannot trade, recommend investments, or calculate performance without transaction and cash-flow history." };
  }
  if (/\b(price|market)\b/.test(text)) {
    const words = message.toUpperCase().match(/\b[A-Z0-9]{2,30}\b/g);
    const candidate = words?.find(word => !["WHAT", "IS", "THE", "PRICE", "OF", "MARKET", "SHOW", "ME", "CURRENT", "PLEASE"].includes(word));
    if (!candidate) return { tool: null, answer: "Specify a symbol, for example: price BTCUSDT." };
    const symbol = candidate.endsWith("USDT") ? candidate : `${candidate}USDT`;
    const result = await tools.market({ symbol });
    return { tool: "market", answer: `${result.symbol}: ${result.price} USDT per base asset. Public Binance price as of ${result.asOf}. This is not an execution quote.` };
  }
  if (/\b(risk|alert|alerts|concentration|limit)\b/.test(text)) {
    const result = await tools.risk({ threshold, priceMode });
    return { tool: "risk", answer: `${result.mode === "demo" ? "Demo portfolio. " : "Spot account. "}${result.priceSource === "illustrative" ? "Illustrative prices, not live market data. " : ""}${result.alerts.length ? result.alerts.map(a => a.message).join(" ") : `No priced asset exceeds ${threshold}%.`}${result.complete ? "" : " Some assets are unpriced; percentages exclude them."} Concentration is not a prediction of loss.` };
  }
  if (/\b(balance|balances|portfolio|allocation|holdings|value|largest)\b/.test(text)) {
    const p = await tools.portfolio({ threshold, priceMode });
    return { tool: "portfolio", answer: `${p.mode === "demo" ? "Synthetic demo balances" : "Binance Spot balances"}${p.priceSource === "illustrative" ? " with illustrative (not live) prices" : ""}: ${p.totalPricedValue} USDT in priced assets. ${p.holdings.map(h => `${h.asset}: ${h.quantity}, ${h.allocation === null ? "unpriced" : `${h.allocation.toFixed(2)}%`}`).join("; ")}.${p.complete ? "" : " Total is partial: unpriced assets are excluded."} Valuation is not profit or historical performance.` };
  }
  return { tool: null, answer: "I support deterministic read-only queries: portfolio balances, allocation, concentration alerts, or price BTCUSDT. This is a command-based assistant, not an LLM. Generative AI is not configured." };
}
