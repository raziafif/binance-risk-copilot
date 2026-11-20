import { existsSync } from "node:fs";
import { z } from "zod";

if (existsSync(".env")) process.loadEnvFile(".env");

const schema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  PORTFOLIO_MODE: z.enum(["demo", "binance"]).default("demo"),
  BINANCE_BASE_URL: z.enum(["https://api.binance.com", "https://api.binance.us"]).default("https://api.binance.com"),
  BINANCE_MARKET_URL: z.enum(["https://data-api.binance.vision", "https://api.binance.com", "https://api.binance.us"]).default("https://data-api.binance.vision"),
  BINANCE_API_KEY: z.string().default(""),
  BINANCE_API_SECRET: z.string().default("")
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => i.path.join(".")).join(", ")}`);
  const value = parsed.data;
  if (value.PORTFOLIO_MODE === "binance" && (!value.BINANCE_API_KEY || !value.BINANCE_API_SECRET)) {
    throw new Error("Binance mode requires server-side BINANCE_API_KEY and BINANCE_API_SECRET.");
  }
  return value;
}
export type Config = ReturnType<typeof loadConfig>;
