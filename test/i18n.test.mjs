import test from "node:test";
import assert from "node:assert/strict";
import {
  formatNumber,
  formatPercent,
  getLocale,
  roleLabel,
  setLocale,
  t,
  tCount,
  TRANSLATIONS,
} from "../src/i18n.js";

test("Czech and English dictionaries have the same keys", () => {
  assert.deepEqual(Object.keys(TRANSLATIONS.cs).sort(), Object.keys(TRANSLATIONS.en).sort());
});

test("translations interpolate parameters", () => {
  setLocale("cs");
  assert.equal(t("los.firstHint"), "Klikněte na první bod nebo uzel.");
  setLocale("en");
  assert.equal(t("los.firstHint"), "Click the first point or a node.");
  assert.equal(t("node.scoreSamples", { count: 4 }), "7-day average from 4 hourly samples.");
});

test("plural forms follow the active locale", () => {
  setLocale("cs");
  assert.equal(tCount("units.hops", 1), "1 hop");
  assert.equal(tCount("units.hops", 3), "3 hopy");
  assert.equal(tCount("units.hops", 8), "8 hopů");
  setLocale("en");
  assert.equal(tCount("units.hops", 1), "1 hop");
  assert.equal(tCount("units.hops", 3), "3 hops");
  setLocale("cs");
});

test("numbers and roles use the active locale", () => {
  setLocale("cs");
  assert.equal(formatNumber(1234), "1\u00a0234");
  assert.equal(formatPercent(0.3), "30\u00a0%");
  assert.equal(roleLabel("unknown"), "Ostatní");
  setLocale("en");
  assert.equal(formatNumber(1234), "1,234");
  assert.equal(formatPercent(0.3), "30%");
  assert.equal(roleLabel("unknown"), "Other");
  assert.equal(getLocale(), "en");
  setLocale("cs");
});
