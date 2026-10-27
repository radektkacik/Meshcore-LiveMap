import assert from "node:assert/strict";
import test from "node:test";
import { parseReleases, renderChangelog } from "../scripts/build-changelog.mjs";

test("changelog parser keeps only deployments with build and sorts newest first", () => {
  const rows = parseReleases(`
| Datum (UTC) | Release ID / záloha | Build | Změna | Soubory |
| --- | --- | --- | --- | --- |
| 2026-10-27 11:53 | \`20261027T115342Z.tar.gz\` (stage APP_DIR) | \`20261027-1153-c992da8\` | Beta: první změna | \`server.mjs\` |
| 2026-10-27 11:54 | \`20261027T115403Z.tar.gz\` | \`20261027-1154-c992da8\` | Prod: druhá změna | \`server.mjs\` |
| 2026-09-27 15:39 | \`20260927T153912Z.tar.gz\` | externí nasazení |
`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].build, "20261027-1154-c992da8");
  assert.equal(rows[0].environment, "Produkce");
  assert.equal(rows[0].text, "druhá změna");
  assert.equal(rows[1].environment, "Beta");
});

test("changelog HTML escapes release text", () => {
  const html = renderChangelog({
    buildId: "20261027-1200-test",
    rows: [{
      build: "20261027-1200-test",
      date: "2026-10-27 12:00",
      environment: "",
      release: "release",
      text: "<script>alert(1)</script>",
    }],
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /20261027-1200-test/);
});
