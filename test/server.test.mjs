import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ body, status: response.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/stats`);
      if (response.ok) return;
    } catch {
      // Startup includes opening SQLite and initiating the metrics request.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start in time");
}

test("HTTP server handles malformed URLs, upstream timeout and SSE limits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meshcore-server-"));
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3z1wAAAABJRU5ErkJggg==", "base64");
  let nodesFail = false;
  const telegramMessages = [];
  const upstream = createServer((req, res) => {
    if (req.url?.startsWith("/bot")) {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          if (payload?.text) telegramMessages.push(payload.text);
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
      });
      return;
    }
    if (req.url?.startsWith("/terrarium/")) {
      res.writeHead(200, { "Content-Type": "image/png" }).end(tinyPng);
      return;
    }
    if (req.url?.startsWith("/api/nodes/")) {
      const suffix = req.url.split("?")[0].replace(/^\/api\/nodes\/[0-9a-f]+/i, "");
      const payload = {
        "": { node: { name: "Test node" }, recentAdverts: [] },
        "/health": {
          observers: [{ avgRssi: -80, avgSnr: 5, observer_name: "Tester", packetCount: 3 }],
          relayObserverCount: 2,
          stats: { avgHops: 3, avgSnr: 6.5, packetsToday: 4, totalObservations: 20, totalPackets: 12 },
        },
        "/neighbors": { neighbors: [] },
        "/paths": { paths: [], totalPaths: 0, totalTransmissions: 0 },
        "/clock-skew": { medianSkewSec: 3, recentMedianSkewSec: 2 },
      }[suffix] || {};
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
      return;
    }
    if (req.url?.startsWith("/api/nodes")) {
      if (nodesFail) {
        res.writeHead(502, { "Content-Type": "application/json" }).end('{"error":"down"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"nodes":[]}');
      return;
    }
    if (req.url === "/api/stats?slow=1") {
      setTimeout(() => res.writeHead(200).end("{}"), 500);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"packetsLastHour":1}');
  });
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const appPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CORESCOPE_URL: `http://127.0.0.1:${upstreamPort}`,
      HOST: "127.0.0.1",
      MAX_PACKET_STREAMS: "1",
      NODES_CACHE_PATH: join(directory, "nodes-cache.json"),
      NODE_INFO_DB_PATH: join(directory, "node-info.sqlite"),
      NODE_INFO_COOLDOWN_MS: "0",
      COMMENTS_DB_PATH: join(directory, "comments.sqlite"),
      COMMENT_COOLDOWN_MS: "0",
      PACKET_DB_PATH: join(directory, "packets.sqlite"),
      PHOTO_DIR: join(directory, "uploads"),
      PHOTO_AUTO_APPROVE: "0",
      PHOTO_COOLDOWN_MS: "0",
      PHOTO_TOKEN: "photo-token",
      STATS_CACHE_PATH: join(directory, "stats-cache.json"),
      STATS_COLLECT_MS: "0",
      FEEDBACK_DB_PATH: join(directory, "feedback.sqlite"),
      FEEDBACK_TOKEN: "test-token",
      ADMIN_PASSWORD: "admin-test",
      ADMIN_SESSION_SECRET: "admin-session-test",
      PORT: String(appPort),
      SCORE_DB_PATH: join(directory, "metrics.sqlite"),
      VISITS_DB_PATH: join(directory, "visits.sqlite"),
      TERRAIN_UPSTREAM: `http://127.0.0.1:${upstreamPort}/terrarium`,
      TELEGRAM_API_BASE: `http://127.0.0.1:${upstreamPort}`,
      TELEGRAM_BOT_TOKEN: "test-bot",
      TELEGRAM_CHAT_ID: "123456",
      TELEGRAM_NOTIFY_FEEDBACK: "1",
      UPSTREAM_TIMEOUT_MS: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  child.stdout.on("data", (chunk) => { childLog += chunk; });
  child.stderr.on("data", (chunk) => { childLog += chunk; });

  let firstStream;
  try {
    await waitForServer(appPort, child, () => childLog.slice(-800));
    const secured = await fetch(`http://127.0.0.1:${appPort}/api/stats`);
    assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
    assert.equal(secured.headers.get("x-frame-options"), "DENY");
    assert.match(secured.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.match(secured.headers.get("permissions-policy") || "", /geolocation=\(\)/);
    assert.equal(secured.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal((await rawRequest(appPort, "/%")).status, 400);
    const healthResponse = await fetch(`http://127.0.0.1:${appPort}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.match(healthResponse.headers.get("cache-control") || "", /no-store/);
    const health = await healthResponse.json();
    assert.ok(["ok", "degraded"].includes(health.status));
    assert.ok(health.uptimeSec >= 0);
    assert.equal(typeof health.mqtt.connected, "boolean");
    assert.equal(typeof health.mqtt.reconnects, "number");
    assert.equal(typeof health.caches.nodes.present, "boolean");
    assert.ok(health.databases.packets.bytes >= 0);
    assert.ok(health.packets.stored >= 0);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/health`, { method: "POST" })).status, 405);
    const nodeDetailKey = "a".repeat(64);
    const nodeDetail = await fetch(`http://127.0.0.1:${appPort}/api/node-detail?key=${nodeDetailKey}`);
    assert.equal(nodeDetail.status, 200);
    const nodeDetailBody = await nodeDetail.json();
    assert.equal(nodeDetailBody.detail.node.name, "Test node");
    assert.equal(nodeDetailBody.health.stats.totalPackets, 12);
    assert.equal(nodeDetailBody.health.observers[0].observer_name, "Tester");
    assert.equal(nodeDetailBody.clockSkew.recentMedianSkewSec, 2);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/node-detail?key=short`)).status, 400);
    const photoConfig = await fetch(`http://127.0.0.1:${appPort}/api/photos/config`);
    assert.equal(photoConfig.status, 200);
    assert.deepEqual(await photoConfig.json(), { autoApprove: false });
    const photoKey = "a".repeat(64);
    const upload = await fetch(`http://127.0.0.1:${appPort}/api/photos`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Photo-Author": encodeURIComponent("Tester"),
        "X-Photo-Caption": encodeURIComponent("Testovací anténa"),
        "X-Photo-Consent": "1",
        "X-Photo-Key": photoKey,
      },
      body: tinyPng,
    });
    assert.equal(upload.status, 202);
    const uploaded = await upload.json();
    assert.equal(uploaded.status, "pending");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(telegramMessages.some((text) => text.includes("Nová fotka čeká na schválení")));

    const adminLoginPage = await fetch(`http://127.0.0.1:${appPort}/admin`);
    assert.equal(adminLoginPage.status, 200);
    assert.match(await adminLoginPage.text(), /Administrace/);
    const adminProtected = await fetch(`http://127.0.0.1:${appPort}/admin/photos`, { redirect: "manual" });
    assert.equal(adminProtected.status, 303);
    assert.match(adminProtected.headers.get("location") || "", /\/admin\/login/);
    const adminWrongLogin = await fetch(`http://127.0.0.1:${appPort}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrong&next=%2Fadmin",
      redirect: "manual",
    });
    assert.equal(adminWrongLogin.status, 401);
    const adminLogin = await fetch(`http://127.0.0.1:${appPort}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=admin-test&next=%2Fadmin",
      redirect: "manual",
    });
    assert.equal(adminLogin.status, 303);
    const adminCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0];
    assert.match(adminCookie, /^mc_admin=/);
    assert.match(adminLogin.headers.get("set-cookie") || "", /HttpOnly/);
    assert.match(adminLogin.headers.get("set-cookie") || "", /SameSite=Strict/);
    const adminDashboard = await fetch(`http://127.0.0.1:${appPort}/admin`, { headers: { cookie: adminCookie } });
    assert.equal(adminDashboard.status, 200);
    assert.match(await adminDashboard.text(), /Přehled/);
    const adminPhotos = await fetch(`http://127.0.0.1:${appPort}/admin/photos?status=pending`, { headers: { cookie: adminCookie } });
    assert.equal(adminPhotos.status, 200);
    assert.match(await adminPhotos.text(), /Schválit/);
    const adminFeedback = await fetch(`http://127.0.0.1:${appPort}/admin/feedback`, { headers: { cookie: adminCookie } });
    assert.equal(adminFeedback.status, 200);
    assert.match(await adminFeedback.text(), /Zpětná vazba/);
    const pendingImage = await fetch(`http://127.0.0.1:${appPort}/api/photos/${uploaded.id}`, { headers: { cookie: adminCookie } });
    assert.equal(pendingImage.status, 200);

    const commentsKey = "e".repeat(64);
    const emptyComments = await fetch(`http://127.0.0.1:${appPort}/api/comments?key=${commentsKey}`);
    assert.equal(emptyComments.status, 200);
    assert.deepEqual((await emptyComments.json()).comments, []);
    const createComment = await fetch(`http://127.0.0.1:${appPort}/api/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "Tester", key: commentsKey, text: "Testovací komentář" }),
    });
    assert.equal(createComment.status, 200);
    const createdComment = (await createComment.json()).comment;
    assert.equal(createdComment.text, "Testovací komentář");
    const comments = await fetch(`http://127.0.0.1:${appPort}/api/comments?key=${commentsKey}`);
    assert.deepEqual((await comments.json()).comments.map((comment) => comment.text), ["Testovací komentář"]);
    const commentCount = await fetch(`http://127.0.0.1:${appPort}/api/comments/count?key=${commentsKey}`);
    assert.equal(commentCount.status, 200);
    assert.equal((await commentCount.json()).count, 1);
    assert.ok(telegramMessages.some((text) => text.includes("Nový komentář k nodu")));
    const adminComments = await fetch(`http://127.0.0.1:${appPort}/admin/comments`, { headers: { cookie: adminCookie } });
    assert.equal(adminComments.status, 200);
    assert.match(await adminComments.text(), /Smazat komentář/);
    const deleteComment = await fetch(`http://127.0.0.1:${appPort}/admin/comments/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: adminCookie,
      },
      body: `id=${createdComment.id}`,
      redirect: "manual",
    });
    assert.equal(deleteComment.status, 303);
    const commentsAfterDelete = await fetch(`http://127.0.0.1:${appPort}/api/comments?key=${commentsKey}`);
    assert.deepEqual((await commentsAfterDelete.json()).comments, []);
    const countAfterDelete = await fetch(`http://127.0.0.1:${appPort}/api/comments/count?key=${commentsKey}`);
    assert.equal((await countAfterDelete.json()).count, 0);

    const infoKey = "c".repeat(64);
    const emptyInfo = await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`);
    assert.equal(emptyInfo.status, 200);
    assert.equal((await emptyInfo.json()).info, null);
    const saveInfo = await fetch(`http://127.0.0.1:${appPort}/api/node-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author: "Tester",
        key: infoKey,
        password: "tajne123",
        text: "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W",
      }),
    });
    assert.equal(saveInfo.status, 200);
    const savedInfo = await saveInfo.json();
    assert.equal(savedInfo.status, "published");
    assert.equal(savedInfo.info.nodeKey, infoKey);
    assert.match(savedInfo.info.text, /Baterie/);
    const readInfo = await (await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`)).json();
    assert.equal(readInfo.info.author, "Tester");
    const badPassword = await fetch(`http://127.0.0.1:${appPort}/api/node-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "Jana", key: infoKey, password: "spatne", text: "Anténa: 5 dBi" }),
    });
    assert.equal(badPassword.status, 403);
    const changeInfo = await fetch(`http://127.0.0.1:${appPort}/api/node-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "Jana", key: infoKey, password: "tajne123", text: "Anténa: 5 dBi" }),
    });
    assert.equal(changeInfo.status, 200);
    assert.equal((await changeInfo.json()).status, "pending");
    const pendingRead = await (await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`)).json();
    assert.equal(pendingRead.info.text, "Hardware: RAK v2\nBaterie: 10 Ah\nPanel: 20 W");
    const adminNodeInfo = await fetch(`http://127.0.0.1:${appPort}/admin/node-info`, { headers: { cookie: adminCookie } });
    assert.equal(adminNodeInfo.status, 200);
    const adminNodeInfoHtml = await adminNodeInfo.text();
    assert.match(adminNodeInfoHtml, /Změny ke schválení/);
    assert.match(adminNodeInfoHtml, /Anténa: 5 dBi/);
    const approveInfo = await fetch(`http://127.0.0.1:${appPort}/admin/node-info/moderate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: adminCookie,
      },
      body: `key=${infoKey}&action=approve`,
      redirect: "manual",
    });
    assert.equal(approveInfo.status, 303);
    assert.equal((await (await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`)).json()).info.text, "Anténa: 5 dBi");
    const adminEdit = await fetch(`http://127.0.0.1:${appPort}/admin/node-info/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: adminCookie,
      },
      body: `key=${infoKey}&author=Admin&text=${encodeURIComponent("Text upravený adminem")}`,
      redirect: "manual",
    });
    assert.equal(adminEdit.status, 303);
    const adminEditedInfo = await (await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`)).json();
    assert.equal(adminEditedInfo.info.text, "Text upravený adminem");
    assert.equal(adminEditedInfo.info.author, "Admin");
    const importInfo = await fetch(`http://127.0.0.1:${appPort}/admin/repeater-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: adminCookie,
      },
      body: `key=${infoKey}&sourceUrl=${encodeURIComponent("https://meshcore.cz/doku.php?id=repeatery:test")}`
        + `&sourceTitle=${encodeURIComponent("test.meshcore.cz")}&text=${encodeURIComponent("Text importovaný z wiki")}`,
      redirect: "manual",
    });
    assert.equal(importInfo.status, 303);
    const importedInfo = await (await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`)).json();
    assert.equal(importedInfo.info.text, "Text importovaný z wiki");
    assert.equal(importedInfo.info.author, "meshcore.cz");
    assert.equal(importedInfo.info.sourceTitle, "test.meshcore.cz");
    assert.equal(importedInfo.info.sourceUrl, "https://meshcore.cz/doku.php?id=repeatery:test");
    const deleteInfo = await fetch(`http://127.0.0.1:${appPort}/admin/node-info/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: adminCookie,
      },
      body: `key=${infoKey}`,
      redirect: "manual",
    });
    assert.equal(deleteInfo.status, 303);
    assert.equal((await (await fetch(`http://127.0.0.1:${appPort}/api/node-info?key=${infoKey}`)).json()).info, null);
    const largePng = Buffer.from(tinyPng);
    largePng.writeUInt32BE(3000, 16);
    largePng.writeUInt32BE(2000, 20);
    const oversized = await fetch(`http://127.0.0.1:${appPort}/api/photos`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Photo-Consent": "1",
        "X-Photo-Key": photoKey,
      },
      body: largePng,
    });
    assert.equal(oversized.status, 413);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/photos?key=${photoKey}`)).status, 200);
    assert.equal((await (await fetch(`http://127.0.0.1:${appPort}/api/photos?key=${photoKey}`)).json()).photos.length, 0);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/photos/${uploaded.id}`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/photos/${uploaded.id}?token=photo-token`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/photos/view?token=photo-token&status=pending`)).status, 200);
    const approve = await fetch(`http://127.0.0.1:${appPort}/api/photos/moderate?token=photo-token&id=${uploaded.id}&action=approve&status=pending`, { redirect: "manual" });
    assert.equal(approve.status, 303);
    const photoList = await (await fetch(`http://127.0.0.1:${appPort}/api/photos?key=${photoKey}`)).json();
    assert.equal(photoList.photos.length, 1);
    const setCover = await fetch(`http://127.0.0.1:${appPort}/admin/photos/moderate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        cookie: adminCookie,
      },
      body: `id=${uploaded.id}&status=approved&action=cover`,
      redirect: "manual",
    });
    assert.equal(setCover.status, 303);
    const nodeCounts = await (await fetch(`http://127.0.0.1:${appPort}/api/photos/nodes`)).json();
    assert.equal(nodeCounts.total, 1);
    assert.deepEqual(nodeCounts.nodes, [{ count: 1, coverId: uploaded.id, nodeKey: photoKey }]);
    const photoFile = await fetch(`http://127.0.0.1:${appPort}/api/photos/${uploaded.id}`);
    assert.equal(photoFile.status, 200);
    assert.equal(photoFile.headers.get("content-type"), "image/png");
    assert.ok((await photoFile.arrayBuffer()).byteLength > 0);
    const report = await fetch(`http://127.0.0.1:${appPort}/api/photos/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: "tester@example.com",
        message: "Chci tuto fotku smazat.",
        photoId: uploaded.id,
        reason: "owner",
      }),
    });
    assert.equal(report.status, 200);
    assert.equal((await report.json()).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(telegramMessages.some((text) => text.includes("Žádost o smazání fotky")));
    const reportsPage = await fetch(`http://127.0.0.1:${appPort}/api/photos/view?token=photo-token&status=reports`);
    assert.equal(reportsPage.status, 200);
    assert.match(await reportsPage.text(), /Chci tuto fotku smazat/);
    const hidden = await fetch(`http://127.0.0.1:${appPort}/api/photos/moderate?token=photo-token&id=${uploaded.id}&action=hide&status=approved`, { redirect: "manual" });
    assert.equal(hidden.status, 303);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/photos/${uploaded.id}`)).status, 404);
    const deleted = await fetch(`http://127.0.0.1:${appPort}/api/photos/moderate?token=photo-token&id=${uploaded.id}&action=delete&status=reports`, { redirect: "manual" });
    assert.equal(deleted.status, 303);
    const reportsAfter = await fetch(`http://127.0.0.1:${appPort}/api/photos/view?token=photo-token&status=reports`);
    assert.doesNotMatch(await reportsAfter.text(), /Chci tuto fotku smazat/);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/photos/view?token=wrong`)).status, 404);
    const terrainTile = await fetch(`http://127.0.0.1:${appPort}/api/terrain/11/1/1.png`);
    assert.equal(terrainTile.status, 200);
    assert.equal(terrainTile.headers.get("content-type"), "image/png");
    assert.match(terrainTile.headers.get("cache-control") || "", /immutable/);
    assert.ok((await terrainTile.arrayBuffer()).byteLength > 0);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/terrain/11/9999/1.png`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/terrain/20/1/1.png`)).status, 400);
    const packetRoutes = await fetch(`http://127.0.0.1:${appPort}/api/packet-routes?hash=abcd1234`);
    assert.equal(packetRoutes.status, 200);
    assert.equal((await packetRoutes.json()).count, 0);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/packet-routes?hash=xyz`)).status, 400);
    const searchResponse = await fetch(`http://127.0.0.1:${appPort}/api/search?hash=abcd`);
    assert.equal(searchResponse.status, 200);
    const searchBody = await searchResponse.json();
    assert.equal(searchBody.prefix, "abcd");
    assert.ok(Array.isArray(searchBody.hashes));
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/search?hash=xyz`)).status, 400);
    const nodesFresh = await fetch(`http://127.0.0.1:${appPort}/api/nodes?limit=2000`);
    assert.equal(nodesFresh.status, 200);
    nodesFail = true;
    const nodesStale = await fetch(`http://127.0.0.1:${appPort}/api/nodes?limit=2000`);
    assert.equal(nodesStale.status, 200);
    assert.ok(Array.isArray((await nodesStale.json()).nodes));
    nodesFail = false;
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/stats`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/stats?slow=1`)).status, 504);
    const statsCached = await fetch(`http://127.0.0.1:${appPort}/api/stats`);
    assert.equal(statsCached.status, 200);
    assert.equal((await statsCached.json()).packetsLastHour, 1);
    const historyResponse = await fetch(`http://127.0.0.1:${appPort}/api/history?since=0`);
    assert.equal(historyResponse.status, 200);
    const historyBody = await historyResponse.json();
    assert.ok(Array.isArray(historyBody.packets));
    const defaultHistory = await fetch(`http://127.0.0.1:${appPort}/api/history`);
    assert.equal(defaultHistory.status, 200);
    const defaultHistoryBody = await defaultHistory.json();
    assert.ok(defaultHistoryBody.since > Date.now() - 2 * 24 * 60 * 60 * 1000);
    const recent = await fetch(`http://127.0.0.1:${appPort}/api/recent?seconds=30`);
    assert.equal(recent.status, 200);
    const recentBody = await recent.json();
    assert.ok(Array.isArray(recentBody.packets));
    assert.equal(recentBody.seconds, 30);
    const recentDefault = await fetch(`http://127.0.0.1:${appPort}/api/recent`);
    assert.equal((await recentDefault.json()).seconds, 30);
    const packetHistory = await fetch(`http://127.0.0.1:${appPort}/api/packet-history?hours=24`);
    assert.equal(packetHistory.status, 200);
    const packetHistoryBody = await packetHistory.json();
    assert.equal(packetHistoryBody.hours, 24);
    assert.equal(packetHistoryBody.series.length, 24);
    assert.ok(packetHistoryBody.series.every((point) => point.packets === null));
    assert.equal(packetHistoryBody.source, "stats-history");
    const packetHistoryWeek = await fetch(`http://127.0.0.1:${appPort}/api/packet-history?hours=168`);
    const packetHistoryWeekBody = await packetHistoryWeek.json();
    assert.equal(packetHistoryWeekBody.hours, 168);
    assert.equal(packetHistoryWeekBody.series.length, 168);
    const packetHistoryMonth = await fetch(`http://127.0.0.1:${appPort}/api/packet-history?hours=720`);
    const packetHistoryMonthBody = await packetHistoryMonth.json();
    assert.equal(packetHistoryMonthBody.granularity, "day");
    assert.equal(packetHistoryMonthBody.points, 30);
    assert.equal(packetHistoryMonthBody.series.length, 30);
    const packetHistoryYear = await fetch(`http://127.0.0.1:${appPort}/api/packet-history?hours=8760`);
    const packetHistoryYearBody = await packetHistoryYear.json();
    assert.equal(packetHistoryYearBody.granularity, "day");
    assert.equal(packetHistoryYearBody.series.length, 365);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/node-history?key=short`)).status, 400);
    const nodeHistory = await fetch(`http://127.0.0.1:${appPort}/api/node-history?key=${"a".repeat(64)}&days=7`);
    assert.equal(nodeHistory.status, 200);
    assert.ok(Array.isArray((await nodeHistory.json()).samples));
    const visitsResponse = await fetch(`http://127.0.0.1:${appPort}/api/visit-stats?days=7`);
    assert.equal(visitsResponse.status, 200);
    const visitsBody = await visitsResponse.json();
    assert.ok(Array.isArray(visitsBody.series));

    const feedbackPost = await fetch(`http://127.0.0.1:${appPort}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "bug", message: "Testovací zpráva" }),
    });
    assert.equal(feedbackPost.status, 200);
    assert.equal((await feedbackPost.json()).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(telegramMessages.some((text) => text.includes("Nová zpráva v knize návštěv")));
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/feedback`)).status, 404);
    const feedbackList = await fetch(`http://127.0.0.1:${appPort}/api/feedback?token=test-token`);
    assert.equal(feedbackList.status, 200);
    const feedbackBody = await feedbackList.json();
    assert.equal(feedbackBody.count, 1);
    assert.equal(feedbackBody.entries[0].message, "Testovací zpráva");

    firstStream = request({ host: "127.0.0.1", port: appPort, path: "/events/packets" });
    let streamBody = "";
    await new Promise((resolve, reject) => {
      firstStream.once("response", (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk) => { streamBody += chunk; });
        resolve();
      });
      firstStream.once("error", reject);
      firstStream.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match(streamBody, /event: status/);
    assert.match(streamBody, /"viewers":1/);
    assert.match(streamBody, /"time":\d+/);
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/events/packets`)).status, 503);
    assert.equal(child.exitCode, null);
  } finally {
    firstStream?.destroy();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
