import { parentPort, workerData } from "node:worker_threads";
import { createNodeMetricsStore } from "./node-metrics.mjs";

const {
  nodesEveryMs = 15 * 60_000,
  scoreDbPath,
  statsEveryMs = 5 * 60_000,
  statsTimeoutMs = 5_000,
  storeOptions = {},
  upstream,
  upstreamTimeoutMs = 15_000,
} = workerData;

const store = createNodeMetricsStore(scoreDbPath, storeOptions);
let nodesActive = false;
let statsActive = false;

async function collectNodes() {
  if (nodesActive) return;
  nodesActive = true;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  timeout.unref();
  try {
    const response = await fetch(`${upstream}/api/nodes?limit=2000`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
    const data = await response.json();
    const writeStartedAt = Date.now();
    const recorded = store.recordNodes(Array.isArray(data.nodes) ? data.nodes : [], Date.now());
    const writeMs = Date.now() - writeStartedAt;
    parentPort.postMessage({ type: "nodes", data });
    console.log(`Node metrics updated: ${recorded} hourly samples (SQLite ${writeMs} ms, total ${Date.now() - startedAt} ms)`);
  } catch (error) {
    console.error(`Node metrics update failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    nodesActive = false;
  }
}

async function collectStats() {
  if (statsActive) return;
  statsActive = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), statsTimeoutMs);
  timeout.unref();
  try {
    const response = await fetch(`${upstream}/api/stats`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CoreScope returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const data = JSON.parse(body.toString("utf8"));
    const startedAt = Date.now();
    store.recordStats(data);
    const writeMs = Date.now() - startedAt;
    parentPort.postMessage({ type: "stats", body, contentType: response.headers.get("content-type") });
    if (writeMs > 500) console.warn(`Stats SQLite write took ${writeMs} ms`);
  } catch (error) {
    const context = error.name === "AbortError"
      ? `timeout after ${Math.round(statsTimeoutMs / 1000)} s`
      : String(error.cause?.code || error.message);
    console.error(`Stats collection failed: ${context} (${upstream})`);
  } finally {
    clearTimeout(timeout);
    statsActive = false;
  }
}

parentPort.on("message", (message) => {
  if (message?.type === "nodes") void collectNodes();
  else if (message?.type === "stats") void collectStats();
});

if (nodesEveryMs > 0) {
  void collectNodes();
  setInterval(() => void collectNodes(), nodesEveryMs).unref();
}
if (statsEveryMs > 0) {
  void collectStats();
  setInterval(() => void collectStats(), statsEveryMs).unref();
}
