import assert from "node:assert/strict";
import test from "node:test";
import { HEALTH_EXPORT_COLUMNS, healthExportRows } from "../src/health-export.js";

test("health export merges metric samples by timestamp and keeps nulls empty", () => {
  const rows = healthExportRows({
    battery: [
      { at: "2026-11-20T04:00:00.000Z", value: 3890, source: "ina" },
      { at: "2026-11-20T04:30:00.000Z", value: 3880, source: "ina" },
    ],
    temperature: [{ at: "2026-11-20T04:00:00.000Z", value: 21.5 }],
    current: [{ at: "2026-11-20T04:30:00.000Z", value: -120 }],
    humidity: [{ at: "2026-11-20T04:30:00.000Z", value: 62 }],
  });
  assert.deepEqual(rows, [
    { time: "2026-11-20T04:00:00.000Z", battery_mv: 3890, voltage_source: "ina", temp_c: 21.5 },
    { time: "2026-11-20T04:30:00.000Z", battery_mv: 3880, voltage_source: "ina", current_ma: -120, humidity_pct: 62 },
  ]);
  assert.deepEqual(HEALTH_EXPORT_COLUMNS, ["time", "battery_mv", "temp_c", "current_ma", "humidity_pct", "voltage_source"]);
});

test("health export ignores invalid samples and returns an empty list without data", () => {
  assert.deepEqual(healthExportRows({ battery: [{ at: "", value: 1 }, { at: "x", value: NaN }] }), []);
  assert.deepEqual(healthExportRows({}), []);
});
