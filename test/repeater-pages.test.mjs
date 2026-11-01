import assert from "node:assert/strict";
import test from "node:test";
import { guessRepeaterSlugs, parseRepeaterRaw, validRepeaterSlug } from "../repeater-pages.mjs";

test("repeater slugs are derived from node names", () => {
  assert.ok(guessRepeaterSlugs("rip5.meshcore.cz").includes("rip5"));
  assert.ok(guessRepeaterSlugs("REP Krenice").includes("rep_krenice"));
  assert.ok(guessRepeaterSlugs("KudlovOZL.meshcore.cz").includes("kudlov"));
  assert.ok(guessRepeaterSlugs("cz.jhm.bi.Klucanina").includes("klucanina"));
  assert.ok(guessRepeaterSlugs("Jested").includes("jested"));
  assert.equal(validRepeaterSlug("rep_krenice"), true);
  assert.equal(validRepeaterSlug("https://example.cz/"), false);
});

test("repeater raw wiki is converted to safe plain text", () => {
  const page = parseRepeaterRaw(`====== rip5.meshcore.cz ======\n  > ver\n  v1.14\n\nhttps://www.heywhatsthat.com/?view=MUCAVRWU\n{{:repeatery:img_4134.jpeg?400|}}`);
  assert.equal(page.title, "rip5.meshcore.cz");
  assert.equal(page.imageCount, 1);
  assert.deepEqual(page.images, ["img_4134.jpeg"]);
  assert.match(page.text, /v1\.14/);
  assert.match(page.text, /https:\/\/www\.heywhatsthat\.com/);
  assert.doesNotMatch(page.text, /\{\{|\}\}/);
  assert.ok(page.text.length <= 1000);
});
