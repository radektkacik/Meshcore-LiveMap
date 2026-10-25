# Evidence nasazení a rollback (prod)

## Jak zálohy fungují

- `./deploy/update-vps.sh` (prod) a `./deploy/update-vps-staging.sh` (stage) vytvoří při každém nasazení zálohu
  `$APP_DIR/backups/<RELEASE_ID>.tar.gz` **ještě před výměnou souborů**.
- Záloha tedy obsahuje **stav před daným releasem** = verzi, na kterou se dá vrátit.
- Záloha obsahuje aplikaci a `data/`, ale **neobsahuje `node_modules/`** – archiv je menší o závislosti
  a vytváří se výrazně rychleji (méně souborů). Objem dat v `data/` zůstává hlavní částí zálohy.
- Při rollbacku se `node_modules/` ponechá, pokud je `package-lock.json` v záloze shodný s aktuálním.
  Při změně závislostí se složka odstraní a nainstaluje se znovu přes `npm ci --omit=dev`.
- Retence: 20 záloh (`BACKUP_RETENTION` v `deploy/apply-release.sh`). Starší zálohy vytvořené před tímto
  omezením mohou `node_modules/` ještě obsahovat, dokud je retence neposune ven.
- Prod `APP_DIR=/opt/meshcore-live-map`, port 4173, služba `meshcore-live-map`.
- Stage `APP_DIR=/opt/meshcore-live-map-stage`, port 4174, služba `meshcore-live-map-stage`.
- Deploy automaticky aktualizuje i `/root/rollback-meshcore.sh` ze `deploy/rollback-vps.sh`, takže skript
  vždy odpovídá formátu záloh.

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
| 2026-10-20 17:53 | `20261020T175348Z.tar.gz` (stage APP_DIR) | `20261020-1753-fac8015` | Beta fix: Aktivita se na malých displejích nezobrazovala kvůli `display:none`; nyní je to spodní panel přes šířku s max. výškou 46dvh | `src/style.css` |
| 2026-10-20 19:00 | `20261020T190053Z.tar.gz` | `20261020-1900-33c6c67` | Prod: nasazení otestované beta dávky – Vite 8.3.4, security headers, historie uzlu, mobilní bottom sheet, Aktivity s pauzou/seskupením, tmavá mapa, sdílené odkazy, stack uzlů a detail trasy | `package.json`, `package-lock.json`, `server.mjs`, `node-metrics.mjs`, `index.html`, `src/*`, `src/style.css`, `test/*`, `README.md`, `deploy/rollback-vps.sh` |
| 2026-10-20 19:25 | `20261020T192528Z.tar.gz` (stage APP_DIR) | `20261020-1925-37f9346` | Beta: zkrácené relativní časy v detailu uzlu – `teď`, `12 min`, `3 h`, `2 d` | `src/i18n.js` |
| 2026-10-20 19:38 | `20261020T193817Z.tar.gz` | `20261020-1938-93d9e8d` | Prod: zkrácené relativní časy v detailu uzlu | `src/i18n.js` |
| 2026-10-20 19:40 | `20261020T194028Z.tar.gz` (stage APP_DIR) | `20261020-1940-2ed24be` | Beta: role uzlu (repeater/room/…) přímo v hlavičce detailu; řádek „Role“ odstraněn | `src/main.js`, `src/i18n.js` |
| 2026-10-20 19:42 | `20261020T194235Z.tar.gz` | `20261020-1942-9450351` | Prod: role uzlu přímo v hlavičce detailu, řádek „Role“ odstraněn | `src/main.js`, `src/i18n.js` |
| 2026-10-21 07:02 | `20261021T070243Z.tar.gz` (stage APP_DIR) | `20261021-0702-6db35a9` | Beta: LOS – hledání repeaterů pro body A/B, presety antén, export profilu do CSV a sdílený odkaz na měření včetně antén/frekvence | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-21 07:17 | `20261021T071702Z.tar.gz` (stage APP_DIR) | `20261021-0717-c310d3b` | Beta: z LOS odstraněn export CSV a presety antén; zůstává hledání repeaterů, ruční výšky antén a sdílený odkaz | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-21 07:44 | `20261021T074453Z.tar.gz` (stage APP_DIR) | `20261021-0744-90ad5cd` | Beta: LOS link budget – výkon, zisky a ztráty antén, citlivost, požadovaná rezerva; FSPL, Rx, marže a stavová rezerva; údaje i ve sdíleném odkazu | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-21 07:50 | `20261021T075056Z.tar.gz` | `20261021-0750-bd698de` | Prod: LOS – hledání repeaterů A/B, sdílený odkaz a link budget; bez exportu CSV a presetů | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-21 08:25 | `20261021T082517Z.tar.gz` (stage APP_DIR) | `20261021-0825-e5f5fcd` | Beta: graf historie užitečnosti – hover tooltip s přesným časem a hodnotou, bez změny surových dat | `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-21 08:26 | `20261021T082652Z.tar.gz` | `20261021-0826-4e522e1` | Prod: stejný hover tooltip v historii užitečnosti | `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-21 10:18 | `20261021T101855Z.tar.gz` (stage APP_DIR) | `20261021-1018-4c574c6` | Beta: zálohy bez `node_modules` – rollback při shodném lockfile ponechá závislosti, jinak `npm ci`; deploy automaticky aktualizuje `/root/rollback-meshcore.sh` | `deploy/apply-release.sh`, `deploy/rollback-vps.sh`, `deploy/update-vps.sh`, `deploy/update-vps-staging.sh`, `README.md`, `deploy/RELEASES.md` |
| 2026-10-21 10:19 | `20261021T101925Z.tar.gz` | `20261021-1019-4c574c6` | Prod: stejná změna zálohování; první záloha 87 MB místo ~104 MB (bez `node_modules`), služba i HTTP 200 ověřeny | `deploy/apply-release.sh`, `deploy/rollback-vps.sh`, `deploy/update-vps.sh`, `deploy/update-vps-staging.sh`, `README.md`, `deploy/RELEASES.md` |
| 2026-10-21 11:35 | `20261021T113501Z.tar.gz` (stage APP_DIR) | `20261021-1135-9d9e2ed` | Beta: licence MIT (`LICENSE`, `public/LICENSE.txt`, pole v `package.json`) a odkaz na licenci v poznámce pod legendou; MIME `text/plain` pro `.txt` | `LICENSE`, `public/LICENSE.txt`, `index.html`, `src/style.css`, `src/i18n.js`, `server.mjs`, `package.json`, `README.md` |
| 2026-10-21 11:35 | `20261021T113527Z.tar.gz` | `20261021-1135-9d9e2ed` | Prod: stejná licence MIT a odkaz `LICENSE` v GUI; `/LICENSE.txt` vrací 200 s `text/plain` | `LICENSE`, `public/LICENSE.txt`, `index.html`, `src/style.css`, `src/i18n.js`, `server.mjs`, `package.json`, `README.md` |
| 2026-10-21 11:44 | `20261021T114417Z.tar.gz` (stage APP_DIR) | `20261021-1144-dda222e` | Beta: držitel licence změněn z osobního jména na `MeshCore.cz` (LICENSE, GUI i README) | `LICENSE`, `public/LICENSE.txt`, `index.html`, `README.md` |
| 2026-10-21 11:44 | `20261021T114431Z.tar.gz` | `20261021-1144-dda222e` | Prod: stejná změna držitele licence na `MeshCore.cz`; `/LICENSE.txt` i GUI ověřeny | `LICENSE`, `public/LICENSE.txt`, `index.html`, `README.md` |
| 2026-10-21 13:30 | `20261021T133054Z.tar.gz` (stage APP_DIR) | `20261021-1330-97b7ef4` | Beta: simulace pokrytí terénu, DEM dlaždice přes `/api/terrain`; worker chybně volal `/api/terrain` bez base `/map/` | `src/coverage.js`, `src/coverage-worker.js`, `src/main.js`, `src/style.css`, `src/i18n.js`, `index.html`, `server.mjs`, `test/*`, `README.md`, `.env.example` |
| 2026-10-21 13:32 | `20261021T133249Z.tar.gz` (stage APP_DIR) | `20261021-1332-f3eae48` | Beta fix: worker používá `import.meta.env.BASE_URL`, pokrytí na `/map/` funguje; ověřeno překryvem a souhrnem | `src/coverage-worker.js` |
| 2026-10-21 14:07 | `20261021T140741Z.tar.gz` (stage APP_DIR) | `20261021-1407-753a1c6` | Beta: pokrytí jemnější (300 vzorků/paprsek), rádius do 100 km, default 50 km, silnější barvy; ověřeno 50 km i 100 km | `src/coverage.js`, `src/main.js`, `src/i18n.js`, `index.html`, `README.md` |
| 2026-10-21 14:15 | `20261021T141507Z.tar.gz` (stage APP_DIR) | `20261021-1415-2c1fcca` | Beta: výchozí rádius pokrytí 100 km (81 dlaždic), ověřeno | `index.html`, `src/main.js` |
| 2026-10-21 14:24 | `20261021T142402Z.tar.gz` | `20261021-1424-cf44121` | Prod: nasazení simulace pokrytí terénu (100 km default, 300 vzorků/paprsek); ověřeno překryvem, `/api/terrain` 200 a bez chyb v konzoli | `src/coverage.js`, `src/coverage-worker.js`, `src/main.js`, `src/style.css`, `src/i18n.js`, `index.html`, `server.mjs`, `test/*`, `README.md`, `.env.example` |
| 2026-10-22 17:43 | `20261022T174327Z.tar.gz` (stage APP_DIR) | `20261022-1743-e70856a` | Beta: výběr paketu v Aktivitě zobrazí všechny observery a jejich trasy; nové `/api/packet-routes?hash=…`; ověřeno na živém paketu (29 observerů) | `packet-store.mjs`, `server.mjs`, `src/main.js`, `src/route-model.js`, `src/i18n.js`, `src/style.css`, `test/*`, `README.md` |
| 2026-10-22 18:39 | `20261022T183926Z.tar.gz` (stage APP_DIR) | `20261022-1839-7d0868a` | Beta: režim pouze vybraného paketu (živý provoz skrytý), trvalé zobrazení do „Zrušit výběr“/Escape; popup už nezajíždí pod levý HUD | `index.html`, `src/main.js`, `src/style.css`, `src/i18n.js`, `README.md` |
| 2026-10-22 18:52 | `20261022T185253Z.tar.gz` | `20261022-1852-fdc507e` | Prod: výběr paketu se všemi observery, focus režim jen vybraných tras a popup umístěný mimo levý HUD i mimo okraj obrazovky | `packet-store.mjs`, `server.mjs`, `src/main.js`, `src/route-model.js`, `src/i18n.js`, `src/style.css`, `index.html`, `test/*`, `README.md` |
| 2026-10-22 18:53 | `20261022T185348Z.tar.gz` (stage APP_DIR) | `20261022-1853-fdc507e` | Beta: stejná finální verze jako produkce (focus režim + popup mimo HUD) | `src/main.js`, `index.html`, `src/style.css`, `src/i18n.js`, `README.md` |
| 2026-10-23 08:10 | `20261023T081039Z.tar.gz` (stage APP_DIR) | `20261023-0810-1e9579d` | Beta: historické trasy mají stejný limit hopu jako živé (150 km), odstraňuje nereálné dlouhé spojnice | `src/main.js` |
| 2026-10-23 08:11 | `20261023T081103Z.tar.gz` | `20261023-0811-1e9579d` | Prod: stejná oprava nereálných dlouhých hopů u historických tras; focus režim ověřen na živém paketu | `src/main.js` |
| 2026-10-23 08:25 | `20261023T082529Z.tar.gz` (stage APP_DIR) | `20261023-0825-5c62264` | Beta: tlačítko „Zobrazit všechny trasy“ přesunuto nahoru nad seznam výskytů, nemusí se scrollovat | `src/main.js`, `src/style.css` |
| 2026-10-23 08:26 | `20261023T082609Z.tar.gz` | `20261023-0826-5c62264` | Prod: stejné přesunutí akce „Zobrazit všechny trasy“ nahoru; ověřeno, tlačítko je viditelné bez scrollu | `src/main.js`, `src/style.css` |
| 2026-10-23 10:10 | `20261023T101003Z.tar.gz` (stage APP_DIR) | `20261023-1010-70a9e47` | Beta: TRACE trasy s 1B prefixy se zobrazují vždy, i když je filtr 1B vypnutý | `src/route-utils.js`, `test/route-utils.test.mjs`, `README.md` |
| 2026-10-23 10:10 | `20261023T101019Z.tar.gz` | `20261023-1010-70a9e47` | Prod: stejná oprava – 1B TRACE už filtr velikosti hashe neskrývá | `src/route-utils.js`, `test/route-utils.test.mjs`, `README.md` |
| 2026-10-23 10:27 | `20261023T102743Z.tar.gz` (stage APP_DIR) | `20261023-1027-dc57038` | Beta: ambiguous 1B TRACE – výběr celého kandidátního řetězu minimalizací vzdálenosti, kotva podle IATA observeru | `src/main.js`, `src/route-utils.js`, `src/observer-locations.js`, `test/*` |
| 2026-10-23 10:27 | `20261023T102758Z.tar.gz` | `20261023-1027-dc57038` | Prod: stejné řešení ambiguous TRACE tras; ověřeno na živém TRACE | `src/main.js`, `src/route-utils.js`, `src/observer-locations.js`, `test/*` |
| 2026-10-23 10:38 | `20261023T103808Z.tar.gz` (stage APP_DIR) | `20261023-1038-0ae3c85` | Beta: TRACE pakety se ukládají i bez resolved_path a resolvují se klientsky; deep link `?packet=<hash>` | `server.mjs`, `src/main.js` |
| 2026-10-23 10:39 | `20261023T103904Z.tar.gz` | `20261023-1039-0ae3c85` | Prod: stejné ukládání TRACE a deep link; ověřen konkrétní trace `0d9ceba5a4044d01` | `server.mjs`, `src/main.js` |
| 2026-10-23 10:45 | `20261023T104509Z.tar.gz` (stage APP_DIR) | `20261023-1045-410e71a` | Beta: SNR jednotlivých skoků v detailu paketu i v seznamu hopů trasy | `src/main.js`, `src/i18n.js` |
| 2026-10-23 10:45 | `20261023T104521Z.tar.gz` | `20261023-1045-410e71a` | Prod: stejné zobrazení SNR jednotlivých skoků; ověřeno na trace `2d0d849c6ffde594` | `src/main.js`, `src/i18n.js` |
| 2026-10-23 10:52 | `20261023T105203Z.tar.gz` (stage APP_DIR) | `20261023-1052-23698f3` | Beta: SNR skoků se u TRACE zobrazuje vždy (i „—“ bez naměřených hodnot) | `src/main.js`, `src/i18n.js` |
| 2026-10-23 10:52 | `20261023T105216Z.tar.gz` | `20261023-1052-23698f3` | Prod: stejná úprava; ověřeno na trace `7474edc7d4a281db` | `src/main.js`, `src/i18n.js` |
| 2026-10-23 11:20 | `20261023T112023Z.tar.gz` (stage APP_DIR) | `20261023-1120-63d4bf2` | Beta: živé MQTT TRACE pakety nesou snrValues v decoded_json, SNR skoků jde vidět hned | `server.mjs` |
| 2026-10-23 11:20 | `20261023T112038Z.tar.gz` | `20261023-1120-63d4bf2` | Prod: stejná oprava živých TRACE SNR | `server.mjs` |
| 2026-10-23 11:25 | `20261023T112534Z.tar.gz` (stage APP_DIR) | `20261023-1125-f62ba77` | Beta: klik na řádek observeru otevře detail trasy (SNR u hopů), šipka ↗ zobrazí trasu na mapě; SNR řádek zvýrazněn | `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 11:25 | `20261023T112546Z.tar.gz` | `20261023-1125-f62ba77` | Prod: stejná úprava; ověřeno na trace `7474edc7d4a281db` | `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 11:44 | `20261023T114423Z.tar.gz` (stage APP_DIR) | `20261023-1144-ebf7dd4` | Beta: režim Historie v Aktivite – posledních 300 paketů ze 7 dní, s datem a klikem do detailu | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 11:45 | `20261023T114503Z.tar.gz` | `20261023-1145-ebf7dd4` | Prod: stejná historie paketů (300 položek), ověřeno na produkci | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 11:54 | `20261023T115427Z.tar.gz` (stage APP_DIR) | `20261023-1154-8331928` | Beta: filtry historie – hledání observer/uze/hashe, typ paketu, okno 1 h/24 h/7 dní | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 11:54 | `20261023T115439Z.tar.gz` | `20261023-1154-8331928` | Prod: stejné filtry historie; ověřeno (300 → 123 TRACE, hledání 130) | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 12:18 | `20261023T121821Z.tar.gz` (stage APP_DIR) | `20261023-1218-7d0320c` | Beta: vrstva observerů – přesná poloha z uzlu, jinak přibližná podle IATA; popup s daty | `index.html`, `server.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 12:19 | `20261023T121916Z.tar.gz` | `20261023-1219-7d0320c` | Prod: stejná vrstva observerů; `/api/observers` 200, 50 observerů | `index.html`, `server.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 12:29 | `20261023T122917Z.tar.gz` (stage APP_DIR) | `20261023-1229-9f3b83b` | Beta: observeři jako checkbox v existujících filtrech uzlů, bez samostatného tlačítka | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 12:29 | `20261023T122929Z.tar.gz` | `20261023-1229-9f3b83b` | Prod: stejný checkbox Observeři; ověřeno zapnutí/vypnutí bez chyb | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-23 12:36 | `20261023T123602Z.tar.gz` (stage APP_DIR) | `20261023-1236-ebfe25f` | Beta: filtr přejmenován na „Typ nodu“, label „Observery“; české plurály observerů upraveny | `index.html`, `src/i18n.js` |
| 2026-10-23 12:36 | `20261023T123614Z.tar.gz` | `20261023-1236-ebfe25f` | Prod: stejné přejmenování; ověřeno v HTML produkce | `index.html`, `src/i18n.js` |
| 2026-10-23 12:39 | `20261023T123931Z.tar.gz` (stage APP_DIR) | `20261023-1239-fdd61b8` | Beta: label vrstvy jen „Observer“ | `index.html`, `src/i18n.js` |
| 2026-10-23 12:39 | `20261023T123943Z.tar.gz` | `20261023-1239-fdd61b8` | Prod: label vrstvy jen „Observer“ | `index.html`, `src/i18n.js` |
| 2026-10-24 12:38 | `20261024T123852Z.tar.gz` (stage APP_DIR) | `20261024-1238-9133bde` | Beta: limit jednoho hopu zvýšen ze 150 na 170 km | `src/main.js` |
| 2026-10-24 12:39 | `20261024T123911Z.tar.gz` | `20261024-1239-9133bde` | Prod: stejný limit hopu 170 km | `src/main.js` |
| 2026-10-24 13:41 | `20261024T134159Z.tar.gz` (stage APP_DIR) | `20261024-1341-5f0e012` | Beta: zdraví observerů, síťový souhrn ve statistikách, detekce anomálií tras a feed veřejných kanálů | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-24 13:43 | `20261024T134348Z.tar.gz` (stage APP_DIR) | `20261024-1343-85b9907` | Beta: doladění filtru anomálií (jen dlouhé skoky/smyčky/mnoho hopů) a textů kanálů | `src/main.js`, `src/i18n.js` |
| 2026-10-24 14:30 | `20261024T143025Z.tar.gz` (stage APP_DIR) | `20261024-1430-64f39ed` | Beta: kanály rozdělené po #kanálech (Vše, #praha, #test, #tech, #brno…), historie 24 h | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-24 14:41 | `20261024T144109Z.tar.gz` (stage APP_DIR) | `20261024-1441-aba5c3e` | Beta: observeři bez přesné pozice se shlukují podle IATA do jednoho markeru s počtem a seznamem | `src/main.js`, `src/style.css` |
| 2026-10-24 14:46 | `20261024T144606Z.tar.gz` | `20261024-1446-828d508` | Prod: clustery observerů podle IATA; ověřeno PRG 13 observerů | `src/main.js`, `src/style.css` |
| 2026-10-24 18:02 | `20261024T180251Z.tar.gz` (stage APP_DIR) | `20261024-1802-fcbf47b` | Beta: režim „Záblesky“ – slabá trasa v pozadí a jasné krátké dash záblesky rychle po trase | `index.html`, `src/main.js`, `src/i18n.js` |
| 2026-10-24 18:19 | `20261024T181956Z.tar.gz` (stage APP_DIR) | `20261024-1819-df1ad93` | Beta: revert režimu „Záblesky“; animace tras je zpět v původním režimu | `index.html`, `src/main.js`, `src/i18n.js` |
| 2026-10-24 18:53 | `20261024T185338Z.tar.gz` (stage APP_DIR) | `20261024-1853-e5f99b1` | Beta: limit živých tras zvýšen z 250 na 350 | `src/main.js` |
| 2026-10-24 18:53 | `20261024T185353Z.tar.gz` | `20261024-1853-e5f99b1` | Prod: stejný limit 350 živých tras | `src/main.js` |
| 2026-10-24 18:58 | `20261024T185810Z.tar.gz` (stage APP_DIR) | `20261024-1858-a28d6c8` | Beta: clustery observerů mají rozbalitelné detaily každého observeru; clustery i pro překryvy přesných pozic | `src/main.js`, `src/style.css` |
| 2026-10-24 19:02 | `20261024T190206Z.tar.gz` | `20261024-1902-bdcd33f` | Prod: rozbalitelné detaily observerů v clusterech; ověřeno PRG 13 observerů | `src/main.js`, `src/style.css` |
| 2026-10-24 14:35 | `20261024T143509Z.tar.gz` | `20261024-1435-a3cb8d3` | Prod: zdraví observerů, síťový souhrn, anomálie tras, veřejné kanály rozdělené po #kanálech; ověřeno | `index.html`, `src/main.js`, `src/i18n.js`, `src/style.css` |
| 2026-10-24 19:17 | `20261024T191751Z.tar.gz` (stage APP_DIR) | `20261024-1917-fb41936` | Beta: MQTT keepalive 30 s (detekce výpadku ~45 s), vlastní reconnect s backoffem 3–60 s, jitterem ±20 % a resetem jen po spojení delším než 30 s | `server.mjs`, `.env.example` |
| 2026-10-24 19:18 | `20261024T191818Z.tar.gz` | `20261024-1918-fb41936` | Prod: stejná MQTT úprava; ověřeno MQTT connected/subscribed, HTTP 200 | `server.mjs`, `.env.example` |
| 2026-10-24 20:29 | `20261024T202923Z.tar.gz` (stage APP_DIR) | `20261024-2029-982ed8e` | Beta: přehrávání archivu s časovou osou (1 h / 24 h / 7 dní, 1–4×, stopa 2 min–6 h), heatmapa hustoty tras, trasy A→B přes `/api/route-explorer`; ověřeno v prohlížeči. Předchozí testovací nasazení `20261024T202115Z` a `20261024T202524Z` | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/playback.js`, `src/heatmap.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy |
| 2026-10-25 07:32 | `20261025T073210Z.tar.gz` (stage APP_DIR) | `20261025-0732-cf17c21` | Beta: rychlý start z `/api/recent?seconds=30`, dávkové vyřešení prefixů a jedno vykreslení; SSE `?replay=0`; `/api/nodes` stale-while-revalidate (soft TTL 15 min). První trasa ~0,4 s místo 30–42 s | `server.mjs`, `src/main.js`, `test/server.test.mjs`, `README.md`, `CONTEXT.md` |
| 2026-10-25 07:34 | `20261025T073409Z.tar.gz` (stage APP_DIR) | `20261025-0734-f348abd` | Beta: odebráno přehrávání archivu, heatmapa provozu a trasy A→B (revert `982ed8e`); zachován rychlý start přes `/api/recent` a SWR cache uzlů | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 07:36 | `20261025T073645Z.tar.gz` | `20261025-0736-1706438` | Prod: rychlý start z `/api/recent?seconds=30` (dávkové vyřešení prefixů, jedno vykreslení), SSE `?replay=0`, `/api/nodes` SWR; ověřeno 34 tras za ~0,5 s | `server.mjs`, `src/main.js`, `test/server.test.mjs`, `README.md`, `CONTEXT.md` |
| 2026-10-25 07:43 | `20261025T074324Z.tar.gz` (stage APP_DIR) | `20261025-0743-57253a4` | Beta: panel Aktivity lze zvětšovat tažením za levý horní roh, velikost se ukládá do localStorage, dvojklik/Home reset; větší výchozí rozměry | `index.html`, `src/style.css`, `src/main.js`, `src/activity-size.js`, `src/i18n.js`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 07:43 | `20261025T074349Z.tar.gz` | `20261025-0743-57253a4` | Prod: stejné zvětšování panelu Aktivity; ověřeno tažení 340×84 → 430×154 a reset dvojklikem | `index.html`, `src/style.css`, `src/main.js`, `src/activity-size.js`, `src/i18n.js`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 07:47 | `20261025T074705Z.tar.gz` (stage APP_DIR) | `20261025-0747-4a860fd` | Beta: oprava skrývání panelu Aktivity – `display:flex` přebíjel `[hidden]`; ověřeno otevřít/zavřít tlačítkem | `src/style.css` |
| 2026-10-25 07:47 | `20261025T074719Z.tar.gz` | `20261025-0747-4a860fd` | Prod: stejná oprava skrývání panelu Aktivity; ověřeno v prohlížeči | `src/style.css` |
| 2026-10-25 08:18 | `20261025T081855Z.tar.gz` (stage APP_DIR) | `20261025-0818-dbfc172` | Beta: relativní zvýraznění užitečnosti – Top 5 % červeně, 5–15 % žlutě; počty uzlů v legendě; prod beze změny | `src/node-model.js`, `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, `test/node-model.test.mjs`, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:22 | `20261025T082244Z.tar.gz` | `20261025-0822-7e5b7b6` | Prod: relativní zvýraznění užitečnosti – Top 5 % červeně, 5–15 % žlutě; ověřeno 41 / 82 uzlů v legendě | `src/node-model.js`, `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, `test/node-model.test.mjs`, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:32 | `20261025T083230Z.tar.gz` (stage APP_DIR) | `20261025-0832-978b9a2` | Beta: cache posledních zobrazených live tras (localStorage, 15 min, max 200) a odebrán „Stav hashe“ z detailu nodu; ověřeno | `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:32 | `20261025T083245Z.tar.gz` | `20261025-0832-978b9a2` | Prod: stejná cache + odebrání „Stav hashe“; ověřeno 42 tras z cache za 0,3 s, live 52 za 0,7 s. Předchozí cache-only nasazení `20261025T083051Z` / `20261025T083106Z` | `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:46 | `20261025T084602Z.tar.gz` (stage APP_DIR) | `20261025-0846-add2f6a` | Beta: cache `/api/stats` + lokální fallback z `packet_routes`, retry za 60 s | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css`, testy, `.env.example`, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:46 | `20261025T084617Z.tar.gz` | `20261025-0846-add2f6a` | Prod: stejná cache/fallback statistik | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css`, testy, `.env.example`, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:53 | `20261025T085352Z.tar.gz` (stage APP_DIR) | `20261025-0853-c439e57` | Beta: klik na „Paketů/h“ otevře SVG graf 24 h / 7 dní z lokální DB tras (`/api/packet-history`), hover, průměr a maximum | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 08:54 | `20261025T085409Z.tar.gz` | `20261025-0854-c439e57` | Prod: stejný graf paketů/h; ověřeno 24 bodů pro 24 h a 168 pro 7 dní | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 09:01 | `20261025T090151Z.tar.gz` (stage APP_DIR) | `20261025-0901-c788a6d` | Beta: graf paketů/h srovnán na měřítko Analyzeru – tvar z lokální DB, faktor z `packetsLast24h`, poslední hodina z `packetsLastHour`; označeno jako odhad | `server.mjs`, `src/main.js`, `src/i18n.js`, `index.html`, `README.md`, `CONTEXT.md` |
| 2026-10-25 09:02 | `20261025T090209Z.tar.gz` | `20261025-0902-c788a6d` | Prod: stejné srovnání grafu; 24h součet ~666k vs. Analyzer 635k, poslední hodina shodná s HUD (~31,7k) | `server.mjs`, `src/main.js`, `src/i18n.js`, `index.html`, `README.md`, `CONTEXT.md` |
| 2026-10-25 09:19 | `20261025T091954Z.tar.gz` (stage APP_DIR) | `20261025-0919-af3b587` | Beta: skutečná historie Analyzeru – sběr `/api/stats` každých 5 min do `stats_samples` v `node-metrics.sqlite`, retence 30 dní; graf čte jen vzorky, chybějící hodiny jsou mezery | `node-metrics.mjs`, `server.mjs`, `src/main.js`, `src/i18n.js`, `index.html`, testy, `.env.example`, `README.md`, `CONTEXT.md` |
| 2026-10-25 09:20 | `20261025T092014Z.tar.gz` | `20261025-0920-af3b587` | Prod: stejný sběr historie; první vzorek 34 343/h, graf 1 z 24 hodin. Historie se začíná plnit od tohoto nasazení | `node-metrics.mjs`, `server.mjs`, `src/main.js`, `src/i18n.js`, `index.html`, testy, `.env.example`, `README.md`, `CONTEXT.md` |
| 2026-10-25 13:14 | `20261025T131444Z.tar.gz` (stage APP_DIR) | `20261025-1314-7ec9f13` | Beta: rychlé výhry – `/api/health` (uptime, MQTT reconnecty, cache, DB), `/api/search?hash=`, globální hledání v HUD (uzly, observeři, hashe paketů, kanály) a export uzlů/observerů/tras do CSV/GeoJSON; 91 testů | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/search-model.js`, `src/export-model.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 13:16 | `20261025T131658Z.tar.gz` (stage APP_DIR) | `20261025-1316-af1f8fd` | Beta: přenasazení stejných rychlých výher po commitu, build stamp odpovídá `af1f8fd`; health `ok`, MQTT online, hledání i export ověřeny | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/search-model.js`, `src/export-model.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy, `README.md`, `CONTEXT.md` |
| 2026-10-25 14:10 | `20261025T141054Z.tar.gz` | `20261025-1410-73eff1c` | Prod: rychlé výhry – `/api/health`, `/api/search?hash=`, globální hledání; tlačítko Export je v produkci skryté (zůstává jen na betě). Health `ok`, MQTT online, hledání ověřeno, žádné chyby v konzoli | `server.mjs`, `packet-store.mjs`, `src/main.js`, `src/search-model.js`, `src/export-model.js`, `src/i18n.js`, `src/style.css`, `index.html`, testy, `README.md`, `CONTEXT.md` |

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
cd /opt/meshcore-live-map && npm ci --omit=dev
chown -R meshcore-map:meshcore-map /opt/meshcore-live-map/server.mjs \
  /opt/meshcore-live-map/*.mjs /opt/meshcore-live-map/dist /opt/meshcore-live-map/node_modules
systemctl start meshcore-live-map
curl -fsS http://127.0.0.1:4173/ >/dev/null && systemctl is-active meshcore-live-map
```

Pro rychlý rollback je na VPS `/root/rollback-meshcore.sh`. Obnoví aplikaci
z odpovídající zálohy a `data/` nechá být. Pokud se lockfile nezměnil, ponechá
stávající `node_modules`; jinak závislosti doinstaluje:

```bash
ssh -i ./cntb root@<VPS_HOST> '/root/rollback-meshcore.sh <RELEASE_ID>'
```

Aktuální produkční release `20261024T190206Z` má v záloze předchozí verzi
(build `20261024-1853-e5f99b1`); návrat na ni se provede stejným ID:

```bash
ssh -i ./cntb root@<VPS_HOST> '/root/rollback-meshcore.sh 20261024T190206Z'
```

Pro stage použít `meshcore-live-map-stage`, `4174` a `APP_DIR=/opt/meshcore-live-map-stage`;
skript bere tyto hodnoty z prostředí:

```bash
ssh -i ./cntb root@<VPS_HOST> \
  'APP_DIR=/opt/meshcore-live-map-stage SERVICE=meshcore-live-map-stage.service HEALTH_PORT=4174 /root/rollback-meshcore.sh <RELEASE_ID>'
```

## Údržba evidence

Po každém nasazení doplnit řádek: datum UTC, `RELEASE_ID` (shodný s názvem zálohy), build stamp, stručný popis a dotčené soubory.
Nová top-level `*.mjs` je nutné přidat do `deploy/update-vps.sh`, `deploy/update-vps-staging.sh` a `deploy/apply-release.sh`, jinak deploy selže.

## Přepsání historie

Dne 2026-10-21 byla přepsána historie repozitáře, aby veřejná historie neobsahovala
osobní jméno autora. Všech 51 commitů a 5 anotovaných tagů bylo znovu vytvořeno
s identitou `MeshCore.cz <noreply@meshcore.cz>`; dependabot commity zůstaly beze změny.
Změnily se všechny SHA, takže build stampy v tabulce výše odkazují na původní,
už neexistující commity. Tagy odpovídají novým commitům.

