import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { entriesForEnvironment, parseChangelog, renderChangelog } from "../scripts/build-changelog.mjs";

test("changelog parser reads curated entries and environment metadata", () => {
  const entries = parseChangelog(`
# Changelog

## 2026-10-28 — Nová funkce
- Prostředí: produkce i beta
- Build: 20261028-1200-abcdef0
- První bod.
- Druhý bod s \`kódem\`.

## 2026-10-27 — Beta změna
- Prostředí: beta
- Build: 20261027-1200-abcdef0
- Pouze beta.
`);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, "Nová funkce");
  assert.equal(entries[0].environment, "both");
  assert.equal(entries[0].build, "20261028-1200-abcdef0");
  assert.deepEqual(entries[0].points, ["První bod.", "Druhý bod s `kódem`."]);
  assert.equal(entries[1].environment, "beta");
});

test("changelog keeps shared entries on both environments", () => {
  const entries = parseChangelog(`
## 2026-10-28 — Společná
- Prostředí: produkce i beta
- Build: 20261028-1200-abcdef0
- Text.

## 2026-10-28 — Produkční
- Prostředí: produkce
- Build: 20261028-1200-abcdef0
- Text.

## 2026-10-28 — Beta
- Prostředí: beta
- Build: 20261028-1200-abcdef0
- Text.
`);
  assert.deepEqual(entriesForEnvironment(entries, "Produkce").map((entry) => entry.title), ["Společná", "Produkční"]);
  assert.deepEqual(entriesForEnvironment(entries, "Beta").map((entry) => entry.title), ["Společná", "Beta"]);
});

test("changelog HTML escapes curated text", () => {
  const html = renderChangelog({
    buildId: "20261028-1200-test",
    environment: "Produkce",
    rows: [{
      build: "20261028-1200-test",
      date: "2026-10-28",
      environment: "both",
      points: ["<script>alert(1)</script>"],
      time: "12:00",
      title: "<b>Nebezpečný název</b>",
    }],
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;b&gt;Nebezpečný název&lt;\/b&gt;/);
});

test("curated changelog has valid recent entries", () => {
  const entries = parseChangelog(readFileSync("CHANGELOG.md", "utf8"));
  assert.ok(entries.length >= 10);
  for (const entry of entries) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.title);
    assert.match(entry.build, /^\d{8}-\d{4}-[a-f0-9]{7}$/);
    assert.ok(entry.points.length > 0);
    assert.ok(["both", "beta", "production"].includes(entry.environment));
  }
});
