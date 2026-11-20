import express from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "./config.js";
import { BinanceService, ServiceError } from "./binance.js";
import { createTools, answerQuery } from "./tools.js";
import { thresholdSchema, priceModeSchema } from "./portfolio.js";

export function createApp(config: Config, service = new BinanceService(config)) {
  const app = express();
  const tools = createTools(service);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (![`127.0.0.1:${config.PORT}`, `localhost:${config.PORT}`].includes(req.headers.host ?? "")) {
      res.status(403).json({ error: "Only local requests are allowed." }); return;
    }
    if (req.method === "POST" && req.headers.origin && ![`http://127.0.0.1:${config.PORT}`, `http://localhost:${config.PORT}`].includes(req.headers.origin)) {
      res.status(403).json({ error: "Cross-origin requests are not allowed." }); return;
    }
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  app.get("/api/status", (_req, res) => res.json({ mode: config.PORTFOLIO_MODE, ai: false, assistant: "deterministic", scope: "Spot balances only" }));
  app.get("/api/portfolio", async (req, res) => {
    const threshold = z.coerce.number().pipe(thresholdSchema).parse(req.query.threshold ?? 40);
    const priceMode = priceModeSchema.parse(req.query.priceMode);
    res.setHeader("Cache-Control", "no-store");
    res.json(await tools.portfolio({ threshold, priceMode }));
  });
  app.get("/api/market/:symbol", async (req, res) => res.json(await tools.market({ symbol: req.params.symbol })));
  app.post("/api/chat", async (req, res) => {
    const input = z.object({ message: z.string().trim().min(1).max(500), threshold: thresholdSchema.default(40), priceMode: priceModeSchema }).strict().parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.json(await answerQuery(input.message, input.threshold, tools, input.priceMode));
  });
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid input. Threshold must be 1-100 and symbols must be uppercase letters/numbers." }); return; }
    if (error instanceof ServiceError) {
      if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      res.status(error.status).json({ error: error.message, retryAfter: error.retryAfter }); return;
    }
    if (error instanceof SyntaxError) { res.status(400).json({ error: "Invalid JSON request." }); return; }
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body exceeds the 8 KB limit." }); return;
    }
    console.error("Request failed with an unexpected internal error.");
    res.status(500).json({ error: "Internal request failure. Inspect server configuration." });
  });
  return app;
}
