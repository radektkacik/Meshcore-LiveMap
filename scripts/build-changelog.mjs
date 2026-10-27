import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

function codeValue(value) {
  const match = /`([^`]+)`/.exec(value || "");
  return match ? match[1] : String(value || "").trim();
}

function releaseEnvironment(change) {
  const match = /^(Beta|Prod|Stage)(?:\s+fix)?:\s*(.*)$/i.exec(change || "");
  if (!match) return { environment: "", text: change || "" };
  const environment = match[1].toLowerCase() === "prod" ? "Produkce" : "Beta";
  return { environment, text: match[2] };
}

export function releasesForEnvironment(rows, environment = "Produkce") {
  const wanted = environment === "Beta" ? "Beta" : "Produkce";
  return rows.filter((row) => row.environment === wanted);
}

export function parseReleases(markdown) {
  const rows = [];
  let index = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cells[0] || "")) continue;
    const release = codeValue(cells[1]);
    const build = codeValue(cells[2]);
    if (!release || !/^\d{8}-\d{4}/.test(build)) continue;
    const { environment, text } = releaseEnvironment(cells[3]);
    rows.push({
      build,
      date: cells[0],
      environment,
      index,
      release,
      text,
    });
    index += 1;
  }
  return rows.sort((left, right) => right.date.localeCompare(left.date) || right.index - left.index);
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return escapeHtml(value);
  return `${Number(match[3])}. ${Number(match[2])}. ${match[1]} ${match[4]}:${match[5]} UTC`;
}

function formatChange(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderChangelog({ buildId = "", environment = "Produkce", rows = [] } = {}) {
  const latest = rows[0];
  const environmentLabel = environment === "Beta" ? "Beta" : "Produkce";
  const historyLabel = environmentLabel === "Beta" ? "beta" : "produkčních";
  const historyFilter = environmentLabel === "Beta" ? "beta nasazení" : "produkční nasazení";
  const items = rows.map((row) => `
      <li class="release">
        <div class="release-meta">
          <time datetime="${escapeHtml(row.date.replace(" ", "T"))}Z">${formatDate(row.date)}</time>
          ${row.environment ? `<span class="environment ${row.environment === "Produkce" ? "production" : "beta"}">${escapeHtml(row.environment)}</span>` : ""}
          <code>${escapeHtml(row.build)}</code>
        </div>
        <p>${formatChange(row.text)}</p>
      </li>`).join("");

  return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f5f3ed" />
    <meta name="description" content="Historie změn a nasazených verzí MeshCore CZ live mapy (${environmentLabel})" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <title>Změny verzí · MeshCore CZ</title>
    <style>
      :root {
        color-scheme: light dark;
        --background: #f5f3ed;
        --card: #ffffff;
        --ink: #182820;
        --muted: #667b70;
        --line: rgba(30, 65, 49, 0.16);
        --green: #078e62;
        --green-soft: rgba(7, 142, 98, 0.12);
        --amber: #a5680f;
        --amber-soft: rgba(178, 118, 22, 0.13);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: #10171c;
          --card: #182229;
          --ink: #e8efef;
          --muted: #9aabb2;
          --line: rgba(210, 229, 222, 0.14);
          --green: #58c99d;
          --green-soft: rgba(88, 201, 157, 0.14);
          --amber: #e1b56e;
          --amber-soft: rgba(225, 181, 110, 0.14);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--background);
        color: var(--ink);
        font: 15px/1.55 Manrope, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main { width: min(940px, 100%); margin: 0 auto; padding: 34px 20px 64px; }
      header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 24px; }
      h1 { margin: 0; font-size: clamp(25px, 5vw, 38px); line-height: 1.1; letter-spacing: -0.02em; }
      .subtitle { margin: 8px 0 0; color: var(--muted); font-size: 13px; }
      .back {
        flex: none;
        padding: 8px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--ink);
        background: var(--card);
        font-size: 12px;
        text-decoration: none;
      }
      .back:hover { border-color: var(--green); color: var(--green); }
      .intro {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 26px;
      }
      .stat { padding: 15px 17px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
      .stat span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
      .stat strong { display: block; margin-top: 6px; font: 14px/1.35 "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
      .stat small { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; }
      .releases { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
      .release { padding: 16px 0 15px; border-bottom: 1px solid var(--line); }
      .release-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; }
      .release-meta time { font-family: "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
      .release-meta code { color: var(--muted); font: 11px/1.4 "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
      .environment { padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
      .environment.production { color: var(--green); background: var(--green-soft); }
      .environment.beta { color: var(--amber); background: var(--amber-soft); }
      .release p { margin: 7px 0 0; font-size: 14px; }
      .release p code { padding: 1px 4px; border-radius: 4px; background: var(--green-soft); font: 12px/1.4 "DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
      footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 28px; color: var(--muted); font-size: 11px; }
      footer a { color: inherit; text-underline-offset: 2px; }
      @media (max-width: 620px) {
        main { padding-top: 24px; }
        header { display: block; }
        .back { display: inline-block; margin-top: 16px; }
        .intro { grid-template-columns: 1fr; }
        footer { display: block; }
        footer span { display: block; margin-top: 6px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Změny verzí</h1>
          <p class="subtitle">Historie ${historyLabel} nasazení MeshCore CZ live mapy · ${rows.length} záznamů</p>
        </div>
        <a class="back" href="../">← Zpět na mapu</a>
      </header>
      <section class="intro" aria-label="Aktuální verze">
        <div class="stat">
          <span>Aktuální build</span>
          <strong>${escapeHtml(buildId || "—")}</strong>
          <small>build právě otevřené stránky</small>
        </div>
        <div class="stat">
          <span>Poslední zaznamenané nasazení</span>
          <strong>${latest ? escapeHtml(latest.build) : "—"}</strong>
          <small>${latest ? `${formatDate(latest.date)}${latest.environment ? ` · ${escapeHtml(latest.environment)}` : ""}` : "Historie není k dispozici"}</small>
        </div>
      </section>
      <ol class="releases">
${items}
      </ol>
      <footer>
        <span>Zdroj: <code>deploy/RELEASES.md</code> · zobrazena pouze ${historyFilter} · novější záznamy jsou nahoře · aktuální build může být novější než poslední zapsaný záznam</span>
        <a href="../">Zpět na mapu</a>
      </footer>
    </main>
  </body>
</html>
`;
}

export function buildChangelog(outDir = "dist", { buildId = "", environment = "Produkce" } = {}) {
  const root = process.cwd();
  const markdown = readFileSync(join(root, "deploy/RELEASES.md"), "utf8");
  const rows = releasesForEnvironment(parseReleases(markdown), environment);
  const target = resolve(root, outDir, "changelog.html");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderChangelog({ buildId, environment, rows }));
  return rows.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = process.argv[2] || "dist";
  const count = buildChangelog(outDir);
  console.log(`Changelog: ${outDir}/changelog.html (${count} záznamů)`);
}
