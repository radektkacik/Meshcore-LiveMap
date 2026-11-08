import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { hashIp, methodNotAllowed } from "./http-utils.mjs";
import { detectImage, PhotoError } from "./photos.mjs";
import { fetchRepeaterPage, findRepeaterPage, validRepeaterSlug } from "./repeater-pages.mjs";

export function createHttpRequestHandler(runtime) {
  const {
  addLocalDays,
  adminAuth,
  adminBasePath,
  adminCommentsPage,
  adminCookie,
  adminDashboardPage,
  adminFeedbackPage,
  adminNodeInfoEditPage,
  adminNodeInfoPage,
  adminPhotoPage,
  adminRepeaterImportPage,
  adminRepeaterSyncAllPage,
  adminRepeaterSyncPage,
  adminSessionValid,
  allowedApiPaths,
  broadcastStatus,
  buildNodesPayload,
  cachedNodeByKey,
  checkAdminLogin,
  checkComment,
  checkFeedback,
  checkNodeInfo,
  checkPhotoManage,
  checkPhotoReport,
  checkPhotoUpload,
  checkTerrainRate,
  cleanPhotoText,
  clientIp,
  collectNodeMetrics,
  commentDailyLimit,
  commentMaxRows,
  commentStore,
  createAdminSessionToken,
  currentBuild,
  decodeHeaderValue,
  dist,
  elevationMaxPoints,
  elevationTimeoutMs,
  feedbackDailyLimit,
  feedbackMaxRows,
  feedbackStore,
  feedbackToken,
  fetchNodeDetail,
  fetchTerrainTile,
  getNodesCache,
  getStatsCache,
  handleTelegramWebhook,
  healthPayload,
  healthStore,
  historyRowToPacket,
  importRepeaterPhoto,
  maxPacketStreams,
  metricsStore,
  nodeInfoStore,
  nodesCacheFresh,
  nodesSoftTtlMs,
  notifyNewComment,
  notifyNewFeedback,
  notifyNewReport,
  notifyNodeInfo,
  packetStore,
  packetStreams,
  photoAutoApprove,
  photoMaxBytes,
  photoNodeNames,
  photoStore,
  photoToken,
  publicBasePath,
  queueElevation,
  queueNewPhotoNotification,
  readAdminForm,
  readBody,
  readBodyBuffer,
  recentPackets,
  redirectAdmin,
  renderAdminLogin,
  renderFeedbackPage,
  renderPhotoPage,
  refreshStatsCache,
  repeaterImportEnabled,
  repeaterPageSlug,
  repeaterSyncPlan,
  requestBase,
  resolveCacheGet,
  resolveCacheSet,
  resolveElevations,
  resolveImportNode,
  safeAdminNext,
  sameOriginRequest,
  securityHeaders,
  sendFile,
  sendJson,
  sendStatsCache,
  sendStatsFallback,
  sendStreamEvent,
  sitePath,
  startOfLocalDay,
  startOfUtcDay,
  statsCacheFresh,
  statsCollectMs,
  statsDailyRetentionDays,
  statsHistoryDays,
  statsSoftTtlMs,
  statsTimeoutMs,
  storeNodesCache,
  storeStatsCache,
  terrainCacheGet,
  trustedRepeaterSourceUrl,
  upstream,
  upstreamTimeoutMs,
  visitStore,
  } = runtime;

async function handleAdminRequest(request, response, url) {
  response.setHeader("Cache-Control", "no-store");
  if (!adminAuth.configured) {
    response.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html lang=\"cs\"><meta charset=\"utf-8\"><body style=\"font:16px system-ui;padding:40px\">Administrace není nakonfigurovaná. Nastavte <code>ADMIN_PASSWORD</code> nebo <code>FEEDBACK_TOKEN</code>.</body></html>");
    return;
  }
  const method = request.method || "GET";
  const path = url.pathname;
  if (path === "/admin/login" && method === "GET") {
    if (adminSessionValid(request)) {
      redirectAdmin(response, adminBasePath);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderAdminLogin({ next: safeAdminNext(url.searchParams.get("next")) }));
    return;
  }
  if (path === "/admin/login" && method === "POST") {
    if (!sameOriginRequest(request)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    const ip = clientIp(request);
    const rate = checkAdminLogin(ip);
    if (!rate.ok) {
      response.writeHead(429, { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(rate.retryAfter) });
      response.end(renderAdminLogin({ error: "Příliš mnoho pokusů o přihlášení.", retryAfter: rate.retryAfter }));
      return;
    }
    const form = await readAdminForm(request);
    if (!form) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad Request");
      return;
    }
    const next = safeAdminNext(form.get("next"));
    if (!adminAuth.verifyPassword(form.get("password"))) {
      response.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderAdminLogin({ error: "Nesprávné heslo.", next }));
      return;
    }
    checkAdminLogin.reset(ip);
    response.writeHead(303, {
      "Cache-Control": "no-store",
      "Location": next,
      "Set-Cookie": adminCookie(request, createAdminSessionToken()),
    });
    response.end();
    return;
  }
  if (path === "/admin/logout" && method === "POST") {
    response.writeHead(303, {
      "Cache-Control": "no-store",
      "Location": adminBasePath,
      "Set-Cookie": adminCookie(request, "", 0),
    });
    response.end();
    return;
  }
  if ((path === "/admin" || path === "/admin/") && method === "GET") {
    if (!adminSessionValid(request)) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderAdminLogin({ next: safeAdminNext(url.searchParams.get("next")) }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(adminDashboardPage());
    return;
  }
  if (path.startsWith("/admin/") && method === "GET") {
    if (!adminSessionValid(request)) {
      const externalPath = `${adminBasePath}${path.slice("/admin".length)}${url.search}`;
      redirectAdmin(response, `${adminBasePath}/login?next=${encodeURIComponent(externalPath)}`);
      return;
    }
    if (path === "/admin/photos") {
      const defaultStatus = photoAutoApprove ? "approved" : "pending";
      const status = ["pending", "approved", "hidden", "all", "reports"].includes(url.searchParams.get("status"))
        ? url.searchParams.get("status")
        : defaultStatus;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminPhotoPage(status));
      return;
    }
    if (path === "/admin/comments") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminCommentsPage());
      return;
    }
    if (path === "/admin/feedback") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminFeedbackPage());
      return;
    }
    if (path === "/admin/node-info") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminNodeInfoPage(url.searchParams.get("imported") === "1", url.searchParams.get("synced") === "1"));
      return;
    }
    if (path === "/admin/repeater-sync-all" && repeaterImportEnabled) {
      const names = photoNodeNames();
      const infos = nodeInfoStore.list(500).filter((info) => info.sourceUrl);
      const plans = [];
      for (const info of infos) plans.push(await repeaterSyncPlan(info, names.get(info.nodeKey) || info.nodeKey.slice(0, 12)));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminRepeaterSyncAllPage({ plans }));
      return;
    }
    if (path === "/admin/repeater-sync" && repeaterImportEnabled) {
      const keyValue = String(url.searchParams.get("key") || "").trim();
      if (!keyValue) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(adminRepeaterSyncPage({ keyValue }));
        return;
      }
      const node = resolveImportNode(keyValue);
      let error = node.error || "";
      let page = null;
      let current = null;
      if (!error) {
        current = nodeInfoStore.get(node.key);
        const slug = repeaterPageSlug(current?.sourceUrl);
        page = slug ? await fetchRepeaterPage(slug) : await findRepeaterPage(node.name || node.key);
        if (!page) error = "Pro tento nod nebyla nalezena wiki stránka.";
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminRepeaterSyncPage({ current, error, keyValue, node, page }));
      return;
    }
    if (path === "/admin/repeater-import" && repeaterImportEnabled) {
      const keyValue = String(url.searchParams.get("key") || "").trim();
      const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
      if (!keyValue) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(adminRepeaterImportPage({ keyValue, slug }));
        return;
      }
      const node = resolveImportNode(keyValue);
      let page = null;
      let error = node.error || "";
      if (!error) {
        if (slug && !validRepeaterSlug(slug)) error = "Neplatný slug stránky.";
        else if (slug) page = await fetchRepeaterPage(slug);
        else page = await findRepeaterPage(node.name || node.key);
        if (!page && !error) error = slug
          ? "Stránka nebyla nalezena nebo neobsahuje čitelný text."
          : "Stránka nebyla automaticky nalezena; zadejte slug ručně.";
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminRepeaterImportPage({ error, keyValue, node, page, slug }));
      return;
    }
    if (path === "/admin/node-info/edit") {
      const info = nodeInfoStore.get(url.searchParams.get("key"));
      if (!info) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(adminNodeInfoEditPage(info));
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  if (path.startsWith("/admin/") && method === "POST") {
    if (!adminSessionValid(request)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    if (!sameOriginRequest(request)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
      return;
    }
    const form = await readAdminForm(request);
    if (!form) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad Request");
      return;
    }
    if (path === "/admin/repeater-sync" && repeaterImportEnabled) {
      const key = String(form.get("key") || "").trim().toLowerCase();
      const slug = String(form.get("slug") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key) || !validRepeaterSlug(slug)) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Neplatný sync.");
        return;
      }
      const page = await fetchRepeaterPage(slug);
      if (!page) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Wiki stránka není dostupná.");
        return;
      }
      if (form.get("syncText") === "1") {
        nodeInfoStore.importText(key, {
          author: "meshcore.cz",
          sourceTitle: page.title || slug,
          sourceUrl: page.sourceUrl,
          text: page.text,
        });
      }
      const selectedPhotos = new Set(form.getAll("photo").map(String));
      for (const fileName of page.images) {
        if (selectedPhotos.has(fileName)) await importRepeaterPhoto(key, page, fileName);
      }
      redirectAdmin(response, `${adminBasePath}/node-info?synced=1`);
      return;
    }
    if (path === "/admin/repeater-import" && repeaterImportEnabled) {
      const key = String(form.get("key") || "").trim().toLowerCase();
      const text = String(form.get("text") || "").trim();
      const sourceUrl = trustedRepeaterSourceUrl(form.get("sourceUrl"));
      if (!/^[0-9a-f]{64}$/.test(key) || text.length < 5 || text.length > 1000 || !sourceUrl) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Neplatný import.");
        return;
      }
      const sourceTitle = String(form.get("sourceTitle") || "meshcore.cz").trim().slice(0, 200);
      const info = nodeInfoStore.importText(key, { author: "meshcore.cz", sourceTitle, sourceUrl, text });
      if (!info) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Import se nepodařilo uložit.");
        return;
      }
      redirectAdmin(response, `${adminBasePath}/node-info?imported=1`);
      return;
    }
    if (path === "/admin/photos/moderate") {
      const id = String(form.get("id") || "");
      const reportId = String(form.get("report") || "");
      const action = String(form.get("action") || "");
      const status = ["pending", "approved", "hidden", "all", "reports"].includes(form.get("status"))
        ? form.get("status")
        : "pending";
      if (action === "delete") photoStore.remove(id);
      else if (action === "approve") photoStore.setStatus(id, "approved");
      else if (action === "cover") photoStore.setCover(id);
      else if (action === "hide") photoStore.setStatus(id, "hidden");
      else if (action === "dismiss") photoStore.resolveReport(reportId);
      redirectAdmin(response, `${adminBasePath}/photos?status=${encodeURIComponent(status)}`);
      return;
    }
    if (path === "/admin/comments/delete") {
      commentStore.remove(form.get("id"));
      redirectAdmin(response, adminBasePath + "/comments");
      return;
    }
    if (path === "/admin/feedback/moderate") {
      const id = Number(form.get("id"));
      if (Number.isFinite(id)) feedbackStore.setHidden(id, form.get("hidden") === "1");
      redirectAdmin(response, `${adminBasePath}/feedback`);
      return;
    }
    if (path === "/admin/node-info/edit") {
      const key = String(form.get("key") || "");
      const text = String(form.get("text") || "").trim();
      const author = String(form.get("author") || "").trim().slice(0, 60);
      if (text.length < 5 || text.length > 1000) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Text musí mít 5 až 1000 znaků.");
        return;
      }
      const info = nodeInfoStore.adminUpdate(key, { author, text });
      if (!info) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      redirectAdmin(response, `${adminBasePath}/node-info`);
      return;
    }
    if (path === "/admin/node-info/moderate") {
      const key = form.get("key");
      const action = form.get("action");
      if (action === "approve") nodeInfoStore.approve(key);
      else if (action === "reject") nodeInfoStore.reject(key);
      redirectAdmin(response, `${adminBasePath}/node-info`);
      return;
    }
    if (path === "/admin/node-info/delete") {
      nodeInfoStore.remove(form.get("key"));
      redirectAdmin(response, `${adminBasePath}/node-info`);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  methodNotAllowed(response, "GET, POST", { "Content-Type": "text/plain; charset=utf-8" });
}

async function handleRequest(request, response) {
  const nodesCache = getNodesCache();
  const statsCache = getStatsCache();
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  let url;
  let decodedPathname;
  try {
    url = new URL(request.url || "", requestBase);
    decodedPathname = decodeURIComponent(url.pathname);
    decodeURIComponent(url.search);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Malformed request URL");
    return;
  }

  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    await handleAdminRequest(request, response, url);
    return;
  }

  if (url.pathname === "/api/telegram/webhook") {
    await handleTelegramWebhook(request, response);
    return;
  }

  if (url.pathname === "/events/packets") {
    if (packetStreams.size >= maxPacketStreams) {
      response.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "10",
      });
      response.end("Too many event stream clients");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    const client = {
      blocked: false,
      onDrain: null,
      response,
    };
    client.onDrain = () => {
      client.blocked = false;
    };
    packetStreams.add(client);
    visitStore.recordVisit(clientIp(request));
    visitStore.updatePeak(packetStreams.size);
    broadcastStatus();
    if (url.searchParams.get("replay") !== "0") {
      for (const packet of recentPackets.values()) {
        if (!sendStreamEvent(client, "packet", packet)) break;
      }
    }
    response.once("close", () => {
      packetStreams.delete(client);
      visitStore.updatePeak(packetStreams.size);
      broadcastStatus();
    });
    return;
  }

  if (url.pathname === "/api/version") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const body = JSON.stringify({
      build: currentBuild(),
      environment: publicBasePath === "/beta" ? "beta" : "production",
    });
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  if (url.pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const body = JSON.stringify(healthPayload());
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  if (url.pathname === "/api/search") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const prefix = String(url.searchParams.get("hash") || "").trim();
    if (!/^[0-9a-fA-F]{2,64}$/.test(prefix)) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Neplatný prefix hashe." }));
      return;
    }
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 20), 50);
    const body = JSON.stringify({ hashes: packetStore.searchHashPrefix(prefix, limit), prefix });
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }

  if (url.pathname === "/api/node-relay") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET, HEAD");
      return;
    }
    const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    const node = cachedNodeByKey(key);
    const declaredHashBytes = Math.max(Number(node?.hash_size) || 0, Number(node?.multi_byte_max_hash_size) || 0);
    const hashBytes = declaredHashBytes >= 2 ? declaredHashBytes : 0;
    const prefix = hashBytes && node?.public_key ? String(node.public_key).slice(0, hashBytes * 2).toUpperCase() : "";
    const stats = prefix ? packetStore.relayStats(prefix, hashBytes) : null;
    sendJson(response, 200, { key, ...(stats || { hashBytes, prefix, lastRelayed: null, relayActive: false, relayCount1h: 0, relayCount24h: 0, unscopedRelay24h: 0 }) });
    return;
  }

  if (url.pathname === "/api/node-info") {
    if (request.method === "GET" || request.method === "HEAD") {
      const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) {
        sendJson(response, 400, { error: "Neplatný klíč nodu." });
        return;
      }
      sendJson(response, 200, { info: nodeInfoStore.get(key) });
      return;
    }
    if (request.method !== "POST") {
      methodNotAllowed(response, "GET, HEAD, POST");
      return;
    }
    const ip = clientIp(request);
    const rate = checkNodeInfo(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request, 8192));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const key = String(payload?.key || "").trim().toLowerCase();
    const text = String(payload?.text || "").trim();
    const author = String(payload?.author || "").trim().slice(0, 60);
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    if (text.length < 5 || text.length > 1000) {
      sendJson(response, 400, { error: "Info musí mít 5 až 1000 znaků." });
      return;
    }
    const password = String(payload?.password || "");
    if (password && (password.length < 6 || password.length > 128)) {
      sendJson(response, 400, { error: "Heslo musí mít 6 až 128 znaků." });
      return;
    }
    const result = nodeInfoStore.submit({
      author,
      ipHash: hashIp(ip),
      nodeKey: key,
      password,
      text,
    });
    if (!result) {
      sendJson(response, 400, { error: "Info se nepodařilo uložit." });
      return;
    }
    if (result.error === "bad_password") {
      sendJson(response, 403, { error: "Nesprávné heslo pro úpravu tohoto info." });
      return;
    }
    if (result.error === "invalid_password") {
      sendJson(response, 400, { error: "Heslo musí mít 6 až 128 znaků." });
      return;
    }
    notifyNodeInfo(result.info, result.status);
    sendJson(response, 200, { info: result.info, ok: true, status: result.status });
    return;
  }

  if (url.pathname === "/api/photos/config") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET, HEAD");
      return;
    }
    sendJson(response, 200, { autoApprove: photoAutoApprove });
    return;
  }

  if (url.pathname === "/api/photos") {
    if (request.method === "GET" || request.method === "HEAD") {
      const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) {
        sendJson(response, 400, { error: "Neplatný klíč nodu." });
        return;
      }
      const photos = photoStore.listApproved(key, 12).map((photo) => ({
        author: photo.author,
        bytes: photo.bytes,
        caption: photo.caption,
        createdAt: photo.createdAt,
        height: photo.height,
        id: photo.id,
        width: photo.width,
      }));
      sendJson(response, 200, { photos });
      return;
    }
    if (request.method !== "POST") {
      methodNotAllowed(response, "GET, HEAD, POST");
      return;
    }
    const key = String(request.headers["x-photo-key"] || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    if (request.headers["x-photo-consent"] !== "1") {
      sendJson(response, 400, { error: "Je potřeba potvrdit právo fotku zveřejnit." });
      return;
    }
    const ownerPassword = decodeHeaderValue(request.headers["x-photo-manage-password"] || "");
    if (ownerPassword && (ownerPassword.length < 8 || ownerPassword.length > 128)) {
      sendJson(response, 400, { error: "Heslo pro správu fotek musí mít 8 až 128 znaků." });
      return;
    }
    if (!photoToken) {
      sendJson(response, 503, { error: "Nahrávání fotek není nakonfigurované." });
      return;
    }
    const ip = clientIp(request);
    const batchSize = Number(request.headers["x-photo-batch-size"]);
    const batchIndex = Number(request.headers["x-photo-batch-index"]);
    const batch = Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 5
      && Number.isInteger(batchIndex) && batchIndex >= 0 && batchIndex < batchSize;
    const rate = checkPhotoUpload(ip, Date.now(), { skipCooldown: batch && batchIndex > 0 });
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > photoMaxBytes) {
      sendJson(response, 413, { error: "Fotka je příliš velká." });
      return;
    }
    let buffer;
    try {
      buffer = await readBodyBuffer(request, photoMaxBytes);
    } catch (error) {
      sendJson(response, error.code === "too_large" ? 413 : 400, {
        error: error.code === "too_large" ? "Fotka je příliš velká." : "Fotku se nepodařilo načíst.",
      });
      return;
    }
    if (!detectImage(buffer)) {
      sendJson(response, 415, { error: "Nepodporovaný formát fotky. Použijte JPEG, PNG nebo WebP." });
      return;
    }
    try {
      const manageToken = randomBytes(32).toString("base64url");
      const photo = photoStore.create({
        author: cleanPhotoText(decodeHeaderValue(request.headers["x-photo-author"]), 60),
        buffer,
        caption: cleanPhotoText(decodeHeaderValue(request.headers["x-photo-caption"]), 240),
        ipHash: hashIp(ip),
        ownerPassword,
        ownerToken: manageToken,
        nodeKey: key,
        status: photoAutoApprove ? "approved" : "pending",
      });
      if (request.headers["x-photo-cover"] === "1") photoStore.requestCover(photo.id);
      queueNewPhotoNotification(
        photo,
        String(request.headers["x-photo-batch-id"] || "").slice(0, 64),
        batch ? batchSize : 1,
      );
      sendJson(response, 202, { id: photo.id, manageToken, ok: true, status: photo.status });
    } catch (error) {
      if (error instanceof PhotoError) {
        const status = error.code === "too_large" || error.code === "too_large_dimensions" ? 413
          : error.code === "store_full" ? 507
            : error.code === "node_limit" ? 409
              : error.code === "invalid_image" ? 415 : 400;
        sendJson(response, status, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (url.pathname === "/api/photos/report") {
    if (request.method !== "POST") {
      methodNotAllowed(response, "POST");
      return;
    }
    const ip = clientIp(request);
    const rate = checkPhotoReport(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request, 8192));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const photoId = String(payload?.photoId || "").toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(photoId)) {
      sendJson(response, 400, { error: "Neplatná fotka." });
      return;
    }
    const reason = String(payload?.reason || "other");
    if (!["inappropriate", "other", "owner", "privacy"].includes(reason)) {
      sendJson(response, 400, { error: "Neplatný důvod." });
      return;
    }
    const message = cleanPhotoText(payload?.message, 500);
    if (message.length < 5) {
      sendJson(response, 400, { error: "Napište prosím důvod žádosti (alespoň 5 znaků)." });
      return;
    }
    const contact = cleanPhotoText(payload?.contact, 200);
    const reportId = photoStore.createReport({
      contact,
      ipHash: hashIp(ip),
      message,
      photoId,
      reason,
    });
    if (reportId) {
      notifyNewReport({ contact, message, photo: photoStore.get(photoId), reason, reportId });
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/photos/nodes") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const nodes = photoStore.listApprovedNodeCounts();
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify({ nodes, total: nodes.length }));
    return;
  }

  if (url.pathname === "/api/photos/all") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET, HEAD");
      return;
    }
    const names = photoNodeNames();
    const photos = photoStore.listApprovedAll(2000).map((photo) => ({
      author: photo.author,
      caption: photo.caption,
      createdAt: photo.createdAt,
      height: photo.height,
      id: photo.id,
      nodeKey: photo.nodeKey,
      nodeName: names.get(photo.nodeKey) || photo.nodeKey.slice(0, 8),
      width: photo.width,
    }));
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify({ photos }));
    return;
  }

  if (url.pathname === "/api/photos/view") {
    if (!photoToken || url.searchParams.get("token") !== photoToken) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const status = ["pending", "approved", "hidden", "all", "reports"].includes(url.searchParams.get("status"))
      ? url.searchParams.get("status")
      : "pending";
    const entries = status === "reports" ? [] : photoStore.listAdmin(status, 300);
    const reports = status === "reports" ? photoStore.listReports("open", 300) : [];
    const openReports = photoStore.openReportCount();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(renderPhotoPage(entries, reports, photoToken, status, openReports));
    return;
  }

  if (url.pathname === "/api/photos/moderate") {
    if (!photoToken || url.searchParams.get("token") !== photoToken) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const id = String(url.searchParams.get("id") || "");
    const reportId = String(url.searchParams.get("report") || "");
    const action = String(url.searchParams.get("action") || "");
    const status = ["pending", "approved", "hidden", "all", "reports"].includes(url.searchParams.get("status"))
      ? url.searchParams.get("status")
      : "pending";
    if (action === "delete") photoStore.remove(id);
    else if (action === "approve") photoStore.setStatus(id, "approved");
    else if (action === "hide") photoStore.setStatus(id, "hidden");
    else if (action === "dismiss") photoStore.resolveReport(reportId);
    response.writeHead(303, {
      Location: `view?token=${encodeURIComponent(photoToken)}&status=${encodeURIComponent(status)}`,
    });
    response.end();
    return;
  }

  const photoManageMatch = /^\/api\/photos\/([0-9a-f-]{36})\/manage$/.exec(url.pathname);
  if (photoManageMatch) {
    if (request.method !== "POST") {
      methodNotAllowed(response, "POST");
      return;
    }
    const id = photoManageMatch[1].toLowerCase();
    const ip = clientIp(request);
    const rate = checkPhotoManage(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: "Příliš mnoho pokusů o správu fotek. Zkuste to později." }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request, 8192));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const photo = photoStore.get(id);
    if (!photo) {
      sendJson(response, 404, { error: "Fotka nebyla nalezena." });
      return;
    }
    const admin = adminSessionValid(request);
    const authHeader = String(request.headers.authorization || "");
    const token = /^Bearer\s+([A-Za-z0-9_-]{32,})$/i.exec(authHeader)?.[1] || "";
    const password = typeof payload?.password === "string" ? payload.password : "";
    if (!admin && !photoStore.authorizeOwner(id, { token, password })) {
      sendJson(response, 403, { error: "Nesprávný přístupový token nebo heslo." });
      return;
    }
    const action = String(payload?.action || "");
    if (action === "edit") {
      if (photo.status === "hidden") {
        sendJson(response, 409, { error: "Skrytou fotku může upravit pouze správce." });
        return;
      }
      const updated = photoStore.updateOwnerMetadata(id, {
        author: cleanPhotoText(payload?.author, 60),
        caption: cleanPhotoText(payload?.caption, 240),
      });
      if (!updated) {
        sendJson(response, 409, { error: "Fotku se nepodařilo upravit." });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        photo: { author: updated.author, caption: updated.caption, id: updated.id, status: updated.status },
      });
      return;
    }
    if (action === "delete") {
      photoStore.remove(id);
      sendJson(response, 200, { deleted: true, ok: true });
      return;
    }
    sendJson(response, 400, { error: "Neznámá akce." });
    return;
  }

  if (url.pathname.startsWith("/api/photos/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/photos/".length)).toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const photo = photoStore.get(id);
    const token = url.searchParams.get("token") || "";
    const admin = adminSessionValid(request);
    if (!photo || (photo.status !== "approved" && !admin && (!photoToken || token !== photoToken))) {
      response.writeHead(404).end("Not Found");
      return;
    }
    const filePath = photoStore.filePath(id);
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": photo.status === "approved" ? "public, max-age=31536000, immutable" : "no-store",
      "Content-Length": photo.bytes,
      "Content-Type": photo.mime,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).on("error", () => {
      if (!response.writableEnded) response.destroy();
    }).pipe(response);
    return;
  }

  if (url.pathname === "/api/node-detail") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    try {
      const { data, stale } = await fetchNodeDetail(key);
      sendJson(response, 200, data, stale ? { "X-Data-Stale": "1" } : {});
    } catch {
      sendJson(response, 502, { error: "Detail nodu není dostupný." });
    }
    return;
  }

  if (url.pathname === "/api/visit-stats") {
    const days = Math.min(Math.max(1, Number(url.searchParams.get("days")) || 14), 365);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(visitStore.report(Date.now(), days)));
    return;
  }

  if (url.pathname === "/api/comments/count") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET, HEAD");
      return;
    }
    const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    sendJson(response, 200, { count: commentStore.countForNode(key) });
    return;
  }

  if (url.pathname === "/api/comments") {
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
      methodNotAllowed(response, "GET, HEAD, POST");
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const key = String(url.searchParams.get("key") || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) {
        sendJson(response, 400, { error: "Neplatný klíč nodu." });
        return;
      }
      const comments = commentStore.list(key);
      sendJson(response, 200, { comments, total: commentStore.countForNode(key) });
      return;
    }
    const ip = clientIp(request);
    const rate = checkComment(ip);
    if (!rate.ok) {
      sendJson(response, 429, { error: rate.message }, { "Retry-After": String(rate.retryAfter) });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      sendJson(response, 400, { error: "Neplatný požadavek." });
      return;
    }
    const key = String(payload?.key || url.searchParams.get("key") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč nodu." });
      return;
    }
    const text = String(payload?.text || "").trim();
    const author = String(payload?.author || "").trim().slice(0, 60);
    if (text.length < 2 || text.length > 500) {
      sendJson(response, 400, { error: "Komentář musí mít 2 až 500 znaků." });
      return;
    }
    const now = Date.now();
    if (commentStore.countSince(startOfUtcDay(now)) >= commentDailyLimit) {
      sendJson(response, 429, { error: "Denní limit komentářů vyčerpán." }, { "Retry-After": "3600" });
      return;
    }
    const comment = commentStore.create({
      author,
      ipHash: hashIp(ip),
      nodeKey: key,
      text,
    }, now);
    if (!comment) {
      sendJson(response, 400, { error: "Komentář se nepodařilo vytvořit." });
      return;
    }
    commentStore.pruneTo(commentMaxRows);
    notifyNewComment(comment);
    sendJson(response, 200, { comment, ok: true });
    return;
  }

  if (url.pathname === "/api/feedback/public") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const entries = feedbackStore.listPublic(50);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ count: entries.length, entries }));
    return;
  }

  if (url.pathname === "/api/feedback"
    || url.pathname === "/api/feedback/view"
    || url.pathname === "/api/feedback/moderate") {
    const isView = url.pathname.endsWith("/view");
    const isModerate = url.pathname.endsWith("/moderate");
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      const ip = clientIp(request);
      const rate = checkFeedback(ip);
      if (!rate.ok) {
        response.writeHead(429, {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": String(rate.retryAfter),
        });
        response.end(JSON.stringify({ error: rate.message }));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(request));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Neplatný požadavek." }));
        return;
      }
      const message = String(payload?.message || "").trim();
      if (message.length < 5 || message.length > 2000) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Zpráva musí mít 5 až 2000 znaků." }));
        return;
      }
      const now = Date.now();
      if (feedbackStore.countSince(startOfUtcDay(now)) >= feedbackDailyLimit) {
        response.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "3600" });
        response.end(JSON.stringify({ error: "Denní limit zpráv vyčerpán." }));
        return;
      }
      const category = ["bug", "idea", "other"].includes(payload?.category) ? payload.category : "other";
      const contact = String(payload?.contact || "").trim().slice(0, 200);
      const name = String(payload?.name || "").trim().slice(0, 60);
      const isPublic = payload?.isPublic === true;
      const userAgent = String(request.headers["user-agent"] || "").slice(0, 300);
      const ipHash = hashIp(ip);
      const id = feedbackStore.record({ category, message, contact, name, isPublic, ipHash, userAgent }, now);
      feedbackStore.pruneTo(feedbackMaxRows);
      notifyNewFeedback({ category, isPublic, message, name });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, id }));
      return;
    }
    if (!feedbackToken || url.searchParams.get("token") !== feedbackToken) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    if (isModerate) {
      const id = Number(url.searchParams.get("id"));
      const hidden = url.searchParams.get("hidden") !== "0";
      if (Number.isFinite(id)) feedbackStore.setHidden(id, hidden);
      response.writeHead(303, { Location: `/api/feedback/view?token=${encodeURIComponent(feedbackToken)}` });
      response.end();
      return;
    }
    const entries = feedbackStore.list(200);
    if (isView) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(renderFeedbackPage(entries, feedbackToken));
    } else {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ count: entries.length, entries }));
    }
    return;
  }

  if (url.pathname === "/api/packet-routes") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const hash = String(url.searchParams.get("hash") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{4,64}$/.test(hash)) {
      sendJson(response, 400, { error: "Neplatný hash paketu." });
      return;
    }
    const packets = packetStore.queryHash(hash).map(historyRowToPacket);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ count: packets.length, packets }));
    return;
  }

  if (url.pathname === "/api/history") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const sinceParam = url.searchParams.has("since") ? Number(url.searchParams.get("since")) : NaN;
    const limitParam = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : NaN;
    const since = Number.isFinite(sinceParam) ? sinceParam : Date.now() - 24 * 60 * 60 * 1000;
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 20_000) : 4_000;
    const packets = packetStore.querySince(since, limit).map(historyRowToPacket);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ count: packets.length, packets, since }));
    return;
  }

  if (url.pathname === "/api/packet-history") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const hoursParam = url.searchParams.has("hours") ? Number(url.searchParams.get("hours")) : NaN;
    const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(1, Math.round(hoursParam)), 8760) : 24;
    const granularity = hours <= 168 ? "hour" : "day";
    const bucketMs = granularity === "hour" ? 3_600_000 : 86_400_000;
    const points = granularity === "hour" ? hours : Math.ceil(hours / 24);
    const end = granularity === "hour"
      ? Math.floor(Date.now() / bucketMs) * bucketMs
      : addLocalDays(startOfLocalDay(Date.now()), -1);
    const since = granularity === "hour"
      ? end - (points - 1) * bucketMs
      : addLocalDays(end, -(points - 1));
    const series = [];
    if (granularity === "hour") {
      const byHour = new Map();
      for (const sample of metricsStore.statsSeries(since)) {
        const hour = Math.floor(sample.bucketAt / bucketMs) * bucketMs;
        const previous = byHour.get(hour);
        if (!previous || sample.bucketAt > previous.bucketAt) byHour.set(hour, sample);
      }
      for (let index = 0; index < points; index += 1) {
        const hour = since + index * bucketMs;
        const sample = byHour.get(hour);
        const value = sample ? Number(sample.packetsLastHour) : NaN;
        series.push({
          hour,
          packets: Number.isFinite(value) ? value : null,
          sampledAt: sample?.sampledAt || null,
        });
      }
    } else {
      const byDay = new Map(metricsStore.statsRollupSeries(since, "day").map((sample) => [sample.bucketAt, sample]));
      for (let index = 0; index < points; index += 1) {
        const day = addLocalDays(since, index);
        const sample = byDay.get(day);
        const value = sample ? Number(sample.packetsLastHour) : NaN;
        series.push({
          hour: day,
          packets: Number.isFinite(value) ? value : null,
          peak: sample?.peak ?? null,
          samples: sample?.samples ?? 0,
          sampledAt: sample?.sampledAt || null,
        });
      }
    }
    sendJson(response, 200, {
      bucketMs,
      collectMs: statsCollectMs,
      granularity,
      hours,
      points: series.length,
      retentionDays: granularity === "day" ? statsDailyRetentionDays : statsHistoryDays,
      series,
      since,
      source: granularity === "day" ? "stats-daily" : "stats-history",
    });
    return;
  }

  if (url.pathname === "/api/recent") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const secondsParam = url.searchParams.has("seconds") ? Number(url.searchParams.get("seconds")) : NaN;
    const seconds = Number.isFinite(secondsParam) ? Math.min(Math.max(1, secondsParam), 120) : 30;
    const limitParam = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : NaN;
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 5_000) : 5_000;
    const cutoff = Date.now() - seconds * 1000;
    const packets = recentPackets.values()
      .filter((packet) => {
        const observedAt = Date.parse(packet.latest);
        return Number.isFinite(observedAt) && observedAt >= cutoff;
      })
      .slice(-limit);
    sendJson(response, 200, { count: packets.length, packets, seconds });
    return;
  }

  if (url.pathname === "/api/node-history") {
    if (request.method !== "GET") {
      methodNotAllowed(response, "GET");
      return;
    }
    const key = String(url.searchParams.get("key") || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč uzlu." });
      return;
    }
    const requestedDays = Number(url.searchParams.get("days") || 7);
    const days = Number.isFinite(requestedDays) ? Math.min(30, Math.max(1, requestedDays)) : 7;
    sendJson(response, 200, { key, days, samples: metricsStore.history(key, days) });
    return;
  }

  if (url.pathname === "/api/node-health") {
    if (request.method !== "GET") {
      methodNotAllowed(response, "GET");
      return;
    }
    const key = String(url.searchParams.get("key") || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      sendJson(response, 400, { error: "Neplatný klíč uzlu." });
      return;
    }
    const requestedDays = Number(url.searchParams.get("days") || 7);
    const days = Number.isFinite(requestedDays) ? Math.min(90, Math.max(1, requestedDays)) : 7;
    const data = healthStore.history(key, days);
    if (!data) {
      sendJson(response, 400, { error: "Neplatný klíč uzlu." });
      return;
    }
    sendJson(response, 200, { key, ...data });
    return;
  }

  const terrainMatch = /^\/api\/terrain\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
  if (terrainMatch) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const zoom = Number(terrainMatch[1]);
    const x = Number(terrainMatch[2]);
    const y = Number(terrainMatch[3]);
    const maxIndex = zoom >= 0 && zoom <= 14 ? 2 ** zoom - 1 : -1;
    if (maxIndex < 0 || x > maxIndex || y > maxIndex) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid tile");
      return;
    }
    const cached = terrainCacheGet(`${zoom}/${x}/${y}`);
    if (!cached) {
      const rate = checkTerrainRate(clientIp(request));
      if (!rate.ok) {
        response.writeHead(429, {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(rate.retryAfter),
        }).end("Too Many Requests");
        return;
      }
    }
    try {
      const tile = await fetchTerrainTile(zoom, x, y);
      response.writeHead(200, {
        "Content-Type": tile.contentType,
        "Content-Length": tile.body.length,
        "Cache-Control": "public, max-age=604800, immutable",
      });
      response.end(request.method === "HEAD" ? undefined : tile.body);
    } catch (error) {
      const status = error?.status === 404 ? 404 : 502;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Tile not found" : "Terrain unavailable");
    }
    return;
  }

  if (url.pathname === "/api/elevation") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      methodNotAllowed(response, "GET");
      return;
    }
    const lats = (url.searchParams.get("latitude") || "").split(",").filter((value) => value.trim() !== "");
    const lons = (url.searchParams.get("longitude") || "").split(",").filter((value) => value.trim() !== "");
    if (!lats.length || lats.length !== lons.length || lats.length > elevationMaxPoints) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Neplatný seznam souřadnic." }));
      return;
    }
    const points = lats.map((lat, index) => ({ lat: Number(lat), lon: Number(lons[index]) }));
    if (points.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon))) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Neplatný seznam souřadnic." }));
      return;
    }
    const controller = new AbortController();
    let clientDisconnected = false;
    const disconnect = () => {
      if (!response.writableEnded) {
        clientDisconnected = true;
        controller.abort();
      }
    };
    response.once("close", disconnect);
    const timeout = setTimeout(() => controller.abort(), elevationTimeoutMs);
    timeout.unref();
    try {
      const elevations = await queueElevation(() => resolveElevations(points, controller.signal));
      if (clientDisconnected || response.destroyed) return;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ elevation: elevations }));
    } catch {
      if (clientDisconnected || response.destroyed) return;
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Výšky se nepodařilo načíst." }));
    } finally {
      clearTimeout(timeout);
      response.off("close", disconnect);
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const allowed = allowedApiPaths.some((path) => url.pathname === path);
    if (!allowed) {
      response.writeHead(404).end("Unknown API endpoint");
      return;
    }

    const controller = new AbortController();
    const isStatsPath = url.pathname === "/api/stats" && !url.search;
    let clientDisconnected = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, isStatsPath ? statsTimeoutMs : upstreamTimeoutMs);
    timeout.unref();
    const disconnect = () => {
      if (!response.writableEnded) {
        clientDisconnected = true;
        controller.abort();
      }
    };
    response.once("close", disconnect);

    const isNodes = url.pathname === "/api/nodes";
    const isResolve = url.pathname === "/api/resolve-hops";
    const isStats = isStatsPath;
    const cacheKey = `${url.pathname}${url.search}`;
    if (isNodes && nodesCache && nodesCacheFresh()) {
      const stale = Date.now() - Number(nodesCache.at || 0) > nodesSoftTtlMs;
      clearTimeout(timeout);
      sendJson(
        response,
        200,
        buildNodesPayload(JSON.parse(nodesCache.body)),
        stale ? { "X-Data-Stale": "1" } : {},
      );
      if (stale) void collectNodeMetrics();
      return;
    }
    if (isStats && statsCache && statsCacheFresh()) {
      const stale = Date.now() - Number(statsCache.at || 0) > statsSoftTtlMs;
      clearTimeout(timeout);
      sendStatsCache(response, stale);
      if (stale) void refreshStatsCache();
      return;
    }
    try {
      const upstreamResponse = await fetch(`${upstream}${url.pathname}${url.search}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (isNodes && upstreamResponse.ok) {
        const data = await upstreamResponse.json();
        storeNodesCache(data);
        sendJson(response, upstreamResponse.status, buildNodesPayload(data));
        return;
      }
      const body = Buffer.from(await upstreamResponse.arrayBuffer());
      if (upstreamResponse.ok && isStats) {
        storeStatsCache(body, upstreamResponse.headers.get("content-type"));
      }
      if (upstreamResponse.ok && isResolve) {
        resolveCacheSet(cacheKey, body, upstreamResponse.headers.get("content-type"));
      }
      if (!upstreamResponse.ok && isNodes && nodesCacheFresh()) {
        sendJson(response, 200, buildNodesPayload(JSON.parse(nodesCache.body)), { "X-Data-Stale": "1" });
        return;
      }
      if (!upstreamResponse.ok && isStats && statsCacheFresh()) {
        sendStatsCache(response, true);
        return;
      }
      if (!upstreamResponse.ok && isStats && sendStatsFallback(response)) {
        return;
      }
      if (!upstreamResponse.ok && isResolve) {
        const cached = resolveCacheGet(cacheKey);
        if (cached) {
          response.writeHead(200, {
            "Content-Type": cached.contentType || "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Data-Stale": "1",
          });
          response.end(cached.body);
          return;
        }
      }
      response.writeHead(upstreamResponse.status, {
        "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      if (clientDisconnected || response.destroyed) return;
      if (isNodes && nodesCacheFresh()) {
        sendJson(response, 200, buildNodesPayload(JSON.parse(nodesCache.body)), { "X-Data-Stale": "1" });
        return;
      }
      if (isStats && statsCacheFresh()) {
        sendStatsCache(response, true);
        return;
      }
      if (isStats && sendStatsFallback(response)) {
        return;
      }
      if (isResolve) {
        const cached = resolveCacheGet(cacheKey);
        if (cached) {
          response.writeHead(200, {
            "Content-Type": cached.contentType || "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Data-Stale": "1",
          });
          response.end(cached.body);
          return;
        }
      }
      response.writeHead(timedOut ? 504 : 502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: timedOut ? "Analyzer API timed out" : "Analyzer API is unavailable",
      }));
    } finally {
      clearTimeout(timeout);
      response.off("close", disconnect);
    }
    return;
  }

  const changelogPath = sitePath("/changelog");
  const changelogPaths = new Set(["/changelog", "/changelog/", changelogPath, `${changelogPath}/`]);
  if (changelogPaths.has(decodedPathname)) {
    const changelogFile = join(dist, "changelog.html");
    if (!existsSync(changelogFile)) {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Changelog není k dispozici");
      return;
    }
    sendFile(response, changelogFile);
    return;
  }

  const relativePath = normalize(decodedPathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(dist, relativePath === "/" ? "index.html" : relativePath);
  if (!filePath.startsWith(dist)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(dist, "index.html");
  if (!existsSync(filePath)) {
    response.writeHead(503).end("Run npm run build first");
    return;
  }
  sendFile(response, filePath);
}

  return handleRequest;
}
