import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
createApp(config).listen(config.PORT, "127.0.0.1", () => {
  console.log(`Risk copilot: http://127.0.0.1:${config.PORT} (${config.PORTFOLIO_MODE})`);
});
