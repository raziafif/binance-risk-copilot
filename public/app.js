const $ = id => document.getElementById(id);
const number = (value, digits = 2) => Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const assetNames = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", USDT: "Tether" };
let threshold = 40;
let priceMode = "live";
let mode;
let loading = false;
let chatting = false;
let cooldownUntil = 0;
let lastPortfolio;

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}
try {
  const saved = Number(localStorage.getItem("lookout.threshold"));
  if (saved >= 1 && saved <= 100) threshold = saved;
  const source = localStorage.getItem("lookout.price-mode");
  if (source === "illustrative") priceMode = source;
} catch {
  showError("Browser storage is unavailable. Settings will apply for this visit only.");
}
$("threshold").value = threshold;
$("price-mode").value = priceMode;

async function api(path, options) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) {
    if (data.retryAfter) cooldownUntil = Date.now() + data.retryAfter * 1000;
    throw new Error(data.error || "The server could not complete this request.");
  }
  return data;
}
function appendText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}
function render(p) {
  lastPortfolio = p;
  $("total").textContent = number(p.totalPricedValue);
  $("largest").textContent = p.holdings[0]?.allocation != null ? `${number(p.holdings[0].allocation, 1)}%` : "--";
  $("largest-asset").textContent = p.holdings[0]?.allocation != null ? p.holdings[0].asset : "";
  $("alert-count").textContent = p.alerts.length;
  $("alert-label").textContent = p.complete ? "active" : "partial";
  $("limit-note").textContent = `Above your ${threshold}% allocation limit`;
  $("asset-count").textContent = `${p.holdings.length} assets`;
  $("valuation-note").textContent = p.priceSource === "illustrative" ? "Illustrative valuation. Not live market data." : p.complete ? "Current valuation, not profit or performance" : "Partial valuation: unpriced assets excluded";
  $("updated").textContent = p.priceAsOf ? `Prices checked ${new Date(p.priceAsOf).toLocaleTimeString()}` : "Illustrative prices · No market timestamp";
  $("source-description").textContent = p.mode === "demo"
    ? p.priceSource === "illustrative" ? "Synthetic balances + illustrative prices. Not a real account." : "Synthetic balances + live public market prices. Not a real account."
    : "Binance Spot balances + live public prices. No trading access used.";
  const warnings = [];
  if (p.priceSource === "illustrative") warnings.push("Illustrative demo: fixed example prices (BTC 90,000; ETH 3,000; SOL 150 USDT), not current or historical quotes.");
  if (!p.complete) warnings.push(`Unpriced assets: ${p.unpriced.join(", ")}. Totals, weights, and alerts exclude their value and may understate exposure.`);
  $("warning").hidden = warnings.length === 0;
  $("warning").textContent = warnings.join(" ");
  $("index-note").textContent = `Concentration index: ${p.concentrationIndex === null ? "unavailable (no priced value)" : number(p.concentrationIndex, 4)}${p.complete ? "" : " (partial)"}.`;
  $("holdings-body").replaceChildren();
  $("allocation-bar").replaceChildren();
  p.holdings.forEach((h, i) => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const asset = document.createElement("div");
    asset.className = "asset-cell";
    appendText(asset, "span", h.asset[0], `asset-icon asset-color-${i % 8}`);
    const title = document.createElement("div");
    appendText(title, "span", h.asset, "asset-name");
    appendText(title, "span", assetNames[h.asset] || "Spot asset", "asset-detail");
    asset.append(title);
    cell.append(asset);
    row.append(cell);
    const balance = appendText(row, "td", number(h.quantity, 8));
    balance.title = `Exact balance: ${h.quantity} (free ${h.free}; locked ${h.locked})`;
    appendText(row, "td", h.price === null ? "Unpriced" : number(h.price, 4));
    appendText(row, "td", h.value === null ? "--" : number(h.value));
    appendText(row, "td", h.allocation === null ? "--" : `${number(h.allocation, 1)}%`, h.allocation > threshold ? "weight over" : "weight");
    $("holdings-body").append(row);
    if (h.allocation !== null) {
      const segment = document.createElement("div");
      segment.className = `allocation-segment asset-color-${i % 8}`;
      segment.style.flexGrow = String(h.allocation);
      segment.title = `${h.asset}: ${number(h.allocation, 1)}%`;
      $("allocation-bar").append(segment);
    }
  });
  if (!p.holdings.length) {
    const row = document.createElement("tr");
    const cell = appendText(row, "td", "No nonzero Spot balances.", "empty");
    cell.colSpan = 5;
    $("holdings-body").append(row);
  }
  $("alerts").replaceChildren();
  if (!p.alerts.length) {
    const clear = document.createElement("div");
    clear.className = "alert all-clear";
    const body = document.createElement("div");
    appendText(body, "strong", p.complete ? "No concentration alerts" : "No alerts among priced assets");
    appendText(body, "p", `No priced asset is above ${threshold}%. This is not an overall safety assessment.`);
    clear.append(body);
    $("alerts").append(clear);
  }
  p.alerts.forEach(alert => {
    const item = document.createElement("div");
    item.className = "alert";
    appendText(item, "span", "!", "alert-mark");
    const body = document.createElement("div");
    appendText(body, "strong", `${alert.asset} exceeds your allocation limit`);
    appendText(body, "p", `${number(alert.allocation, 2)}% of priced value · Your limit: ${threshold}%`);
    item.append(body);
    $("alerts").append(item);
  });
}
async function refresh() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  $("error").hidden = true;
  try {
    const p = await api(`/api/portfolio?threshold=${threshold}&priceMode=${priceMode}`);
    render(p);
  } catch (error) {
    showError(`${error.message}${mode === "demo" && priceMode === "live" ? " You can explicitly select Illustrative demo prices to explore offline." : ""}${lastPortfolio ? " Displayed values are from the last successful refresh and may be stale." : ""}`);
    if (!lastPortfolio) $("holdings-body").firstElementChild.firstElementChild.textContent = "Portfolio unavailable. See the data-source notice above.";
  } finally {
    loading = false;
    $("refresh").disabled = false;
  }
}
$("refresh").addEventListener("click", refresh);
$("risk-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (loading || chatting) { showError("Wait for the current request before changing the limit."); return; }
  const value = Number($("threshold").value);
  if (!Number.isFinite(value) || value < 1 || value > 100) { showError("Allocation limit must be between 1% and 100%."); return; }
  threshold = value;
  try {
    localStorage.setItem("lookout.threshold", String(value));
    $("save-status").textContent = `Saved ${value}% limit in this browser. Checked every 60 seconds while open.`;
  } catch {
    $("save-status").textContent = "Browser storage unavailable: this limit is active for this visit only.";
  }
  await refresh();
});
$("price-mode").addEventListener("change", async () => {
  if (loading || chatting) { $("price-mode").value = priceMode; showError("Wait for the current request before changing price mode."); return; }
  priceMode = $("price-mode").value;
  try { localStorage.setItem("lookout.price-mode", priceMode); }
  catch { $("save-status").textContent = "Price mode could not be saved; it applies for this visit only."; }
  await refresh();
});
function message(role, text, failure = false, tool) {
  const item = document.createElement("article");
  item.className = `chat-message ${role}${failure ? " failure" : ""}`;
  appendText(item, "span", role === "user" ? "YOU" : tool ? `LOOKOUT / ${tool.toUpperCase()} TOOL` : "LOOKOUT", "message-label");
  appendText(item, "p", text);
  $("chat-messages").append(item);
  while ($("chat-messages").childElementCount > 30) $("chat-messages").firstElementChild.remove();
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
}
async function send(text) {
  if (chatting || !text.trim()) return;
  chatting = true;
  $("send").disabled = true;
  message("user", text.trim());
  $("chat-input").value = "";
  try {
    const result = await api("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.trim(), threshold, priceMode }) });
    message("assistant", result.answer, false, result.tool);
  } catch (error) { message("assistant", `Query failed: ${error.message}`, true); }
  finally { chatting = false; $("send").disabled = false; }
}
$("chat-form").addEventListener("submit", event => { event.preventDefault(); send($("chat-input").value); });
document.querySelectorAll("[data-query]").forEach(button => button.addEventListener("click", () => send(button.dataset.query)));

async function start() {
  try {
    const status = await api("/api/status");
    mode = status.mode;
    $("mode-badge").textContent = mode === "demo" ? "DEMO PORTFOLIO" : "BINANCE SPOT";
    $("price-control").hidden = mode !== "demo";
    if (mode !== "demo") priceMode = "live";
    await refresh();
    setInterval(() => { if (!document.hidden && !chatting && Date.now() >= cooldownUntil) refresh(); }, 60000);
  } catch (error) {
    $("mode-badge").textContent = "UNAVAILABLE";
    $("source-description").textContent = "Workspace configuration could not be loaded.";
    showError(`Startup failed: ${error.message}`);
  }
}
start();
