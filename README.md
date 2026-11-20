# Lookout · Binance risk copilot

A local-first, read-only Spot portfolio dashboard with concentration alerts, deterministic conversational queries, and reusable MCP tools. No trading, withdrawals, autonomous execution, investment recommendations, or performance claims.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm install
cp .env.example .env
npm start
```

Open **http://127.0.0.1:3000**. No API credentials are needed for the default demo portfolio or public market prices. `npm run dev` restarts the server during development; refresh the browser after editing frontend files. `npm run check` runs TypeScript and focused unit, HTTP, and MCP integration tests.

The initial portfolio has **synthetic** BTC, ETH, SOL, and USDT balances, valued using live Binance public prices. Demo mode is labeled everywhere, including tool/chat results. If market access fails, the error is shown: there is **no automatic fallback**. You can explicitly choose **Illustrative demo** in the Prices selector. Those fixed example prices (BTC 90,000; ETH 3,000; SOL 150 USDT) have no market timestamp and are not current or historical quotes. Illustrative prices are forbidden for real accounts.

## Connect a real account

1. Create a **dedicated HMAC Binance API key** with reading/USER_DATA access only. Disable Spot/margin trading, futures, transfers, and withdrawals. Restrict its IPs where supported. The app does not inspect the key's permission settings; you must verify these in Binance API Management.
2. Set `PORTFOLIO_MODE=binance`, `BINANCE_API_KEY`, and `BINANCE_API_SECRET` in local `.env`, or inject them through your process environment. Never put credentials in frontend code, chat, MCP arguments, URLs you share, or commits.
3. Restart the server. It reads `/api/v3/account` only, signing its query on the server with HMAC-SHA256 and a 5-second receive window. Server time is read before signing. Only free and locked **Spot** balances are included: not Earn, futures, margin, funding wallets, or historical transactions.

The API host is allowlisted: `https://api.binance.com` or `https://api.binance.us`. Public prices default to Binance's official market-data-only endpoint, `https://data-api.binance.vision`. For Binance.US accounts set **both** `BINANCE_BASE_URL` and `BINANCE_MARKET_URL` to `https://api.binance.us`, so the market venue matches the account. Binance and Binance.US are different services; account credentials are not interchangeable.

This is a **trusted single-user local app**, bound to `127.0.0.1`. Host/origin checks, a same-origin content security policy, bounded request bodies, and no account-response caching by browsers reduce exposure. Keys never leave the server except the API key header sent directly to the chosen Binance account host; the secret is used locally for signing. Raw upstream errors, signed URLs, request bodies, and credential values are not logged or returned. Do not expose this server through a public tunnel or reverse proxy without adding authentication, authorization, HTTPS, and a deployment-specific security review.

## Metrics and alerts

- Balance = free + locked, calculated using decimal arithmetic.
- Value = balance x direct `ASSETUSDT` ticker price. USDT itself is valued at 1 **USDT**, not 1 USD.
- Weight = asset value / sum of **priced** asset values x 100.
- Concentration alert = unrounded weight **strictly greater than** the saved allocation limit (1-100%). Displayed percentages are rounded. The default 40% is a configurable example, not a recommended investment limit.
- Concentration index = sum of squared weight fractions. Nearer 1 indicates greater concentration; it does not measure volatility, correlations, liquidity, or probability of loss.

Assets without a direct USDT ticker remain visible as **unpriced**. Totals, allocations, and alerts are explicitly partial and exclude them. No triangulation or assumed stablecoin parity is used. The displayed value is a snapshot, **not profit, return, net worth, or realized performance**. There is no transaction/cash-flow history or historical performance chart.

The allocation limit and explicit demo-price preference are saved in this browser's local storage, not on Binance. Alerts are recomputed on refresh and every 60 seconds **while the tab is open and visible**. No emails, push notifications, or background monitoring after closing the dashboard. Prices are cached in the server for 30 seconds, with concurrent market fetches shared. Account balances are fetched on each portfolio query. Binance `429`/`418` responses trigger a process-wide upstream cooldown honoring `Retry-After`; the dashboard suspends automatic refreshes until it expires. There is a 10-second upstream timeout and no automatic retry loop.

## Assistant and MCP

The built-in chat is **deterministic, not an LLM**. It routes supported questions to the same validated, read-only tools used by HTTP and MCP. No generative AI provider or AI credentials are configured. Unsupported questions explain the limitation instead of pretending to reason with an LLM.

Example queries: `Show my allocation`, `Show portfolio balances`, `What concentration alerts are active?`, and `What is the price of BTC?` Market-price queries always use public live prices, even when illustrative portfolio prices are selected. Chat uses the saved dashboard allocation limit; change it through the risk monitor.

Start the stdio MCP server from this repository:

```sh
npm run mcp
```

For an MCP client, configure the equivalent of this object, replacing the path with **your isolated checkout path**:

```json
{
  "mcpServers": {
    "lookout": {
      "command": "node",
      "args": ["/absolute/path/to/binance-risk-copilot/node_modules/tsx/dist/cli.mjs", "/absolute/path/to/binance-risk-copilot/src/mcp.ts"],
      "cwd": "/absolute/path/to/binance-risk-copilot"
    }
  }
}
```

Use the client-specific working-directory setting if its config calls it something other than `cwd`. `.env` loads relative to the process working directory. Prefer an absolute `node` executable if the client does not inherit your shell PATH. Direct invocation above avoids npm banners on the stdio protocol channel. Credentials belong in the server environment or local `.env`, **not client tool arguments**. Dashboard and MCP are separate processes, so their caches/cooldowns are independent; respect shared IP limits when running both.

| Tool | Input | Result |
| --- | --- | --- |
| `portfolio` | `threshold` (default 40), `priceMode` (`live` default, or `illustrative` in demo only) | balances, prices, allocations, source labels, partial-value warnings, alerts |
| `market` | `symbol` (e.g. `BTCUSDT`, uppercase letters/numbers) | public ticker price, source, fetch timestamp |
| `risk` | `threshold`, `priceMode` | concentration index, alerts, partial-data and source labels |

All MCP tools declare read-only, non-destructive annotations. Inputs are validated; failures use MCP error results. A caller's own LLM can consume these tools, but this repository does not configure or claim an AI service. There are no execution tools.

Local HTTP endpoints: `GET /api/status`, `GET /api/portfolio?threshold=40&priceMode=live`, `GET /api/market/BTCUSDT`, and `POST /api/chat` with `{"message":"Show my allocation","threshold":40,"priceMode":"live"}`.

## API access and references

Binance API availability depends on jurisdiction, account eligibility, service status, IP allowlists, and network policy. Public data can also be blocked. A `403`/`451` is surfaced as an access restriction; do not bypass regional restrictions. Choose the legally available venue for your account, or use the explicitly labeled illustrative demo. Authentication/timestamp errors are sanitized and explain what to check.

Official references used for the integration:

- [Binance Spot REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md): account information (`GET /api/v3/account`), server time (`GET /api/v3/time`), symbol price ticker (`GET /api/v3/ticker/price`), HMAC signing, receive windows, and IP limits.
- [Official market-data-only endpoint](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md).
- [Binance.US API documentation](https://docs.binance.us/).

## Structure

`src/binance.ts` is the strictly read-only Binance adapter; `src/portfolio.ts` contains deterministic metrics; `src/tools.ts` is shared by the dashboard API, command-based assistant, and `src/mcp.ts`. `src/app.ts` serves a dependency-light responsive HTML/CSS/JavaScript dashboard from `public/`. Tests cover decimal calculations, missing prices, exact alert thresholds, signed account requests, cooldowns, sanitized failures, input isolation, chat routing, and the actual stdio MCP protocol.
