const version = Bun.version;
const [maj, min] = version.split(".").map(Number);
if ((maj ?? 0) < 1 || ((maj ?? 0) === 1 && (min ?? 0) < 4)) {
  console.error(
    `harness-dashboard requires Bun >= 1.4.0 (found ${version}).\n` +
      `Install: https://bun.sh\n` +
      `Or pin with: bun upgrade`,
  );
  process.exit(1);
}

import { loadHarnessEnv } from "../load-env";
import homepage from "../ui/index.html";
import recordsPage from "../ui/records.html";
import { ensureDataDir, loadConfig } from "../config";
import { getDb } from "../db/schema";
import { loadPricing, refreshPricing } from "../core/pricing";
import { HOST, PORT, SSE_HEARTBEAT_MS } from "./constants";
import { handleApi } from "./routes";
import { runIngest } from "./ingest-runner";
import { broadcast, heartbeat } from "./sse";
import { startWatching } from "./watch";

loadHarnessEnv();

ensureDataDir();
getDb();
loadConfig();
loadPricing();
void refreshPricing();

const first = await runIngest();
console.log(
  `[harness-dashboard] ingest complete — inserted ${first.inserted} events`,
);

async function pushUpdate() {
  await runIngest();
  const cfg = loadConfig();
  const summary = buildSummary(
    {
      range: { from: 0, to: Date.now() },
      preset: "all",
      sources: [],
    },
    cfg,
  );
  broadcast("update", { at: Date.now(), hint: "refresh" });
  void summary;
}

startWatching(() => {
  void pushUpdate();
});

setInterval(() => heartbeat(), SSE_HEARTBEAT_MS);

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": homepage,
    "/records": recordsPage,
  },
  async fetch(req) {
    const api = await handleApi(req);
    if (api) return api;
    // Let Bun serve bundled UI chunks (/_bun/*, /chunk-*.{css,js}).
    return undefined;
  },
});

console.log(`[harness-dashboard] http://${server.hostname}:${server.port}`);
