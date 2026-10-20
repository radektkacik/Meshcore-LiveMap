# Evidence nasazení a rollback (prod)

## Jak zálohy fungují

- `./deploy/update-vps.sh` (prod) a `./deploy/update-vps-staging.sh` (stage) vytvoří při každém nasazení zálohu
  `$APP_DIR/backups/<RELEASE_ID>.tar.gz` **ještě před výměnou souborů**.
- Záloha tedy obsahuje **stav před daným releasem** = verzi, na kterou se dá vrátit.
- Retence: 20 záloh (`BACKUP_RETENTION` v `deploy/apply-release.sh`).
- Prod `APP_DIR=/opt/meshcore-live-map`, port 4173, služba `meshcore-live-map`.
- Stage `APP_DIR=/opt/meshcore-live-map-stage`, port 4174, služba `meshcore-live-map-stage`.
- Záloha obsahuje i `data/` a `node_modules/` (~73–82 MB na kus).

## Přehled změn

| Datum (UTC) | Release ID / záloha | Build | Změna | Soubory |
| --- | --- | --- | --- | --- |
| 2026-09-25 13:45 | `20260925T134529Z.tar.gz` | `20260925-1345` | Serverový proxy `GET /api/elevation` (LRU cache + fallback na open-elevation) a přepnutí klienta na něj; klientská služba výšek s frontou/backoff/cooldownem | `server.mjs`, `src/elevation.js`, `src/main.js`, `dist`, `.env.example` |
| 2026-09-28 15:54 | `20260928T155406Z.tar.gz` | `20260928-1554` | A1–A5: defaulty `/api/history`; chybějící výška jako `null`; TTL+strop `prefixCache`; XFF bere poslední hop; `sendFile` error handler; nginx snippety přepsány na `$remote_addr` | `server.mjs`, `src/elevation.js`, `src/main.js`, `deploy/nginx-map-location.conf`, `deploy/nginx-map-stage-location.conf`, `test/*` |
| 2026-09-28 16:07 | `20260928T160730Z.tar.gz` | `20260928-1607` | Viewport culling tras: `bounds` v `routeRecord`, filtr dle `map.getBounds().pad(0.25)`, překreslení na `moveend`/`zoomend`/`resize`, `liveRouteCount` pro HUD/status | `src/main.js` |
| 2026-09-28 16:32 | `20260928T163214Z.tar.gz` | `20260928-1632` | Diagnostika výkonu: opt-in overlay `?perf=1` (FPS, max frame, počty tras/animovaných/prvků/uzlů/archivu, časy `syncRoute`/`sousedé`/`canvas`), `window.__perf` | `src/perf.js`, `src/main.js`, `src/style.css` |
| 2026-09-28 16:59 | `20260928T165927Z.tar.gz` | `20260928-1659` | Optimalizace vrstvy uzlů: viewport culling markerů (pad 0.25, otevřený popup vždy), debounce `refreshNodeState` 300 ms, `setStyle` jen při změně role/tier, `revealNodeMarker` před `openPopup` (soused/stats/hledání) | `src/main.js`, `src/perf.js` |
| 2026-09-28 17:25 | `20260928T172534Z.tar.gz` | `20260928-1725` | Výchozí režim animace tras přepnut na canvas (SVG přes `?anim=svg`); README aktualizováno | `src/main.js`, `README.md` |
| 2026-09-28 17:51 | `20260928T175149Z.tar.gz` | `20260928-1751` | Frekvence canvas animace tras snížena 15 → 10 FPS; README aktualizováno | `src/main.js`, `README.md` |
| 2026-09-28 20:07 | `20260928T200757Z.tar.gz` | `20260928-2007` | Detail uzlu se už nepřekresluje celý: aktualizují se jen měnící se části (poslední trasa, sousedé, stav) na místě + throttle 400 ms; scroll a otevřená nápověda zůstávají | `src/main.js` |
| 2026-10-15 09:50 | `20261015T095044Z.tar.gz` | `20261015-0950` | Nové (výchozí vypnuto): přepínač „Seskupovat podle paketu“ – seskupení tras dle hashe, seznam pozorování (observer, hopů, SNR), výběr trasy a režim „všechna pozorování tlumeně + vybrané zvýrazněně“; `groupRoutesByHash` + test | `src/main.js`, `src/route-model.js`, `src/style.css`, `index.html`, `test/route-model.test.mjs`, `README.md` |
| 2026-10-15 10:02 | `20261015T100235Z.tar.gz` | `20261015-1002` | Česká pluralizace počtu hopů a observerů v panelu aktivit a tooltipu (`formatHops`, `formatObservers`, `pluralCs`) | `src/main.js` |
| 2026-10-15 10:06 | `20261015T100640Z.tar.gz` | `20261015-1006` | Při výběru paketu se skryje běžná vrstva tras (`setLiveRoutesHidden`), aby živý provoz nesplýval s vybranou aktivitou; klik do mapy/zrušení výběru ji vrátí | `src/main.js` |
| 2026-10-15 11:00 | `20261015T110029Z.tar.gz` | `20261015-1100` | Výběr konkrétního pozorování zobrazí na mapě jen tu jednu trasu; „Zobrazit všechny trasy“ ukáže všechna pozorování paketu (vybrané zvýrazněně) | `src/main.js`, `README.md` |
| 2026-10-15 11:11 | `20261015T111102Z.tar.gz` | `20261015-1111` | Nevybraná pozorování v režimu „všechny trasy“ zvýrazněna (opacity 0,35 → 0,6, tloušťka 3 → 4) | `src/main.js` |
| 2026-10-15 11:15 | `20261015T111529Z.tar.gz` | `20261015-1115` | Zřetelné ukončení výběru paketu: lišta „Vybraný paket … / Zrušit výběr“ v panelu aktivit + klávesa Escape; vrací běžnou vrstvu tras | `src/main.js`, `src/style.css` |
| 2026-10-15 19:04 | `20261015T190459Z.tar.gz` | `20261015-1904` | Filtr provozu: (1) „Zobrazit jen trasy tohoto uzlu“ z detailu uzlu + lišta v HUD (`routeMatchesFocus`, filtruje live i archiv), (2) hledání observera a řazení (čas/SNR/hopy) v seznamu pozorování paketu s uchováním fokusu při překreslování | `src/main.js`, `src/style.css`, `index.html`, `README.md` |
| 2026-10-16 05:45 | `20261016T054545Z.tar.gz` | `20261016-0545` | Revert aktivita/seskupování + filtr uzlu (odebráno seskupování podle paketu, výběr pozorování, filtr „jen trasy uzlu“, vyhledávání/řazení pozorování); české skloňování ponecháno. Úpravy budou provedeny jinak. | `src/main.js`, `src/route-model.js`, `src/style.css`, `index.html`, `README.md`, `test/route-model.test.mjs` |
| 2026-10-18 08:16 | `20261018T081650Z.tar.gz` | `20261018-0816` | HUD: metriky „Trasy“/„Paketů/h“ menším písmem (label 10→9, hodnota 15→12, override 16→12, mobil 14→11); odstraněna poznámka „Data: CoreScope…“ (HTML i CSS) | `index.html`, `src/style.css` |
| 2026-10-18 11:14 | `20261018T111414Z.tar.gz` | `20261018-1114` | Dolů do HUD doplněna poznámka o zdroji: CoreScope / MeshCore CZ (živý MQTT feed, archiv z DB), šifrovaný obsah zpráv, podklady OSM/OpenTopoMap/Esri, výšky Open-Meteo, ikona selfh.st (CC BY 4.0) | `index.html`, `src/style.css` |
| 2026-10-18 19:23 | `20261018T192333Z.tar.gz` | `20261018-1923` | Detail uzlu: u metrik (užitečnost, pokrytí, podíl provozu, bridge, kritičnost, relay 1 h/24 h, bez scope, advertů) se zobrazuje celkové pořadí „#. z N“; nová `rankNodeMetric` + test | `src/main.js`, `src/node-model.js`, `test/node-model.test.mjs` |
| 2026-10-18 19:36 | `20261018T193604Z.tar.gz` | `20261018-1936` | U metrik v detailu uzlu jen pořadové číslo (např. „· 12.“) místo „12. z N“ | `src/main.js` |
| 2026-10-19 05:35 | `20261019T053546Z.tar.gz` | `20261019-0535` | Odolnost při výpadku CoreScope: cache `/api/nodes` (disk + paměť, TTL 7 dní) a `/api/resolve-hops` (paměť, 6 h) – při 502/timeout se servíruje poslední úspěšná data s hlavičkou `X-Data-Stale`; cache plní i 15min sběr metrik; test | `server.mjs`, `test/server.test.mjs` |
| 2026-10-19 05:47 | `20261019T054729Z.tar.gz` | `20261019-0547` | Z detailu uzlu odstraněn text „pozice uzlu X z Y“ | `src/main.js` |
| 2026-10-19 17:18 | `20261019T171856Z.tar.gz` (stage APP_DIR) | `20261019-1718` | Beta: build s base `/map/` do stage slotu (4174); nginx `2b.meshcore.cz/map/` → 4174, `/map-stage/` → 301 `/map/` | `dist`, `server.mjs`, nginx snippet |
| 2026-10-19 17:20 | `20261019T172030Z.tar.gz` | `20261019-1720` | Prod: build s base `/` do produkce (4173), nginx `mapa.meshcore.cz/` → 4173 (HTTP; TLS až po DNS). Deploy skripty: defaulty `/` + `mapa.meshcore.cz/`, health check na VPS | `dist`, `server.mjs`, `deploy/update-vps.sh`, `deploy/update-vps-staging.sh`, `deploy/nginx-*`, `README.md` |
| 2026-10-19 17:43 | nginx (live) | – | Cloudflare `real_ip` (`CF-Connecting-IP`) pro `mapa.meshcore.cz` – reálná klientská IP v logu, rate-limitu a statistice návštěv | `/etc/nginx/sites-available/mapa-meshcore` |
| 2026-10-19 18:03 | nginx (live) | – | Self-signed cert pro `mapa.meshcore.cz` (`/etc/ssl/mapa/`, platnost do 2046) + 443 server block → 4173 s CF `real_ip`; připraveno pro Cloudflare režim Full | `/etc/nginx/sites-available/mapa-meshcore`, `/etc/ssl/mapa/*`, `deploy/nginx-mapa-meshcore-ssl.conf` |
| 2026-10-19 19:22 | `20261019T192205Z.tar.gz` (stage APP_DIR) | `20261019-1922` | Beta: badge „BETA“ vlevo nahoře v HUD + title „MeshCore CZ · beta“; build flag `VITE_BETA=1` (prod `0`) | `index.html`, `src/style.css`, `src/main.js`, `deploy/update-vps-staging.sh`, `deploy/update-vps.sh` |
| 2026-10-19 19:35 | `20261019T193507Z.tar.gz` (stage APP_DIR) | `20261019-1935` | Beta: při překryvu uzlů je repeater vždy nahoře nad ostatními rolemi (`bringToFront`/`bringToBack`), včetně návratu do viewportu a změny role | `src/main.js` |
| 2026-10-19 19:36 | `20261019T193630Z.tar.gz` | `20261019-1936` | Prod: stejná změna řazení uzlů – repeater vždy nahoře nad ostatními rolemi při překryvu | `src/main.js` |
| 2026-10-19 19:38 | `20261019T193839Z.tar.gz` | `20261019-1938` | Prod fix: BETA badge se v produkci nezobrazuje – `[hidden]` v CSS přebíjel `display: inline-block` | `src/style.css` |
| 2026-10-19 19:39 | `20261019T193918Z.tar.gz` (stage APP_DIR) | `20261019-1939` | Beta: stejná CSS oprava `[hidden]`; badge na betě zůstává viditelný | `src/style.css` |
| 2026-10-19 19:52 | `20261019T195219Z.tar.gz` (stage APP_DIR) | `20261019-1952` | Beta: LOS – klik na uzel (včetně repeateru) použije jeho přesné souřadnice, neotevře popup; body A/B mají tooltip s názvem a rolí | `src/main.js` |
| 2026-10-19 19:54 | `20261019T195455Z.tar.gz` | `20261019-1954` | Prod: stejná LOS úprava – výběr uzlu/repeateru kliknutím, bez popupu, s tooltipem A/B | `src/main.js` |
| 2026-10-19 20:09 | `20261019T200950Z.tar.gz` (stage APP_DIR) | `20261019-2009` | Beta: odkaz „produkce ↗“ vedle BETA badge na produkční mapu; v produkčním buildu se nevytváří | `src/main.js`, `src/style.css` |
| 2026-10-19 20:21 | `20261019T202114Z.tar.gz` (stage APP_DIR) | `20261019-2021` | Beta: runtime i18n CZ/EN – přepínač jazyka v HUD, překlad statického HTML i dynamických textů, locale formátování čísel/datumů a plurály; výchozí čeština, volba v localStorage/`?lang=` | `src/i18n.js`, `src/main.js`, `src/style.css`, `test/i18n.test.mjs` |
| 2026-10-19 20:24 | `20261019T202436Z.tar.gz` | `20261019-2024` | Prod: runtime i18n CZ/EN – přepínač jazyka dostupný i v produkci (mimo beta flag), výchozí čeština, volba v localStorage/`?lang=` | `src/i18n.js`, `src/main.js`, `src/style.css`, `test/i18n.test.mjs` |
| 2026-10-20 11:32 | `20261020T113224Z.tar.gz` (stage APP_DIR) | `20261020-1132-1dadee5` | Beta: nasazení očištěného lockfile – odebrány nepoužívané Vue/Pinia/router, `ip-address` 10.7.4 a `source-map-js` 1.2.2; `npm audit --omit=dev` 0 zranitelností, bez změny aplikačního kódu | `package.json`, `package-lock.json` |
| 2026-10-20 12:07 | `20261020T120753Z.tar.gz` | `20261020-1207-c1ab98f` | Prod: stejné očištěné závislosti – `ip-address` 10.7.4, `source-map-js` 1.2.2, bez Vue/Pinia/router; `npm audit --omit=dev` 0 zranitelností | `package.json`, `package-lock.json` |
| 2026-10-20 13:18 | `20261020T131805Z.tar.gz` (stage APP_DIR) | `20261020-1318-d3a5663` | Beta: `mqtt` 5.15.2 → 5.16.1 (oprava reconnectu a streamu); MQTT connected/subscribed, `npm audit --omit=dev` 0 zranitelností | `package.json`, `package-lock.json` |
| 2026-10-20 13:18 | `20261020T131846Z.tar.gz` | `20261020-1318-d3a5663` | Prod: stejný `mqtt` 5.16.1; MQTT connected/subscribed, `npm audit --omit=dev` 0 zranitelností, bez změny aplikačního kódu | `package.json`, `package-lock.json` |
| 2026-10-20 13:57 | `20261020T135719Z.tar.gz` (stage APP_DIR) | `20261020-1357-357b614` | Beta: stack uzlů na stejném místě, sdílené odkazy s filtry, detail trasy, tmavá mapa, relativní časy a badge dat z cache | `index.html`, `src/i18n.js`, `src/main.js`, `src/style.css` |
| 2026-10-20 14:02 | `20261020T140236Z.tar.gz` (stage APP_DIR) | `20261020-1402-a089705` | Beta fix: výchozí střed mapy zpět na ČR, pokud URL neobsahuje `lat`/`lon` (chybějící parametry se dřív převedly na 0,0) | `src/main.js` |
| 2026-10-20 14:57 | `20261020T145738Z.tar.gz` (stage APP_DIR) | `20261020-1457-b49d8de` | Beta fix: tmavý podklad změněn z Carto (vyžaduje API key) na Esri World Dark Gray Base bez klíče; dlaždice se načítají, bez hlášky „API KEY REQUIRED“ | `src/main.js` |
| 2026-10-20 15:12 | `20261020T151232Z.tar.gz` (stage APP_DIR) | `20261020-1512-152f7e7` | Beta: tmavý podklad z OSM dlaždic + CSS filtr na `leaflet-layer` (bez API klíče, skutečně tmavý); ověřeno načtení dlaždic a filtr | `src/main.js`, `src/style.css` |
| 2026-10-20 15:21 | `20261020T152155Z.tar.gz` (stage APP_DIR) | `20261020-1521-c2eff41` | Beta fix: tmavý filtr aplikován přímo na OSM dlaždice (`leaflet-layer.dark-basemap .leaflet-tile`), ne na kontejner; bez API klíče | `src/style.css` |
| 2026-10-20 15:29 | `20261020T152959Z.tar.gz` (stage APP_DIR) | `20261020-1530-f389dce` | Beta: odebráno duplicitní tlačítko „Tmavá“ z podkladu mapy; tmavou mapu řídí horní přepínač tématu (OSM + filtr), OpenTopoMap/Satelitní zůstávají samostatné | `index.html`, `src/i18n.js`, `src/main.js` |
| 2026-10-20 16:03 | `20261020T160302Z.tar.gz` (stage APP_DIR) | `20261020-1603-0ee63f6` | Beta: Aktivity – dávkové překreslování max. 1×/2 s, auto-pauza při hoveru/fokusu/scrollu, tlačítko pauzy, badge „N nových“ a seskupení stejných tras (`typ + from → to`) s počtem ×N | `index.html`, `src/i18n.js`, `src/main.js`, `src/style.css` |
| 2026-10-20 17:46 | `20261020T174611Z.tar.gz` (stage APP_DIR) | `20261020-1746-8be87f9` | Beta: Vite 8.3.4, security headers (CSP, HSTS, nosniff, frame deny, permissions policy), `/api/node-history` + 7denní sparkline v detailu uzlu, mobilní bottom sheet pro uzel a trasu | `package.json`, `package-lock.json`, `server.mjs`, `node-metrics.mjs`, `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css`, `test/*`, `README.md` |
| 2026-10-20 17:51 | `20261020T175140Z.tar.gz` (stage APP_DIR) | `20261020-1751-58201d9` | Beta: graf historie užitečnosti přesunut do spodní části detailu uzlu, před veřejný klíč a akce | `src/main.js` |

Externí nasazení (ne z této evidence, obsah neznámý):

| Datum (UTC) | Release ID / záloha | Poznámka |
| --- | --- | --- |
| 2026-09-27 15:39 | `20260927T153912Z.tar.gz` | externí nasazení |
| 2026-09-28 15:49 | `20260928T154907Z.tar.gz` | externí nasazení (stav před A1–A5) |

## Cíle rollbacku

- Zrušit viewport culling → obnovit `20260928T160730Z.tar.gz`.
- Zrušit i A1–A5 → obnovit `20260928T155406Z.tar.gz`.
- Zrušit i elevation proxy → obnovit `20260925T134529Z.tar.gz` (stav s původní hláškou o Open-Meteo).

## Postup rollbacku (prod)

`data/` se záměrně nechává být, aby se nepřišlo o pakety nasbírané po nasazení.
Záloha se proto rozbaluje s vyloučením `data`. Konkrétní host se v repu neuvádí;
doplňte jej z bezpečného zdroje.

```bash
ssh -i ./cntb root@<VPS_HOST>
systemctl stop meshcore-live-map
tar -xzf /opt/meshcore-live-map/backups/<RELEASE_ID>.tar.gz \
  -C /opt/meshcore-live-map --exclude='data'
chown -R meshcore-map:meshcore-map /opt/meshcore-live-map/server.mjs \
  /opt/meshcore-live-map/*.mjs /opt/meshcore-live-map/dist /opt/meshcore-live-map/node_modules
systemctl start meshcore-live-map
curl -fsS http://127.0.0.1:4173/ >/dev/null && systemctl is-active meshcore-live-map
```

Pro stage použít `meshcore-live-map-stage`, `4174` a `APP_DIR=/opt/meshcore-live-map-stage`.

## Údržba evidence

Po každém nasazení doplnit řádek: datum UTC, `RELEASE_ID` (shodný s názvem zálohy), build stamp, stručný popis a dotčené soubory.
Nová top-level `*.mjs` je nutné přidat do `deploy/update-vps.sh`, `deploy/update-vps-staging.sh` a `deploy/apply-release.sh`, jinak deploy selže.
