import { escapeHtml } from "./html.mjs";

export function createLegacyPages({ photoStore, photoNodeNames, formatCsDate }) {
function renderFeedbackPage(entries, token) {
  const rows = entries.map((entry) => {
    const flags = [
      entry.is_public ? "veřejné" : "soukromé",
      entry.hidden ? "skryté" : null,
    ].filter(Boolean).join(" · ");
    const action = token
      ? `<a class="mod" href="/api/feedback/moderate?token=${encodeURIComponent(token)}&id=${entry.id}&hidden=${entry.hidden ? 0 : 1}">${entry.hidden ? "Zobrazit" : "Skrýt"}</a>`
      : "";
    return `
    <li${entry.hidden ? ' class="is-hidden"' : ""}>
      <div class="meta">#${entry.id} · ${escapeHtml(formatCsDate(entry.created_at))} · ${escapeHtml(entry.category || "other")} · ${escapeHtml(flags)}</div>
      ${entry.name ? `<div class="name">${escapeHtml(entry.name)}</div>` : ""}
      <p>${escapeHtml(entry.message)}</p>
      ${entry.contact ? `<div class="contact">Kontakt: ${escapeHtml(entry.contact)}</div>` : ""}
      ${action}
    </li>`;
  }).join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Zpětná vazba</title>
<style>
body { margin:0; padding:24px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
h1 { font-size:18px; margin:0 0 4px; }
.count { color:#667b70; font-size:12px; margin-bottom:16px; }
ul { list-style:none; margin:0; padding:0; }
li { background:#fff; border:1px solid rgba(30,65,49,.16); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
.meta { color:#667b70; font:11px "DM Mono", monospace; margin-bottom:6px; }
.name { font-weight:700; margin-bottom:3px; }
p { margin:0 0 6px; white-space:pre-wrap; }
.contact { color:#49665b; font-size:12px; }
.is-hidden { opacity:.55; }
.mod { display:inline-block; margin-top:6px; font-size:12px; color:#078e62; }
.empty { color:#667b70; }
</style>
</head>
<body>
<h1>Zpětná vazba</h1>
<div class="count">${entries.length} zpráv (nejnovější první)</div>
${entries.length ? `<ul>${rows}</ul>` : '<p class="empty">Zatím žádné zprávy.</p>'}
</body>
</html>`;
}

function renderPhotoPage(entries, reports, token, status, openReports) {
  const names = photoNodeNames();
  const covers = new Map(photoStore.listApprovedNodeCounts(10_000).map((node) => [node.nodeKey, node.coverId]));
  const labels = {
    all: "Vše",
    approved: "Schválené",
    hidden: "Skryté",
    pending: "Čekající",
    reports: `Žádosti${openReports ? ` (${openReports})` : ""}`,
  };
  const tabs = ["pending", "approved", "hidden", "all", "reports"].map((value) => {
    const active = status === value ? ' class="active"' : "";
    return `<a${active} href="view?token=${encodeURIComponent(token)}&status=${value}">${labels[value]}</a>`;
  }).join("");
  const rows = entries.map((photo) => {
    const imageUrl = `../photos/${encodeURIComponent(photo.id)}?token=${encodeURIComponent(token)}`;
    const node = names.get(photo.nodeKey);
    const isCover = covers.get(photo.nodeKey) === photo.id;
    const nodeLabel = node ? `${node} · ${photo.nodeKey.slice(0, 8)}` : photo.nodeKey.slice(0, 16);
    const actions = [
      photo.status !== "approved"
        ? `<a class="approve" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(photo.id)}&action=approve&status=${encodeURIComponent(status)}">Schválit</a>`
        : "",
      photo.status !== "hidden"
        ? `<a class="hide" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(photo.id)}&action=hide&status=${encodeURIComponent(status)}">Skrýt</a>`
        : "",
      `<a class="delete" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(photo.id)}&action=delete&status=${encodeURIComponent(status)}">Smazat</a>`,
    ].filter(Boolean).join("");
    return `
    <li class="photo ${escapeHtml(photo.status)}">
      <a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>
      <div class="body">
        <div class="meta">${isCover ? '<span class="cover-badge">Náhled</span>' : ""}${escapeHtml(photo.status)} · ${escapeHtml(formatCsDate(photo.createdAt))} · ${escapeHtml(photo.bytes)} B · ${photo.width || "?"}×${photo.height || "?"}</div>
        <div class="node"><a href="../../?node=${encodeURIComponent(photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>
        ${photo.author ? `<div class="author">${escapeHtml(photo.author)}</div>` : ""}
        ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ""}
        <div class="actions">${actions}</div>
      </div>
    </li>`;
  }).join("");
  const reportReasons = {
    inappropriate: "Nevhodný obsah",
    other: "Jiné",
    owner: "Moje fotka",
    privacy: "Soukromí",
  };
  const reportRows = reports.map((report) => {
    const imageUrl = report.photo
      ? `../photos/${encodeURIComponent(report.photo.id)}?token=${encodeURIComponent(token)}`
      : null;
    const node = report.photo ? names.get(report.photo.nodeKey) : null;
    const nodeLabel = node ? `${node} · ${report.photo.nodeKey.slice(0, 8)}` : (report.photo ? report.photo.nodeKey.slice(0, 16) : report.photoId.slice(0, 16));
    const actions = [
      report.photo
        ? `<a class="delete" href="moderate?token=${encodeURIComponent(token)}&id=${encodeURIComponent(report.photoId)}&action=delete&status=reports">Smazat fotku</a>`
        : '<span class="missing">Fotka už není dostupná</span>',
      `<a class="resolve" href="moderate?token=${encodeURIComponent(token)}&report=${encodeURIComponent(report.id)}&action=dismiss&status=reports">Zamítnout</a>`,
    ].filter(Boolean).join("");
    return `
    <li class="photo report">
      ${imageUrl
        ? `<a class="thumb" href="${imageUrl}" target="_blank" rel="noreferrer"><img src="${imageUrl}" alt="" loading="lazy" /></a>`
        : '<div class="thumb missing"></div>'}
      <div class="body">
        <div class="meta">${escapeHtml(reportReasons[report.reason] || report.reason)} · ${escapeHtml(formatCsDate(report.createdAt))}</div>
        ${report.photo ? `<div class="node"><a href="../../?node=${encodeURIComponent(report.photo.nodeKey)}" target="_blank" rel="noreferrer">${escapeHtml(nodeLabel)}</a></div>` : ""}
        ${report.photo?.caption ? `<div class="author">${escapeHtml(report.photo.caption)}</div>` : ""}
        ${report.message ? `<p>${escapeHtml(report.message)}</p>` : ""}
        ${report.contact ? `<div class="contact">Kontakt: ${escapeHtml(report.contact)}</div>` : ""}
        <div class="actions">${actions}</div>
      </div>
    </li>`;
  }).join("");
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fotky nodů</title>
<style>
body { margin:0; padding:24px; background:#e9e8e1; color:#182820; font:14px/1.5 Manrope, system-ui, sans-serif; }
h1 { font-size:18px; margin:0 0 4px; }
.count { color:#667b70; font-size:12px; margin-bottom:12px; }
.tabs { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.tabs a { padding:5px 10px; border:1px solid rgba(30,65,49,.2); border-radius:6px; color:#49665b; text-decoration:none; font-size:12px; }
.tabs a.active { color:#fff; background:#078e62; border-color:#078e62; }
ul { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
li.photo { display:flex; gap:12px; background:#fff; border:1px solid rgba(30,65,49,.16); border-radius:10px; padding:10px; }
li.photo.hidden { opacity:.55; }
.thumb { flex:0 0 150px; width:150px; height:110px; display:block; border-radius:8px; overflow:hidden; background:#f1f5f3; }
.thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.body { min-width:0; flex:1; }
.meta { color:#667b70; font:11px "DM Mono", monospace; margin-bottom:4px; }
.node { font-weight:700; }
.node a { color:#182820; text-decoration:none; }
.author { color:#49665b; font-size:12px; }
.contact { color:#49665b; font-size:12px; }
p { margin:4px 0; white-space:pre-wrap; }
.actions { display:flex; gap:10px; margin-top:6px; }
.actions a { font-size:12px; text-decoration:none; }
.approve { color:#078e62; }
.resolve { color:#078e62; }
.hide { color:#b27616; }
.delete { color:#c0392b; }
.missing { color:#667b70; font-size:12px; }
.thumb.missing { border:1px dashed rgba(30,65,49,.2); }
.empty { color:#667b70; }
</style>
</head>
<body>
<h1>Fotky nodů</h1>
<div class="count">${status === "reports" ? `${reports.length} žádostí` : `${entries.length} fotek`} (nejnovější první)</div>
<nav class="tabs">${tabs}</nav>
${status === "reports"
  ? (reports.length ? `<ul>${reportRows}</ul>` : '<p class="empty">Žádné otevřené žádosti.</p>')
  : (entries.length ? `<ul>${rows}</ul>` : '<p class="empty">Žádné fotky v této kategorii.</p>')}
</body>
</html>`;
}
  return { renderPhotoPage, renderFeedbackPage };
}
