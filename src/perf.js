export function createPerfMonitor(enabled, { windowMs = 1000 } = {}) {
  const gauges = new Map();
  const timings = new Map();
  const hits = new Map();
  let element = null;
  let fps = 0;
  let worstFrameMs = 0;
  let frames = 0;
  let frameWindowStart = 0;
  let lastFrameAt = 0;

  function formatNumber(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString("cs-CZ") : "–";
  }

  function record(name, ms) {
    let entry = timings.get(name);
    if (!entry) {
      entry = { avg: 0, count: 0, last: 0, max: 0, total: 0 };
      timings.set(name, entry);
    }
    entry.count += 1;
    entry.last = ms;
    entry.total += ms;
    entry.avg = entry.total / entry.count;
    if (ms > entry.max) entry.max = ms;
  }

  function measure(name, fn) {
    if (!enabled) return fn();
    const start = performance.now();
    try {
      return fn();
    } finally {
      record(name, performance.now() - start);
    }
  }

  function hit(name) {
    if (enabled) hits.set(name, (hits.get(name) || 0) + 1);
  }

  function set(name, value) {
    if (enabled) gauges.set(name, value);
  }

  function ensureElement() {
    if (element || !enabled || typeof document === "undefined" || !document.body) return;
    element = document.createElement("div");
    element.id = "perf-overlay";
    element.className = "perf-overlay";
    document.body.appendChild(element);
  }

  function render() {
    ensureElement();
    if (!element) return;
    const lines = [`FPS ${fps.toFixed(0)} · max frame ${worstFrameMs.toFixed(0)} ms`];
    const order = ["trasy", "animované", "prvky", "uzly", "uzlyCelkem", "archiv"];
    const gaugeText = order
      .filter((name) => gauges.has(name))
      .map((name) => `${name} ${formatNumber(gauges.get(name))}`)
      .join(" · ");
    if (gaugeText) lines.push(gaugeText);
    for (const [name, entry] of timings) {
      lines.push(`${name} ${entry.last.toFixed(1)} ms (avg ${entry.avg.toFixed(1)}, max ${entry.max.toFixed(1)})`);
    }
    if (hits.size) lines.push([...hits].map(([name, count]) => `${name} ${count}/s`).join(" · "));
    element.textContent = lines.join("\n");
  }

  function frame(timestamp) {
    if (!enabled) return;
    if (lastFrameAt) worstFrameMs = Math.max(worstFrameMs, timestamp - lastFrameAt);
    lastFrameAt = timestamp;
    frames += 1;
    if (!frameWindowStart) frameWindowStart = timestamp;
    const elapsed = timestamp - frameWindowStart;
    if (elapsed < windowMs) return;
    fps = (frames * 1000) / elapsed;
    frames = 0;
    frameWindowStart = timestamp;
    render();
    worstFrameMs = 0;
    hits.clear();
  }

  return { enabled, frame, hit, measure, record, set };
}
