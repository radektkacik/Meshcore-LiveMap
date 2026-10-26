# Kontext projektu MeshCore CZ Live Map

Aktualizováno: 2026-10-26 (prod `20261026T183103Z`, beta `20261026T183024Z`)  
Účel: předání kontextu do nového vlákna. Neobsahuje IP adresy ani přihlašovací údaje.

## 1. Repozitář a základní údaje

- Repo: `/home/radek/Meshcore`
- GitHub: privátní `radektkacik/Meshcore-LiveMap`, branch `main`
- Remote přes SSH, klíč `~/.ssh/meshcore_livemap_github`, v repu nastavený `core.sshCommand`
- Lokální Node: 22.23.2, VPS Node: 20.20.2
- Stack: Vite 8.3.4, Leaflet, vanilla JS, Node HTTP server, SQLite (`better-sqlite3` 11.10.0), MQTT 5.16.1, `libheif-js` 1.23.5 (HEIC ve WASM)
- UI česky, runtime i18n CZ/EN, volba v localStorage nebo `?lang=en/cs`
- Licence MIT, copyright `MeshCore.cz` (`LICENSE`, `public/LICENSE.txt`)

## 2. Prostředí

### Produkce
- URL: https://mapa.meshcore.cz/
- Release: `20261026T183103Z`
- Build: `20261026-1831-53bdf7e`
- Asset: `index-B6ixIAuj.js` + `wasm-bundle-DvSv3l52.js`
- Služba `meshcore-live-map`, port 4173, `APP_DIR=/opt/meshcore-live-map`
- Poslední záloha: `/opt/meshcore-live-map/backups/20261026T183103Z.tar.gz`
- Tag: `prod-20261026-1831`

### Beta
- URL: https://2b.meshcore.cz/map/
- Release: `20261026T183024Z`
- Build: `20261026-1830-53bdf7e`
- Asset: `index-kCXnzH3Y.js` + `wasm-bundle-B2NopqPR.js`
- Služba `meshcore-live-map-stage`, port 4174, `APP_DIR=/opt/meshcore-live-map-stage`
- Poslední záloha: `/opt/meshcore-live-map-stage/backups/20261026T183024Z.tar.gz`
- BETA badge + odkaz „produkce ↗“ v beta buildu

### 2b repeater tabulka
- Původní projekt `2b.meshcore.cz` (tabulka 2b repeaterů) je **zastavený a zakonzervovaný**.
- `meshcore-2b.service`: inactive + disabled.
- `2b.meshcore.cz/` → 410, `/2b-stage/` → 410.
- Adresáře `/opt/meshcore-2b` a `/opt/meshcore-2b-stage` byly smazány.
- Beta mapa `/map/` zůstává v provozu.
- Záloha: `/root/backups/2b-decommission-20261024T182628Z/` na VPS a stejná kopie v `/home/radek/backups/2b-decommission-20261024T182628Z/` (698 MB, SHA256 OK, včetně configů a certifikátů).
- Nginx pro 2b je zjednodušený: `/map/` proxy na 4174, ostatní cesty 410.

## 3. Co je hotové

### Poslední změny (2026-10-25)
- MQTT: keepalive 30 s, vlastní reconnect s backoffem 3–60 s a jitterem ±20 %, reset až po 30 s stabilního spojení; log `MQTT reconnect in … ms`
- Rychlý start: paralelně `/api/nodes` + `/api/recent?seconds=30`, dávkové vyřešení prefixů a jedno vykreslení; SSE `?replay=0`
- Cache posledních 200 live tras v `localStorage` (15 min) – po refreshi okamžitě, odznak „z cache“
- `/api/nodes` SWR (soft TTL 15 min), `/api/stats` cache 24 h + lokální fallback z DB
- Průběžný sběr `/api/stats` každých 5 min do `stats_samples` v `node-metrics.sqlite` (retence 30 dní); graf Paketů/h z reálných vzorků, chybějící hodiny jsou mezery
- Panel Aktivity: zvětšování tažením za roh, persistované rozměry, dvojklik/Home reset; oprava skrývání (`display:flex` přebíjel `[hidden]`)
- Zvýraznění nodů: relativní Top 5 % (červená) a 5–15 % (žlutá) místo pevných Top 25/100; počty v legendě
- Z detailu nodu odstraněn řádek „Stav hashe“
- Experimenty přehrávání archivu, heatmapa provozu a trasy A→B byly vyzkoušeny na betě a následně revertovány (`982ed8e`); v produkci nebyly
- Rychlé výhry (prod i beta): `/api/health` (uptime, MQTT, cache, DB), `/api/search?hash=` a globální hledání v HUD (nody, observeři, hashe paketů, veřejné kanály, klávesnice ↑/↓/Enter/Esc); export nodů, observerů a tras do CSV/GeoJSON – tlačítko Export je zatím jen na betě, v produkci je skryté
- Fotky nodů (prod i beta): veřejné nahrávání JPEG/PNG/WebP + automatický převod HEIC/HEIF z iPhonu přes `libheif-js` (WASM) v prohlížeči, s potvrzením práv; fotka se zobrazí až po schválení správcem; soubory v `uploads/` mimo zálohy, moderace na `/api/photos/view?token=…`. Klient zmenšuje na 2000 px, server povolí max. 2400 px. Lightbox je celoobrazovkový (100vw/100dvh) s zoomem kolečkem myši, tažením, tlačítky +/- a režimem 1:1 (plné rozlišení); dvojklik přepíná fit ↔ 1:1. Přepínač „Jen nody s fotkami“ je skrytý na betě i v produkci.
- Telegram notifikace pro správce (prod i beta): nová fotka k schválení, žádost o smazání fotky, volitelně nová zpráva v knize návštěv; konfigurace `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `PUBLIC_BASE_URL`, `TELEGRAM_ADMIN_LINK`.

### Mapa a nody
- Přepínač „Skrýt trasy“ (bez nápovědy) skryje všechny trasy včetně animací a vybrané trasy; volba se pamatuje v localStorage.
- Repeater vždy navrchu při překryvu nodů
- Stack nodů na stejných souřadnicích
- Sousedé na mapě (prod i beta): z detailu nodu vykreslí čáry ke všem sousedům s dosažitelnými souřadnicemi, tloušťka podle četnosti, štítky `N×`, lišta se souhrnem a zrušením; klik na spojnici otevře sousední nod.
- Trasy: přerušení kvůli neznámému hopu nebo skoku >170 km je označené žlutým `?` s tooltipem; TRACE dostává barvy podle SNR i při více segmentech.
- TRACE při zoomu ≥ 9 zobrazuje u každého hopu štítek se SNR (`12,5 dB`), barva podle kvality; max. 150 štítků. Funguje i v archivních oknech 5 min / 1 h / 24 h.
- Detail nodu: role v hlavičce, relativní časy (`teď`, `12 min`, `3 h`, `2 d`), V síti od, region, obohacení sousedů (role, vzdálenost, naposledy), odkaz do Analyzeru
- Analytika z Analyzeru v detailu nodu: total packets, packets today, pozorování, Ø hopů/SNR, přímí observeři s SNR/RSSI, poslední adverty, trasy přes nod, clock skew; serverový `/api/node-detail` s 5min cache a stale fallbackem
- Historie užitečnosti: 7 dní hodinových vzorků, hover tooltip; bez průměrování
- Zvýraznění užitečnosti: relativní Top 5 % (červená) a 5–15 % (žlutá) z aktivních nodů se skóre za 24 h; počty v legendě
- Tmavá mapa: OSM dlaždice + CSS filtr
- Sdílené odkazy: nod, pozice, filtry, časové okno, jazyk
- Rychlý start: 30s snapshot živých paketů + nody z cache (SWR), první trasy ~1 s
- Cache posledních zobrazených live tras: localStorage, max. 200 tras / 15 min; po refreshi okamžitě jako „z cache“ do příchodu živých dat
- Klik na „Paketů/h“: SVG graf 24 h / 7 dní / 30 dní / 1 rok ze skutečných vzorků Analyzeru (sběr 5 min; surová data 30 dní, hodinové agregáty 730 dní, denní 1825 dní; mezery bez dopočtu)
- Detail trasy z feedu i kliknutím na trasu, seznam hopů, vzdálenosti, SNR
- Mobilní bottom sheet pro detail nodu/trasy, `?sheet=1`
- Panel Aktivity: uživatelsky měnitelná velikost tažením za levý horní roh, persistováno; dvojklik/Home reset

### LOS
- Dialog se otevře po zapnutí LOS
- Hledání repeaterů pro A/B jménem nebo prefixem
- Ruční výšky antén, frekvence
- Link budget: výkon, zisky, ztráty, citlivost, rezerva; FSPL, Rx, marže, stav
- Fresnelova zóna geometrická, gain ji nemění
- Sdílený odkaz včetně parametrů

### Pokrytí terénu
- Režim **Pokrytí**, klik do mapy/na nod
- Výška antény, rádius 3–100 km, výchozí **100 km**, frekvence
- Terénní viditelnost + částečná Fresnelova zóna
- Web Worker, DEM dlaždice Mapzen Terrarium přes `/api/terrain/{z}/{x}/{y}.png`
- Serverová cache a rate limit, žádný API klíč
- 20 km ≈ 1–2 MB, 100 km ≈ 10 MB dlaždic; opakování z cache

### Pakety, trasy a Aktivita
- Aktivita seskupuje podle hashe paketu, `×N` = počet observerů
- Detail paketu: všichni observery, čas, hopy, SNR, trasa
- Detail paketu i trasy má odkaz „Otevřít v Analyzeru“ (`#/packets/<hash>`); při výběru paketu je odkaz i v liště fokusu
- Klik na řádek observeru otevře detail trasy; `↗` zobrazí trasu na mapě
- Focus režim: jen vybraný paket, živý provoz skrytý, trvá do „Zrušit výběr“/Escape
- Deep link `?packet=<hash>`
- TRACE: 1B se zobrazují vždy, SNR skoků v detailu i u hopů; pozorování stejného TRACE se seskupují podle `tag` (jeden řádek `×N`, na mapě nejúplnější SNR trasa); SNR se neopakuje pro hopy bez hodnoty
- Ambiguous 1B cesty: výběr celého kandidátního řetězu minimalizací vzdálenosti, kotva podle IATA observeru
- Režim Historie: 300 paketů ze 7 dní; filtry observer/nod/hash, typ, okno 1 h/24 h/7 dní, „Jen anomálie“
- Anomálie: dlouhý skok >140 km, smyčka, >20 hopů
- Režim Kanály: veřejné dešifrované zprávy z 24 h, rozdělení po `#kanálech`, filtr chipy
- Live limit: **350 tras**, archiv **1 500**, v paměti 3 000 live verzí
- Trasa žije 60 s, max. 32 hopů, max. **170 km** na hop

### Observery
- Data z `/api/observers`, vrstva zapínatelná checkboxem v „Typ nodu“
- Přesná poloha, pokud observer ID odpovídá nodu se souřadnicemi (23 z 50)
- Jinak přibližná poloha podle IATA (27 z 50), vykreslená jako oblast 25 km
- Clustery pro více observerů na stejné pozici, rozbalitelné detaily
- Detail: online/stale/offline, pakety, pakety/h, noise floor, baterie, uptime, clock skew, model, firmware
- Barevné zdraví: zelená online, oranžová stale, šedá offline

### Statistiky
- Síťový souhrn: nody, observeři, pakety/h, pakety/24 h, online/stale/offline, počty rolí
- Původní žebříčky nodů podle metrik zůstávají

### Backend
- `/api/node-history`, `/api/elevation`, `/api/packet-routes`, `/api/observers`, `/api/history`, `/api/recent`, `/api/packet-history`, `/api/packets`, `/api/nodes`, `/api/stats`, `/api/search`, `/api/health`, `/api/node-detail`, `/api/photos`, `/api/photos/nodes`, `/api/photos/report`
- Cache `/api/nodes` a `/api/resolve-hops` proti výpadkům CoreScope; nody se vydávají z cache okamžitě (SWR, soft TTL 15 min)
- Start stránky: paralelně `/api/nodes` + `/api/recent?seconds=30`, dávkové vyřešení prefixů a jedno vykreslení; SSE běží s `?replay=0`
- `/api/stats` cache (24 h) + lokální fallback z `packet_routes` při výpadku Analyzeru; klient zobrazí stale/partial hodnotu oranžově a zkusí obnovu za 60 s
- Sběr `/api/stats` každých 5 min do `stats_samples` v `data/node-metrics.sqlite` (retence 30 dní); graf Paketů/h do 7 dní čte surové vzorky, 30 dní a 1 rok denní agregáty `stats_daily` (hodinové `stats_hourly` 730 dní, denní 1825 dní); chybějící hodiny/dny jsou mezery
- MQTT reconnect/backoff, SSE feed, replay buffer
- Ukládání TRACE i bez `resolved_path`; cesty se doresolvují na klientu
- Security headers: CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP
- CSP povoluje Google Fonts, OSM, OpenTopoMap, Esri a `wasm-unsafe-eval` pro HEIC dekodér

### Komunikace s backendem
- Klient je same-origin (žádné CORS); nginx/Cloudflare jen proxují na Node server.
- Živý provoz: MQTT → server → SSE `/events/packets` (`packet`, `status`); klient poslouchá jedno `EventSource`.
- Start stránky: paralelně `/api/nodes` + `/api/recent?seconds=30`, dávkový `/api/resolve-hops`, jedno vykreslení; SSE `?replay=0`.
- Archiv: `/api/history`, `/api/packet-routes`; statistiky `/api/stats`, `/api/packet-history`.
- CoreScope proxy: `/api/nodes`, `/api/stats`, `/api/observers`, `/api/packets`, `/api/resolve-hops`; server drží cache a stale fallbacky.
- SQLite: `packets.sqlite` (archiv tras), `node-metrics.sqlite` (skóre nodů + `stats_samples`), `visits.sqlite`, `feedback.sqlite`.

## 4. Testy a CI

- `npm test`: 104 testů, 101 pass, 3 skip, 0 fail
- `npm audit --omit=dev`: 0 zranitelností
- GitHub Actions CI: Node 20 a 22, běží `npm ci`, syntax check, testy, build
- CI nelze z tohoto prostředí číst bez GitHub přihlášení
- Dřívější flaky test `HTTP elevation proxy…` (start serveru) opraven: timeout 20 s a `--test-concurrency=1`

## 5. Git historie a identita

- Historie byla přepsána 2026-10-21: všech 51 commitů a 5 anotovaných tagů na `MeshCore.cz <noreply@meshcore.cz>`, force-push.
- Všechny SHA se změnily; build stampy v `deploy/RELEASES.md` před tímto datem odkazují na původní SHA.
- GitHub účet vlastníka zůstává `radektkacik`.
- Staré commity mohou být na GitHubu dočasně dostupné přes přímé SHA; pro úplné vyčištění by byl potřeba GitHub Support nebo repo znovu založit.
- Lokální záložní bundle původní historie: `/home/radek/meshcore-history-20261021T115429Z.bundle` (obsahuje staré identity, je citlivý).

## 6. Zálohy a rollback

- Zálohy jsou bez `node_modules`, obsahují aplikaci a `data/`. Fotky v `uploads/` se do záloh nezahrnují.
- Rollback při shodném lockfile ponechá `node_modules`, jinak spustí `npm ci --omit=dev`.
- Na VPS `/root/rollback-meshcore.sh`, aktualizuje se při deployi.
- Retence 20 záloh.
- Rollback aktuální produkce `20261026T183103Z` na předchozí `20261026T182400Z`:

```bash
ssh -i ./cntb root@<VPS_HOST> '/root/rollback-meshcore.sh 20261026T183103Z'
```

## 7. Deploy konvence

- Nasadit pouze přes:
  - `DEPLOY_HOST=root@<VPS_HOST> ./deploy/update-vps.sh`
  - `DEPLOY_HOST=root@<VPS_HOST> ./deploy/update-vps-staging.sh`
- `DEPLOY_HOST` se neukládá do repa, IP se v repu neuvádí. Lze ho mít v gitignorovaném `.deploy.env` v kořeni; oba deploy skripty ho odsud načtou, pokud není v prostředí.
- Klíč pro VPS: `./cntb`.
- Před nasazením: `npm test`, `node --check server.mjs`, build.
- Po nasazení doplnit řádek do `deploy/RELEASES.md`.
- Nový top-level `*.mjs` přidat do obou deploy skriptů a `apply-release.sh`.
- Bez komentářů v kódu.
- Nekommitovat `node_modules`, `dist`, `data`, `.env`, `cntb`, `cntb.pub`.

## 8. Známe problémy a rizika

- MQTT reconnecty přicházejí zhruba 1–2× za hodinu, většinou tiše (Cloudflare/broker zavře WSS); keepalive je 30 s, backoff 3–60 s s jitterem, výpadek obvykle 5–10 s. Feed zůstává online.
- CoreScope občas selže při sběru tras (`Packet route update failed: fetch failed`); aplikace jede z cache.
- CoreScope občas odpovídá pomalu (sekundy až desítky sekund); `/api/nodes` se proto vydává z cache okamžitě a obnovuje na pozadí.
- Historie Paketů/h se začala sbírat 2026-10-25 09:20 UTC; do naplnění 24 h / 7 dní budou v grafu mezery. HUD a poslední bod grafu se mohou lišit až o 5 min (vzorkovací interval).
- SSE replay (120 s) je legacy a při backpressure se zkracuje; klient používá `/api/recent` a `?replay=0`.
- Cache posledních live tras v `localStorage` může po refreshi ukázat až 15 min staré trasy; je označená „z cache“ a nahradí se živými daty.
- Experimenty přehrávání archivu, heatmapa provozu a trasy A→B byly na betě vyzkoušeny a revertovány; v produkci nejsou.
- 1B prefixy jsou nejednoznačné; názvy nodů se mohou lišit od Analyzeru.
- Pakety bez path se nekreslí; PATH (typ 11) se záměrně ignoruje.
- Přibližná poloha observeru je jen IATA oblast, ne přesné letiště.
- Detail nodu obsahuje galerii fotek; veřejné nahrávání JPEG/PNG/WebP s potvrzením práv, fotka se zobrazí až po schválení správcem. Moderace na `GET /api/photos/view?token=…`.
- Kanály jsou jen veřejné dešifrované zprávy, soukromé zůstávají šifrované.
- Fotky jsou veřejné až po schválení; pending/hidden vrací 404. Veřejné nahrávání má limity 8/h a 30/den na IP, 8 fotek na nod, 2 GB celkem a max. 2400 px na delší straně (klient zmenšuje na 2000 px). Žádosti o smazání jsou omezené 5/h na IP. Soubory i `photos.sqlite` jsou v `uploads/` a nejsou v zálohách, takže po obnově ze zálohy fotky zmizí.
- OSM dlaždice mají policy riziko při větším provozu („Access blocked“).
- Firewall/SSH hardening není hotový: ufw inactive, PasswordAuthentication yes, root login povolený.
- Cloudflare běží Full se self-signed origin certem, ne Full (strict).
- Chybí obecné rate limity API a E2E testy.

## 9. Backlog a návrhy do budoucna

### Střední
- Přenést další data z Analyzeru do detailu nodu: total packets, packets today, avg hops, heard-by observeři s SNR/RSSI, recent adverts, paths through node, clock skew (proxy per-node endpointů s cache)
- Clustering nodů při oddálení
- Playback archivu s časovou osou (dříve zkoušeno na betě, revertováno)
- Heatmapa provozu (dříve zkoušeno na betě, revertováno)
- Trasy A→B / route explorer (dříve zkoušeno na betě, revertováno)
- Watchlist a notifikace při offline nodu/anomálii
- Grafy trendů v detailu nodu/observeru (SNR, baterie, uptime)
- PWA / offline režim
- Refaktor `src/main.js` (cca 4 400 řádků) do modulů
- Přístupnost/klávesnice a další mobilní doladění

### Ops a bezpečnost
- Firewall a SSH hardening
- Cloudflare Full (strict) – Origin CA nebo Let’s Encrypt
- Rate limity API
- Playwright E2E: mapa, LOS, pokrytí, feed, mobilní sheet
- Vlastní tile provider / OSM policy
- Případné odstranění DNS záznamu pro 2b

### Data
- Historie Paketů/h: surové 5min vzorky 30 dní, hodinové agregáty 730 dní, denní 1825 dní; graf 24 h / 7 dní / 30 dní / 1 rok. Případně zkrátit interval na 1 min nebo přidat 5min rozlišení grafu.
- Backfill starších hodin není možný – Analyzer historii neposkytuje, mezery jsou záměrné. Agregace se při nasazení doplní jen z dostupných surových 30 dní.

## 10. Rychlé příkazy

```bash
npm test
npm run build

DEPLOY_HOST=root@<VPS_HOST> ./deploy/update-vps.sh
DEPLOY_HOST=root@<VPS_HOST> ./deploy/update-vps-staging.sh

ssh -i ./cntb root@<VPS_HOST> 'systemctl is-active meshcore-live-map meshcore-live-map-stage nginx'
ssh -i ./cntb root@<VPS_HOST> 'journalctl -u meshcore-live-map -n 100 --no-pager'
```

Rollback:

```bash
ssh -i ./cntb root@<VPS_HOST> '/root/rollback-meshcore.sh <RELEASE_ID>'
```
