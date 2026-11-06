import { escapeHtml } from "./html.mjs";

export function createAdminPages({
  adminBasePath,
  adminPath,
  sitePath,
  formatCsDate,
  photoStore,
  visitStore,
  feedbackStore,
  commentStore,
  nodeInfoStore,
  photoAutoApprove,
  repeaterImportEnabled,
  photoNodeNames,
  isMqttConnected,
  packetStreamCount,
}) {
function renderAdminLogin({ error = "", next = adminBasePath, retryAfter = 0 } = {}) {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Administrace · MeshCore CZ</title>
<style>
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
.card { width:min(390px, 100%); padding:26px; border:1px solid rgba(30,65,49,.16); border-radius:16px; background:#fffef9; box-shadow:0 18px 50px rgba(20,42,32,.12); }
.brand { color:#078e62; font:800 18px/1.1 Manrope, system-ui, sans-serif; letter-spacing:.02em; }
.brand span { color:#87978f; font:10px "DM Mono", monospace; letter-spacing:.08em; vertical-align:2px; margin-left:5px; }
h1 { margin:22px 0 4px; font-size:22px; }
p { margin:0 0 16px; color:#667b70; }
label { display:flex; flex-direction:column; gap:6px; color:#49665b; font:10px "DM Mono", monospace; }
input { width:100%; padding:10px 11px; border:1px solid rgba(30,65,49,.22); border-radius:8px; color:#182820; background:#fff; font:14px Manrope, system-ui, sans-serif; }
input:focus { outline:2px solid #078e62; outline-offset:1px; }
button { width:100%; margin-top:14px; padding:10px 14px; border:1px solid #078e62; border-radius:8px; color:#fff; background:#078e62; font:700 13px Manrope, system-ui, sans-serif; cursor:pointer; }
button:hover { background:#067a54; }
.error { padding:8px 10px; border-radius:7px; color:#a32920; background:#fbeceb; font-size:12px; }
.hint { margin:14px 0 0; font:10px/1.5 "DM Mono", monospace; color:#87978f; }
.back { display:inline-block; margin-top:18px; color:#49665b; font-size:12px; text-decoration:none; }
.back:hover { color:#078e62; }
</style>
</head>
<body>
<main class="card">
  <div class="brand">MESHCORE <span>ADMIN</span></div>
  <h1>Administrace</h1>
  <p>Zadejte heslo pro přístup ke správě fotek a zpětné vazby.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="${adminPath("/login")}">
    <input type="hidden" name="next" value="${escapeHtml(next)}" />
    <label>Heslo
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    <button type="submit">Přihlásit se</button>
  </form>
  ${retryAfter ? `<p class="hint">Další pokus za ${Math.ceil(retryAfter / 60)} min.</p>` : ""}
  <a class="back" href="${sitePath("/")}">← Zpět na mapu</a>
</main>
</body>
</html>`;
}

function adminLayout({ active = "", content = "", title = "Administrace" }) {
  const links = [
    ["dashboard", adminPath(), "Přehled"],
    ["photos", adminPath("/photos"), "Fotky"],
    ["reports", adminPath("/photos?status=reports"), "Žádosti"],
    ["feedback", adminPath("/feedback"), "Zpětná vazba"],
    ["comments", adminPath("/comments"), `Komentáře${commentStore.count() ? ` (${commentStore.count()})` : ""}`],
    ["nodeinfo", adminPath("/node-info"), `Info nodů${nodeInfoStore.pendingCount() ? ` (${nodeInfoStore.pendingCount()})` : ""}`],
    ...(repeaterImportEnabled ? [["import", adminPath("/repeater-import"), "Import z wiki"], ["sync", adminPath("/repeater-sync"), "Sync z wiki"], ["syncall", adminPath("/repeater-sync-all"), "Sync vše"]] : []),
  ].map(([key, href, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(title)} · MeshCore CZ</title>
<style>
* { box-sizing:border-box; }
body { margin:0; padding:0 0 40px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
header { display:flex; flex-wrap:wrap; align-items:center; gap:12px 18px; padding:14px 24px; border-bottom:1px solid rgba(30,65,49,.14); background:#fffef9; }
.brand { color:#078e62; font:800 16px/1.1 Manrope, system-ui, sans-serif; text-decoration:none; }
.brand span { color:#87978f; font:9px "DM Mono", monospace; letter-spacing:.08em; vertical-align:2px; margin-left:5px; }
nav { display:flex; flex-wrap:wrap; gap:4px; }
nav a { padding:6px 10px; border-radius:6px; color:#49665b; text-decoration:none; font-size:12px; }
nav a:hover { background:#f1f5f3; }
nav a.active { color:#fff; background:#078e62; }
.header-actions { display:flex; align-items:center; gap:12px; margin-left:auto; }
.header-actions a { color:#49665b; font-size:12px; text-decoration:none; }
.header-actions a:hover { color:#078e62; }
.logout { padding:6px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; color:#49665b; background:#fff; font:12px Manrope, system-ui, sans-serif; cursor:pointer; }
.logout:hover { color:#a32920; border-color:#d9a6a2; }
main { width:min(1120px, 100%); margin:24px auto; padding:0 16px; }
h1 { margin:0 0 4px; font-size:22px; }
h2 { margin:0 0 12px; font-size:16px; }
.sub { margin:0 0 18px; color:#667b70; font-size:12px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(155px, 1fr)); gap:12px; margin-bottom:22px; }
.card { padding:14px 16px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fffef9; }
.card .label { margin-bottom:4px; color:#667b70; font:10px "DM Mono", monospace; text-transform:uppercase; letter-spacing:.04em; }
.card .value { font-size:22px; font-weight:800; line-height:1.15; }
.card .value.online { color:#078e62; }
.card .value.offline { color:#b27616; }
.card a { color:inherit; text-decoration:none; }
.card a:hover .value { color:#078e62; }
.card small { display:block; margin-top:4px; color:#87978f; font-size:11px; }
.split { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; align-items:start; }
@media (max-width: 760px) { .split { grid-template-columns:1fr; } header { padding:12px 14px; } }
.panel { padding:16px 18px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fffef9; }
.panel + .panel { margin-top:16px; }
.tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
.tabs a { padding:5px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; color:#49665b; text-decoration:none; font-size:12px; }
.tabs a.active { color:#fff; border-color:#078e62; background:#078e62; }
.list { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
.photo { display:flex; gap:12px; padding:10px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fff; }
.photo.hidden { opacity:.55; }
.thumb { flex:0 0 150px; width:150px; height:110px; display:block; overflow:hidden; border-radius:8px; background:#f1f5f3; }
.thumb img { display:block; width:100%; height:100%; object-fit:cover; }
.thumb.missing { border:1px dashed rgba(30,65,49,.2); }
.body { min-width:0; flex:1; }
.meta { margin-bottom:4px; color:#667b70; font:11px "DM Mono", monospace; }
.node { font-weight:700; }
.node a { color:#182820; text-decoration:none; }
.node a:hover { color:#078e62; }
.author, .contact { color:#49665b; font-size:12px; }
p { margin:4px 0; white-space:pre-wrap; }
.actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:8px; }
.actions button { padding:5px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; background:#fff; font:12px Manrope, system-ui, sans-serif; cursor:pointer; }
.actions button:hover { border-color:#078e62; color:#078e62; }
.actions button.approve { color:#078e62; border-color:rgba(7,142,98,.45); }
.actions button.cover { color:#078e62; border-color:rgba(7,142,98,.45); }
.actions button.hide { color:#b27616; border-color:rgba(178,118,22,.4); }
.cover-badge { display:inline-block; margin-right:6px; padding:1px 6px; border-radius:999px; color:#078e62; background:rgba(7,142,98,.12); font:700 9px "DM Mono", monospace; letter-spacing:.04em; text-transform:uppercase; }
.admin-comment { padding:11px 13px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fff; }
.admin-comment .meta { margin-bottom:3px; color:#667b70; font:11px "DM Mono", monospace; }
.admin-comment .node a { color:#182820; text-decoration:none; }
.admin-comment .node a:hover { color:#078e62; }
.admin-comment p { margin:5px 0; white-space:pre-wrap; }
.sync-compare { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:10px 0; }
.sync-compare > div { min-width:0; padding:9px; border:1px solid rgba(30,65,49,.14); border-radius:8px; background:#fffef9; }
.sync-compare strong { display:block; margin-bottom:5px; color:#667b70; font:10px "DM Mono", monospace; text-transform:uppercase; }
.sync-compare pre { max-height:220px; margin:0; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.45 Manrope, system-ui, sans-serif; }
.sync-photos { display:grid; gap:5px; margin:6px 0 12px; padding:0; list-style:none; }
.sync-photos label, .sync-check { display:flex; align-items:center; gap:7px; font-size:12px; }
.sync-photos input, .sync-check input { accent-color:#078e62; }
.sync-all-list { margin:10px 0 14px; }
.sync-all-list li { padding:10px 12px; border:1px solid rgba(30,65,49,.14); border-radius:8px; background:#fff; }
.sync-all-list li + li { margin-top:7px; }
.sync-all-list .sync-check { display:flex; align-items:center; gap:8px; }
.sync-preview { max-height:180px; margin:5px 0 8px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.4 "DM Mono", monospace; }
@media (max-width:700px) { .sync-compare { grid-template-columns:1fr; } }
.actions button.delete { color:#c0392b; border-color:rgba(192,57,43,.4); }
.actions a.edit { padding:5px 10px; border:1px solid rgba(7,142,98,.45); border-radius:6px; color:#078e62; background:#fff; font:12px Manrope, system-ui, sans-serif; text-decoration:none; }
.actions a.edit:hover { color:#fff; background:#078e62; }
.admin-edit-form { display:flex; flex-direction:column; gap:12px; max-width:760px; }
.admin-edit-form label { display:flex; flex-direction:column; gap:5px; color:#49665b; font:10px "DM Mono", monospace; }
.admin-edit-form input, .admin-edit-form textarea { width:100%; padding:9px 10px; border:1px solid rgba(30,65,49,.22); border-radius:7px; color:#182820; background:#fff; font:13px Manrope, system-ui, sans-serif; }
.admin-edit-form textarea { min-height:180px; resize:vertical; }
.feedback-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; }
.feedback-actions a, .feedback-actions button { padding:8px 13px; border:1px solid rgba(30,65,49,.2); border-radius:7px; color:#49665b; background:#fff; font:12px Manrope, system-ui, sans-serif; text-decoration:none; cursor:pointer; }
.feedback-actions button { color:#fff; border-color:#078e62; background:#078e62; }
.feedback-actions button:hover { background:#067a54; }
.empty { margin:0; color:#667b70; }
.feedback li { padding:12px 14px; border:1px solid rgba(30,65,49,.14); border-radius:10px; background:#fff; }
.feedback li.is-hidden { opacity:.55; }
.feedback .actions { margin-top:8px; }
.quick { display:flex; flex-wrap:wrap; gap:8px; }
.quick a { padding:7px 11px; border:1px solid rgba(7,142,98,.35); border-radius:7px; color:#078e62; background:#fff; text-decoration:none; font-size:12px; }
.quick a:hover { color:#fff; background:#078e62; }
</style>
</head>
<body>
<header>
  <a class="brand" href="${adminPath()}">MESHCORE <span>ADMIN</span></a>
  <nav>${links}</nav>
  <div class="header-actions">
    <a href="${sitePath("/")}" target="_blank" rel="noreferrer">Mapa ↗</a>
    <form method="post" action="${adminPath("/logout")}"><button class="logout" type="submit">Odhlásit</button></form>
  </div>
</header>
<main>
${content}
</main>
</body>
</html>`;
}

function adminDashboardPage() {
  const stats = photoStore.stats();
  const visits = visitStore.report(Date.now(), 14);
  const feedbackCount = feedbackStore.count();
  const commentCount = commentStore.count();
  const nodeInfoCount = nodeInfoStore.count();
  const nodeInfoPending = nodeInfoStore.pendingCount();
  const uptime = Math.floor(process.uptime());
  const uptimeLabel = `${Math.floor(uptime / 3600)} h ${Math.floor((uptime % 3600) / 60)} min`;
  return adminLayout({
    active: "dashboard",
    title: "Přehled",
    content: `
<h1>Přehled</h1>
<p class="sub">Stav administrace a rychlé odkazy.${photoAutoApprove ? " Fotky se zveřejňují automaticky a nové najdeš v sekci Fotky." : ""}</p>
<div class="cards">
  <div class="card"><div class="label">Fotky čekající</div><a href="${adminPath("/photos?status=pending")}"><div class="value">${formatAdminNumber(stats.pending)}</div></a><small>ke schválení</small></div>
  <div class="card"><div class="label">Otevřené žádosti</div><a href="${adminPath("/photos?status=reports")}"><div class="value">${formatAdminNumber(stats.reports)}</div></a><small>o smazání / nahlášení</small></div>
  <div class="card"><div class="label">Fotky celkem</div><a href="${adminPath("/photos?status=all")}"><div class="value">${formatAdminNumber(stats.total)}</div></a><small>${formatAdminNumber(stats.bytes)} B</small></div>
  <div class="card"><div class="label">Zpětná vazba</div><a href="${adminPath("/feedback")}"><div class="value">${formatAdminNumber(feedbackCount)}</div></a><small>uložených zpráv</small></div>
  <div class="card"><div class="label">Komentáře</div><a href="${adminPath("/comments")}"><div class="value">${formatAdminNumber(commentCount)}</div></a><small>u nodů</small></div>
  <div class="card"><div class="label">Info nodů</div><a href="${adminPath("/node-info")}"><div class="value">${formatAdminNumber(nodeInfoCount)}</div></a><small>${nodeInfoPending ? `${formatAdminNumber(nodeInfoPending)} změn ke schválení` : "uživatelských popisů"}</small></div>
  <div class="card"><div class="label">Dnes návštěv</div><div class="value">${formatAdminNumber(visits.today.visits)}</div><small>${formatAdminNumber(visits.today.uniqueVisitors)} unikátních · peak ${formatAdminNumber(visits.today.peakViewers)}</small></div>
  <div class="card"><div class="label">MQTT</div><div class="value ${isMqttConnected() ? "online" : "offline"}">${isMqttConnected() ? "online" : "offline"}</div><small>${packetStreamCount()} připojených klientů</small></div>
</div>
<div class="split">
  <section class="panel">
    <h2>Rychlé akce</h2>
    <div class="quick">
      <a href="${adminPath("/photos?status=pending")}">Schvalovat fotky</a>
      <a href="${adminPath("/photos?status=reports")}">Řešit žádosti</a>
      <a href="${adminPath("/feedback")}">Projít zpětnou vazbu</a>
      <a href="${adminPath("/comments")}">Projít komentáře</a>
      <a href="${adminPath("/node-info")}">Kontrolovat info nodů</a>
      ${repeaterImportEnabled ? `<a href="${adminPath("/repeater-import")}">Import z meshcore.cz</a>` : ""}
      <a href="${sitePath("/api/health")}" target="_blank" rel="noreferrer">Health JSON</a>
    </div>
    <p class="sub" style="margin-top:16px; margin-bottom:0;">Provoz aplikace: ${escapeHtml(uptimeLabel)}.</p>
  </section>
  <section class="panel">
    <h2>Návštěvy</h2>
    <p class="sub" style="margin-bottom:8px;">Dnes: ${formatAdminNumber(visits.today.visits)} zobrazení, ${formatAdminNumber(visits.today.uniqueVisitors)} unikátních návštěvníků.</p>
    <p class="sub" style="margin-bottom:0;">Celkem: ${formatAdminNumber(visits.totals.visits)} zobrazení, peak ${formatAdminNumber(visits.totals.peakViewers)} diváků.</p>
  </section>
</div>`,
  });
}

function formatAdminNumber(value) {
  return new Intl.NumberFormat("cs-CZ").format(Number(value) || 0);
}

function adminPhotoRows(entries, names, status, covers = new Map()) {
  return entries.map((photo) => {
    const node = names.get(photo.nodeKey);
    const isCover = covers.get(photo.nodeKey) === photo.id;
    const nodeLabel = node ? `${node} · ${photo.nodeKey.slice(0, 8)}` : photo.nodeKey.slice(0, 16);
    const imageUrl = sitePath(`/api/photos/${encodeURIComponent(photo.id)}`);
    const actions = [
      photo.status !== "approved"
        ? '<button class="approve" name="action" value="approve" type="submit">Schválit</button>'
        : "",
      photo.status === "approved" && !isCover
        ? '<button class="cover" name="action" value="cover" type="submit">Nastavit jako náhled</button>'
        : "",
      photo.status !== "hidden"
        ? '<button class="hide" name="action" value="hide" type="submit">Skrýt</button>'
        : "",
      '<button class="delete" name="action" value="delete" type="submit">Smazat</button>',
    ].filter(Boolean).join("");
    return `
    <li class="photo ${escapeHtml(photo.status)}">
      <a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>
      <div class="body">
        <div class="meta">${isCover ? '<span class="cover-badge">Náhled</span>' : ""}${escapeHtml(photo.status)} · ${escapeHtml(formatCsDate(photo.createdAt))} · ${escapeHtml(photo.bytes)} B · ${photo.width || "?"}×${photo.height || "?"}</div>
        <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
        ${photo.author ? `<div class="author">${escapeHtml(photo.author)}</div>` : ""}
        ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ""}
        <form class="actions" method="post" action="${adminPath("/photos/moderate")}">
          <input type="hidden" name="id" value="${escapeHtml(photo.id)}" />
          <input type="hidden" name="status" value="${escapeHtml(status)}" />
          ${actions}
        </form>
      </div>
    </li>`;
  }).join("");
}

function adminPhotoPage(status) {
  const entries = status === "reports" ? [] : photoStore.listAdmin(status, 300);
  const reports = status === "reports" ? photoStore.listReports("open", 300) : [];
  const names = photoNodeNames();
  const covers = new Map(photoStore.listApprovedNodeCounts(10_000).map((node) => [node.nodeKey, node.coverId]));
  const stats = photoStore.stats();
  const labels = {
    all: "Vše",
    approved: "Schválené",
    hidden: "Skryté",
    pending: "Čekající",
    reports: `Žádosti${stats.reports ? ` (${stats.reports})` : ""}`,
  };
  const tabs = ["pending", "approved", "hidden", "all", "reports"].map((value) => {
    const active = status === value ? ' class="active"' : "";
    return `<a${active} href="${adminPath(`/photos?status=${value}`)}">${labels[value]}</a>`;
  }).join("");
  const reportReasons = {
    inappropriate: "Nevhodný obsah",
    other: "Jiné",
    owner: "Moje fotka",
    privacy: "Soukromí",
  };
  const reportRows = reports.map((report) => {
    const imageUrl = report.photo ? sitePath(`/api/photos/${encodeURIComponent(report.photo.id)}`) : null;
    const node = report.photo ? names.get(report.photo.nodeKey) : null;
    const nodeLabel = node ? `${node} · ${report.photo.nodeKey.slice(0, 8)}` : (report.photo ? report.photo.nodeKey.slice(0, 16) : report.photoId.slice(0, 16));
    const actions = [
      report.photo
        ? `<form class="actions" method="post" action="${adminPath("/photos/moderate")}">
             <input type="hidden" name="id" value="${escapeHtml(report.photoId)}" />
             <input type="hidden" name="status" value="reports" />
             <button class="delete" name="action" value="delete" type="submit">Smazat fotku</button>
           </form>`
        : '<span class="meta">Fotka už není dostupná</span>',
      `<form class="actions" method="post" action="${adminPath("/photos/moderate")}">
         <input type="hidden" name="report" value="${escapeHtml(report.id)}" />
         <input type="hidden" name="status" value="reports" />
         <button class="approve" name="action" value="dismiss" type="submit">Zamítnout žádost</button>
       </form>`,
    ].filter(Boolean).join("");
    return `
    <li class="photo report">
      ${imageUrl
        ? `<a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>`
        : '<div class="thumb missing"></div>'}
      <div class="body">
        <div class="meta">${escapeHtml(reportReasons[report.reason] || report.reason)} · ${escapeHtml(formatCsDate(report.createdAt))}</div>
        ${report.photo ? `<div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(report.photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>` : ""}
        ${report.message ? `<p>${escapeHtml(report.message)}</p>` : ""}
        ${report.contact ? `<div class="contact">Kontakt: ${escapeHtml(report.contact)}</div>` : ""}
        <div class="actions">${actions}</div>
      </div>
    </li>`;
  }).join("");
  return adminLayout({
    active: status === "reports" ? "reports" : "photos",
    title: "Fotky",
    content: `
<h1>Fotky</h1>
<p class="sub">${status === "reports" ? `${formatAdminNumber(reports.length)} otevřených žádostí` : `${formatAdminNumber(entries.length)} fotek v této kategorii`}.</p>
<nav class="tabs">${tabs}</nav>
${status === "reports"
  ? (reports.length ? `<ul class="list">${reportRows}</ul>` : '<p class="empty">Žádné otevřené žádosti.</p>')
  : (entries.length ? `<ul class="list">${adminPhotoRows(entries, names, status, covers)}</ul>` : '<p class="empty">Žádné fotky v této kategorii.</p>')}`,
  });
}

function adminCommentsPage() {
  const entries = commentStore.listAdmin(300);
  const names = photoNodeNames();
  const rows = entries.map((comment) => {
    const name = names.get(comment.nodeKey) || comment.nodeKey.slice(0, 16);
    return `
    <li class="admin-comment">
      <div class="meta">${escapeHtml(formatCsDate(comment.createdAt))}${comment.author ? ` · ${escapeHtml(comment.author)}` : ""}</div>
      <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(comment.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a></div>
      <p>${escapeHtml(comment.text)}</p>
      <form class="actions" method="post" action="${adminPath("/comments/delete")}">
        <input type="hidden" name="id" value="${escapeHtml(comment.id)}" />
        <button class="delete" type="submit">Smazat komentář</button>
      </form>
    </li>`;
  }).join("");
  return adminLayout({
    active: "comments",
    title: "Komentáře",
    content: `
<h1>Komentáře</h1>
<p class="sub">${formatAdminNumber(entries.length)} komentářů. Zveřejňují se ihned; zde je můžete smazat.</p>
${entries.length ? `<ul class="list">${rows}</ul>` : '<p class="empty">Zatím žádné komentáře.</p>'}`,
  });
}

function adminFeedbackPage() {
  const entries = feedbackStore.list(200);
  const rows = entries.map((entry) => {
    const flags = [entry.is_public ? "veřejné" : "soukromé", entry.hidden ? "skryté" : null].filter(Boolean).join(" · ");
    return `
    <li class="${entry.hidden ? "is-hidden" : ""}">
      <div class="meta">#${entry.id} · ${escapeHtml(formatCsDate(entry.created_at))} · ${escapeHtml(entry.category || "other")} · ${escapeHtml(flags)}</div>
      ${entry.name ? `<div class="node">${escapeHtml(entry.name)}</div>` : ""}
      <p>${escapeHtml(entry.message)}</p>
      ${entry.contact ? `<div class="contact">Kontakt: ${escapeHtml(entry.contact)}</div>` : ""}
      <form class="actions" method="post" action="${adminPath("/feedback/moderate")}">
        <input type="hidden" name="id" value="${escapeHtml(entry.id)}" />
        <input type="hidden" name="hidden" value="${entry.hidden ? "0" : "1"}" />
        <button class="${entry.hidden ? "approve" : "hide"}" type="submit">${entry.hidden ? "Zobrazit" : "Skrýt"}</button>
      </form>
    </li>`;
  }).join("");
  return adminLayout({
    active: "feedback",
    title: "Zpětná vazba",
    content: `
<h1>Zpětná vazba</h1>
<p class="sub">${formatAdminNumber(entries.length)} zpráv (nejnovější první).</p>
${entries.length ? `<ul class="list feedback">${rows}</ul>` : '<p class="empty">Zatím žádné zprávy.</p>'}`,
  });
}

function adminRepeaterImportPage({ node = null, page = null, slug = "", keyValue = "", error = "" } = {}) {
  const nodeLabel = node ? `${node.name || "Nod"} · ${node.key.slice(0, 8)}` : "";
  const preview = page && node ? `
    <section class="panel">
      <h2>Náhled stránky</h2>
      <p class="sub"><a href="${escapeHtml(page.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(page.title || page.slug)}</a>
        · ${formatAdminNumber(page.imageCount)} obrázků (import fotek zatím není zapnutý)</p>
      ${String(page.text || "").trim().length < 5 ? '<p class="feedback-status error">Stránka neobsahuje použitelný text k importu. Můžete použít jen odkaz ze stránky.</p>' : `
      <form class="admin-edit-form" method="post" action="${adminPath("/repeater-import")}">
        <input type="hidden" name="key" value="${escapeHtml(node.key)}" />
        <input type="hidden" name="sourceUrl" value="${escapeHtml(page.sourceUrl)}" />
        <input type="hidden" name="sourceTitle" value="${escapeHtml(page.title || page.slug)}" />
        <label>Text k importu
          <textarea name="text" rows="14" maxlength="1000" required>${escapeHtml(page.text)}</textarea>
        </label>
        <p class="sub">Zdroj: ${escapeHtml(page.sourceUrl)} · licence stránky je CC BY-SA, u fotek ji ověřte zvlášť.</p>
        <div class="feedback-actions">
          <a href="${adminPath("/node-info")}">Zrušit</a>
          <button type="submit">Uložit a zveřejnit info</button>
        </div>
      </form>`}
    </section>` : "";
  return adminLayout({
    active: "import",
    title: "Import z meshcore.cz",
    content: `
<h1>Import z meshcore.cz</h1>
<p class="sub">Načte text z veřejné stránky repeateru v namespace <code>repeatery</code>. Před uložením se zobrazí náhled; fotky se zatím neimportují.</p>
${error ? `<p class="feedback-status error">${escapeHtml(error)}</p>` : ""}
<section class="panel">
  <form class="admin-edit-form" method="get" action="${adminPath("/repeater-import")}">
    <label>Klíč nebo název nodu
      <input type="text" name="key" value="${escapeHtml(keyValue)}" placeholder="např. rip5.meshcore.cz" required />
    </label>
    <label>Stránka (slug, nepovinné)
      <input type="text" name="slug" value="${escapeHtml(slug)}" placeholder="rip5" />
    </label>
    <div class="feedback-actions"><button type="submit">Načíst náhled</button></div>
  </form>
  ${node ? `<p class="sub">Vybraný nod: <strong>${escapeHtml(nodeLabel)}</strong></p>` : ""}
</section>
${preview}`,
  });
}

function adminRepeaterSyncAllPage({ plans = [], message = "", error = "" } = {}) {
  const changed = plans.filter((plan) => !plan.error && (plan.textChanged || plan.missing.length));
  const rows = plans.map((plan) => {
    const name = plan.nodeName || plan.info.nodeKey.slice(0, 12);
    if (plan.error) {
      return `<li><strong>${escapeHtml(name)}</strong><p class="sub">${escapeHtml(plan.error)}</p></li>`;
    }
    const changes = [
      plan.textChanged ? "text se změnil" : "text bez změny",
      plan.missing.length ? `${plan.missing.length} nových obrázků` : "žádné nové obrázky",
    ].join(" · ");
    const selectable = plan.textChanged || plan.missing.length;
    return `<li>
      <label class="sync-check"><input type="checkbox" name="key" value="${escapeHtml(plan.info.nodeKey)}" ${selectable ? "checked" : ""} ${selectable ? "" : "disabled"} />
        <strong>${escapeHtml(name)}</strong></label>
      <p class="sub">${escapeHtml(changes)}</p>
      <details><summary>Zobrazit text z wiki</summary><pre class="sync-preview">${escapeHtml(plan.page.text || "—")}</pre></details>
      <a class="edit" href="${adminPath(`/repeater-sync?key=${encodeURIComponent(plan.info.nodeKey)}`)}">Detailní sync</a>
    </li>`;
  }).join("");
  return adminLayout({
    active: "syncall",
    title: "Hromadný sync z wiki",
    content: `
<h1>Hromadný sync z wiki</h1>
<p class="sub">Porovnání všech importovaných nodů s aktuální wiki. Vyber nody a potvrď hromadný sync. Nic se nespouští automaticky.</p>
${message ? `<p class="sub imported">${escapeHtml(message)}</p>` : ""}
${error ? `<p class="feedback-status error">${escapeHtml(error)}</p>` : ""}
${changed.length ? `<form method="post" action="${adminPath("/repeater-sync-all")}"><ul class="list sync-all-list">${rows}</ul><div class="feedback-actions"><button type="submit">Synchronizovat vybrané (${formatAdminNumber(changed.length)})</button></div></form>` : '<p class="empty">Vše je aktuální, žádné změny k synchronizaci.</p>'}
`,
  });
}

function adminRepeaterSyncPage({ node = null, page = null, current = null, keyValue = "", error = "", message = "" } = {}) {
  const currentText = String(current?.text || "");
  const existingPhotos = node ? photoStore.listApproved(node.key, 12) : [];
  const existingCaptions = new Set(existingPhotos.map((photo) => photo.caption));
  const missing = page ? page.images.filter((file) => !existingCaptions.has(`${page.title || page.slug} · ${file}`)) : [];
  const nodeLabel = node ? `${node.name || "Nod"} · ${node.key.slice(0, 8)}` : "";
  const preview = page && node ? `
    <section class="panel">
      <h2>Stránka na meshcore.cz</h2>
      <p class="sub"><a href="${escapeHtml(page.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(page.title || page.slug)}</a>
        · ${formatAdminNumber(page.imageCount)} obrázků</p>
      <div class="sync-compare">
        <div><strong>Aktuální uložené info</strong><pre>${escapeHtml(currentText || "—")}</pre></div>
        <div><strong>Text na wiki</strong><pre>${escapeHtml(page.text || "—")}</pre></div>
      </div>
      <form class="admin-edit-form" method="post" action="${adminPath("/repeater-sync")}">
        <input type="hidden" name="key" value="${escapeHtml(node.key)}" />
        <input type="hidden" name="slug" value="${escapeHtml(page.slug)}" />
        <input type="hidden" name="sourceUrl" value="${escapeHtml(page.sourceUrl)}" />
        <input type="hidden" name="sourceTitle" value="${escapeHtml(page.title || page.slug)}" />
        <label class="sync-check"><input type="checkbox" name="syncText" value="1" ${current?.sourceUrl ? "checked" : ""} /> Aktualizovat text z wiki</label>
        ${missing.length ? `<h3>Nové obrázky</h3><ul class="sync-photos">${missing.map((file) => `
          <li><label><input type="checkbox" name="photo" value="${escapeHtml(file)}" checked /> ${escapeHtml(file)}</label></li>`).join("")}</ul>` : '<p class="sub">Na wiki nejsou žádné nové obrázky.</p>'}
        <div class="feedback-actions">
          <a href="${adminPath("/node-info")}">Zrušit</a>
          <button type="submit">Provést ruční sync</button>
        </div>
      </form>
    </section>` : "";
  return adminLayout({
    active: "sync",
    title: "Sync z wiki",
    content: `
<h1>Ruční sync z meshcore.cz</h1>
<p class="sub">Porovná uložené uživatelské info s aktuální wiki stránkou. Nic se nespouští automaticky; změny potvrdíte tlačítkem.</p>
<p class="sub"><a href="${adminPath("/repeater-sync-all")}">Přejít na hromadný sync</a></p>
${message ? `<p class="sub imported">${escapeHtml(message)}</p>` : ""}
${error ? `<p class="feedback-status error">${escapeHtml(error)}</p>` : ""}
<section class="panel">
  <form class="admin-edit-form" method="get" action="${adminPath("/repeater-sync")}">
    <label>Klíč nebo název nodu
      <input type="text" name="key" value="${escapeHtml(keyValue)}" placeholder="např. rip5.meshcore.cz" required />
    </label>
    <div class="feedback-actions"><button type="submit">Načíst rozdíly</button></div>
  </form>
  ${node ? `<p class="sub">Vybraný nod: <strong>${escapeHtml(nodeLabel)}</strong></p>` : ""}
</section>
${preview}`,
  });
}

function adminNodeInfoPage(imported = false, synced = false) {
  const entries = nodeInfoStore.list(500);
  const pending = nodeInfoStore.listPending(500);
  const names = photoNodeNames();
  const pendingRows = pending.map((info) => {
    const node = names.get(info.nodeKey);
    const nodeLabel = node ? `${node} · ${info.nodeKey.slice(0, 8)}` : info.nodeKey.slice(0, 16);
    return `
    <li>
      <div class="meta">${escapeHtml(formatCsDate(info.createdAt))}${info.author ? ` · ${escapeHtml(info.author)}` : ""}</div>
      <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(info.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
      <div class="meta">Aktuální zveřejněný text</div>
      <p>${escapeHtml(info.currentText || "—")}</p>
      <div class="meta">Navrhovaná změna</div>
      <p>${escapeHtml(info.text)}</p>
      <form class="actions" method="post" action="${adminPath("/node-info/moderate")}">
        <input type="hidden" name="key" value="${escapeHtml(info.nodeKey)}" />
        <button class="approve" name="action" value="approve" type="submit">Schválit změnu</button>
        <button class="delete" name="action" value="reject" type="submit">Zamítnout</button>
      </form>
    </li>`;
  }).join("");
  const rows = entries.map((info) => {
    const node = names.get(info.nodeKey);
    const nodeLabel = node ? `${node} · ${info.nodeKey.slice(0, 8)}` : info.nodeKey.slice(0, 16);
    return `
    <li>
      <div class="meta">${escapeHtml(formatCsDate(info.updatedAt))}${info.author ? ` · ${escapeHtml(info.author)}` : ""}</div>
      <div class="node"><a href="${sitePath("/")}?node=${encodeURIComponent(info.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
      <p>${escapeHtml(info.text)}</p>
      <div class="actions">
        <a class="edit" href="${adminPath(`/node-info/edit?key=${encodeURIComponent(info.nodeKey)}`)}">Upravit</a>
        ${repeaterImportEnabled ? (info.sourceUrl
          ? `<a class="edit" href="${adminPath(`/repeater-sync?key=${encodeURIComponent(info.nodeKey)}`)}">Sync z wiki</a>`
          : `<a class="edit" href="${adminPath(`/repeater-import?key=${encodeURIComponent(info.nodeKey)}`)}">Import z wiki</a>`) : ""}
        <form method="post" action="${adminPath("/node-info/delete")}">
          <input type="hidden" name="key" value="${escapeHtml(info.nodeKey)}" />
          <button class="delete" type="submit">Smazat info</button>
        </form>
      </div>
    </li>`;
  }).join("");
  return adminLayout({
    active: "nodeinfo",
    title: "Info nodů",
    content: `
<h1>Info nodů</h1>
<p class="sub">${formatAdminNumber(entries.length)} zveřejněných popisů${pending.length ? ` · ${formatAdminNumber(pending.length)} změn ke schválení` : ""}.</p>
${imported ? '<p class="sub imported">Import z meshcore.cz byl uložen.</p>' : ""}
${synced ? '<p class="sub imported">Sync z meshcore.cz byl uložen.</p>' : ""}
${pending.length ? `<h2>Změny ke schválení</h2><ul class="list feedback">${pendingRows}</ul>` : ""}
<h2>Zveřejněné info</h2>
${entries.length ? `<ul class="list feedback">${rows}</ul>` : '<p class="empty">Zatím žádné uživatelské info.</p>'}`,
  });
}

function adminNodeInfoEditPage(info) {
  const pending = nodeInfoStore.getPending(info.nodeKey);
  return adminLayout({
    active: "nodeinfo",
    title: "Upravit info nodu",
    content: `
<h1>Upravit info nodu</h1>
<p class="sub">${info.protected ? "Záznam je chráněný heslem." : "Záznam není chráněný heslem."} Uložení se zveřejní ihned.</p>
${pending ? '<p class="sub">Pozor: existuje čekající návrh změny. Uložením tohoto textu se návrh zruší.</p>' : ""}
<form class="admin-edit-form" method="post" action="${adminPath("/node-info/edit")}">
  <input type="hidden" name="key" value="${escapeHtml(info.nodeKey)}" />
  <label>Text info
    <textarea name="text" rows="10" maxlength="1000" required>${escapeHtml(info.text)}</textarea>
  </label>
  <label>Autor (nepovinné)
    <input type="text" name="author" maxlength="60" value="${escapeHtml(info.author || "")}" />
  </label>
  <div class="feedback-actions">
    <a href="${adminPath("/node-info")}">Zrušit</a>
    <button type="submit">Uložit a zveřejnit</button>
  </div>
</form>`,
  });
}
  return {
    renderAdminLogin,
    adminLayout,
    adminDashboardPage,
    formatAdminNumber,
    adminPhotoPage,
    adminCommentsPage,
    adminFeedbackPage,
    adminRepeaterImportPage,
    adminRepeaterSyncAllPage,
    adminRepeaterSyncPage,
    adminNodeInfoPage,
    adminNodeInfoEditPage,
  };
}
