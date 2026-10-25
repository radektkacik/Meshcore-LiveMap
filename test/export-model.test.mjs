import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCsv,
  csvCell,
  exportFileName,
  featureCollection,
  multiLineFeature,
  pointFeature,
} from "../src/export-model.js";

test("csvCell escapes separators, quotes and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(12.5), "12.5");
  assert.equal(csvCell("a;b"), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
});

test("buildCsv writes BOM, header and CRLF rows", () => {
  const csv = buildCsv(["name", "value"], [
    { name: "Uzel A", value: 1 },
    { name: "Uzel;B", value: null },
  ]);
  assert.equal(csv, "\uFEFFname;value\r\nUzel A;1\r\n\"Uzel;B\";\r\n");
});

test("pointFeature validates coordinates", () => {
  const feature = pointFeature(14.4201234, 50.0876543, { name: "Praha" });
  assert.deepEqual(feature.geometry, { type: "Point", coordinates: [14.420123, 50.087654] });
  assert.equal(feature.properties.name, "Praha");
  assert.equal(pointFeature(Number.NaN, 50), null);
});

test("multiLineFeature drops short lines and rounds coordinates", () => {
  const feature = multiLineFeature([[[14.1, 50.1], [14.2, 50.2]], [[1, 2]]], { hash: "AABB" });
  assert.deepEqual(feature.geometry, {
    type: "MultiLineString",
    coordinates: [[[14.1, 50.1], [14.2, 50.2]]],
  });
  assert.equal(feature.properties.hash, "AABB");
  assert.equal(multiLineFeature([[[1, 2]]]), null);
});

test("featureCollection filters empty features", () => {
  const collection = featureCollection([pointFeature(14, 50), null]);
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features.length, 1);
});

test("exportFileName uses a safe prefix and UTC date", () => {
  const date = new Date("2026-10-25T09:20:14Z");
  assert.equal(exportFileName("Uzly", "csv", date), "meshcore-uzly-20261025.csv");
  assert.equal(exportFileName("routes", "geojson", date), "meshcore-routes-20261025.geojson");
});
