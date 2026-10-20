import assert from "node:assert/strict";
import test from "node:test";
import { createElevationService, ElevationError } from "../src/elevation.js";

function points(count, latBase = 50) {
  return Array.from({ length: count }, (_, index) => ({
    lat: latBase + index * 0.001,
    lon: 14 + index * 0.001,
  }));
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("elevation service caches values and reuses them", async () => {
  let calls = 0;
  const service = createElevationService({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ elevation: [208, 199] });
    },
  });
  const batch = points(2);
  assert.deepEqual(await service.fetchElevations(batch), [208, 199]);
  assert.deepEqual(await service.fetchElevations(batch), [208, 199]);
  assert.equal(calls, 1);
});

test("elevation requests are serialized", async () => {
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const service = createElevationService({
    fetchImpl: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return jsonResponse({ elevation: [1, 2] });
    },
  });
  const first = service.fetchElevations(points(2, 50));
  const second = service.fetchElevations(points(2, 51));
  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await Promise.all([first, second]);
  assert.equal(maxActive, 1);
});

test("elevation service retries server errors", async () => {
  let calls = 0;
  const service = createElevationService({
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return calls < 2 ? jsonResponse({}, 500) : jsonResponse({ elevation: [123] });
    },
  });
  assert.deepEqual(await service.fetchElevations([{ lat: 50, lon: 14 }]), [123]);
  assert.equal(calls, 2);
});

test("elevation service does not retry client errors", async () => {
  let calls = 0;
  const service = createElevationService({
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({}, 400);
    },
  });
  await assert.rejects(
    () => service.fetchElevations([{ lat: 50, lon: 14 }]),
    (error) => error instanceof ElevationError && error.status === 400,
  );
  assert.equal(calls, 1);
});

test("elevation service honors retry-after and applies cooldown", async () => {
  let calls = 0;
  const service = createElevationService({
    retryAfterCapMs: 0,
    cooldownMs: 100,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({}, 429, { "retry-after": "30" });
    },
  });
  const batch = [{ lat: 50, lon: 14 }];
  await assert.rejects(
    () => service.fetchElevations(batch),
    (error) => error instanceof ElevationError && error.retryAfterMs >= 30000,
  );
  await assert.rejects(
    () => service.fetchElevations(batch),
    (error) => error instanceof ElevationError && error.status === 429,
  );
  assert.equal(calls, 1);
});

test("elevation service splits large batches into chunks", async () => {
  const sizes = [];
  const service = createElevationService({
    fetchImpl: async (url) => {
      const count = new URL(url).searchParams.get("latitude").split(",").length;
      sizes.push(count);
      return jsonResponse({ elevation: Array.from({ length: count }, (_, index) => index) });
    },
  });
  const values = await service.fetchElevations(points(150));
  assert.deepEqual(sizes, [100, 50]);
  assert.equal(values.length, 150);
  assert.equal(values[120], 20);
});

test("elevation service keeps missing samples as null and retries them", async () => {
  let calls = 0;
  const service = createElevationService({
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ elevation: [null, 123] });
    },
  });
  const batch = points(2);
  assert.deepEqual(await service.fetchElevations(batch), [null, 123]);
  assert.deepEqual(await service.fetchElevations(batch), [null, 123]);
  assert.equal(calls, 2);
});

test("elevation service aborts with the caller signal", async () => {
  const controller = new AbortController();
  const service = createElevationService({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  const pending = service.fetchElevations([{ lat: 50, lon: 14 }], controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
});
