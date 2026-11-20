import { Decimal } from "decimal.js";
import { z } from "zod";

Decimal.set({ precision: 40 });

export const balanceSchema = z.object({
  asset: z.string().min(1).max(50),
  free: z.string().regex(/^\d+(\.\d+)?$/),
  locked: z.string().regex(/^\d+(\.\d+)?$/)
});
export type Balance = z.infer<typeof balanceSchema>;
export const thresholdSchema = z.number().finite().min(1).max(100);
export const priceModeSchema = z.enum(["live", "illustrative"]).default("live");
export type PriceMode = z.infer<typeof priceModeSchema>;
export const ILLUSTRATIVE_PRICES = new Map([
  ["BTCUSDT", "90000"], ["ETHUSDT", "3000"], ["SOLUSDT", "150"]
]);
export const DEMO_BALANCES: Balance[] = [
  { asset: "BTC", free: "0.18", locked: "0.02" },
  { asset: "ETH", free: "2.5", locked: "0" },
  { asset: "SOL", free: "24", locked: "0" },
  { asset: "USDT", free: "1800", locked: "0" }
];

export function calculatePortfolio(balances: Balance[], prices: Map<string, string>, threshold: number) {
  thresholdSchema.parse(threshold);
  const positions = balances.map(balance => {
    const { asset, free, locked } = balanceSchema.parse(balance);
    const quantity = new Decimal(free).plus(locked);
    const rawPrice = asset === "USDT" ? "1" : prices.get(`${asset}USDT`);
    const price = rawPrice === undefined ? null : new Decimal(rawPrice);
    if (price && (!price.isFinite() || price.lte(0))) throw new Error("Invalid market price.");
    return { asset, free, locked, quantity: quantity.toString(), price: price?.toString() ?? null,
      value: price ? quantity.mul(price).toString() : null };
  }).filter(position => new Decimal(position.quantity).gt(0));
  const total = positions.reduce((sum, p) => sum.plus(p.value ?? 0), new Decimal(0));
  const holdings = positions.map(p => ({ ...p,
    allocation: p.value !== null && total.gt(0) ? new Decimal(p.value).div(total).mul(100).toNumber() : null
  })).sort((a, b) => new Decimal(b.value ?? 0).cmp(a.value ?? 0));
  const unpriced = holdings.filter(p => p.value === null).map(p => p.asset);
  const alerts = holdings.filter(p => p.value !== null && total.gt(0) && new Decimal(p.value).div(total).mul(100).gt(threshold))
    .map(p => ({ asset: p.asset, allocation: p.allocation!, threshold,
      message: `${p.asset} is ${p.allocation!.toFixed(2)}% of priced value, above your ${threshold}% limit.` }));
  return { quoteCurrency: "USDT" as const, totalPricedValue: total.toString(), holdings, unpriced,
    complete: unpriced.length === 0, alerts, threshold,
    concentrationIndex: total.gt(0) ? holdings.reduce((sum, p) => sum + ((p.allocation ?? 0) / 100) ** 2, 0) : null };
}
export type Portfolio = ReturnType<typeof calculatePortfolio> & {
  mode: "demo" | "binance"; asOf: string; priceAsOf: string | null; priceSource: PriceMode;
};
