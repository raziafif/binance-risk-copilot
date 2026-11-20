import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { balanceSchema, calculatePortfolio, DEMO_BALANCES, ILLUSTRATIVE_PRICES, type Portfolio, type PriceMode } from "./portfolio.js";

export class ServiceError extends Error {
  constructor(message: string, public status = 502, public retryAfter?: number) { super(message); }
}
const tickerSchema = z.array(z.object({
  symbol: z.string(),
  price: z.string().regex(/^\d+(\.\d+)?$/)
}));
const accountSchema = z.object({ balances: z.array(balanceSchema) });

export class BinanceService {
  private cache?: { prices: Map<string, string>; at: number };
  private pending?: Promise<{ prices: Map<string, string>; at: number }>;
  private blockedUntil = 0;
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {}

  private async request(path: string, signed = false): Promise<unknown> {
    if (Date.now() < this.blockedUntil) {
      throw new ServiceError("Binance rate limit cooldown is active. Wait before refreshing.", 429,
        Math.ceil((this.blockedUntil - Date.now()) / 1000));
    }
    let query = "";
    if (signed) {
      const time = z.object({ serverTime: z.number().int().positive() }).safeParse(await this.request("/api/v3/time"));
      if (!time.success) throw new ServiceError("Binance returned an invalid server timestamp.");
      query = new URLSearchParams({ timestamp: String(time.data.serverTime), recvWindow: "5000" }).toString();
      query += `&signature=${createHmac("sha256", this.config.BINANCE_API_SECRET).update(query).digest("hex")}`;
    }
    let response: Response;
    try {
      const base = path === "/api/v3/ticker/price" ? this.config.BINANCE_MARKET_URL : this.config.BINANCE_BASE_URL;
      response = await this.fetcher(`${base}${path}${query ? `?${query}` : ""}`, {
        headers: signed ? { "X-MBX-APIKEY": this.config.BINANCE_API_KEY } : {},
        signal: AbortSignal.timeout(10000),
        redirect: "error"
      });
    } catch {
      throw new ServiceError("Cannot reach Binance. Check connectivity and regional API availability.");
    }
    if (response.status === 429 || response.status === 418) {
      const raw = Number(response.headers.get("retry-after"));
      const seconds = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : response.status === 418 ? 120 : 60;
      this.blockedUntil = Date.now() + seconds * 1000;
      throw new ServiceError("Binance has rate-limited this IP. Automatic requests are paused.", 429, seconds);
    }
    if (!response.ok) {
      let code: unknown;
      try {
        const failure = z.object({ code: z.number() }).safeParse(await response.json());
        if (failure.success) code = failure.data.code;
      } catch {
        // Upstream error bodies can be HTML; never forward them or log signed URLs.
      }
      const message = response.status === 451 || response.status === 403
        ? "Binance denied access. Regional restrictions or API/IP permissions may apply."
        : response.status === 401 || code === -2014 || code === -2015
          ? "Binance authentication failed. Check the server-side read-only key and IP allowlist."
          : code === -1021 ? "Binance rejected the timestamp. Check your system clock and network latency."
          : "Binance rejected the request. Check API permissions, service status, and system clock.";
      throw new ServiceError(message);
    }
    try { return await response.json() as unknown; }
    catch { throw new ServiceError("Binance returned an invalid JSON response."); }
  }

  async market() {
    if (this.cache && Date.now() - this.cache.at < 30000) return this.cache;
    if (!this.pending) {
      this.pending = (async () => {
        const parsed = tickerSchema.safeParse(await this.request("/api/v3/ticker/price"));
        if (!parsed.success) throw new ServiceError("Binance returned invalid market data.");
        const prices = new Map(parsed.data.filter(t => Number(t.price) > 0).map(t => [t.symbol, t.price]));
        this.cache = { prices, at: Date.now() };
        return this.cache;
      })();
    }
    try { return await this.pending; }
    finally { this.pending = undefined; }
  }

  async portfolio(threshold = 40, priceMode: PriceMode = "live"): Promise<Portfolio> {
    if (priceMode === "illustrative") {
      if (this.config.PORTFOLIO_MODE !== "demo") throw new ServiceError("Illustrative prices are allowed only with synthetic demo balances.", 400);
      return { ...calculatePortfolio(DEMO_BALANCES, ILLUSTRATIVE_PRICES, threshold), mode: "demo",
        asOf: new Date().toISOString(), priceAsOf: null, priceSource: "illustrative" };
    }
    let balances = DEMO_BALANCES;
    if (this.config.PORTFOLIO_MODE === "binance") {
      const account = accountSchema.safeParse(await this.request("/api/v3/account", true));
      if (!account.success) throw new ServiceError("Binance returned invalid account balances.");
      balances = account.data.balances;
    }
    const market = await this.market();
    return { ...calculatePortfolio(balances, market.prices, threshold), mode: this.config.PORTFOLIO_MODE,
      asOf: new Date().toISOString(), priceAsOf: new Date(market.at).toISOString(), priceSource: "live" };
  }
}
