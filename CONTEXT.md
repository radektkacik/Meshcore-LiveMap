# Kontext projektu MeshCore CZ Live Map

Aktualizováno: 2026-10-25  
Účel: předání kontextu do nového vlákna. Neobsahuje IP adresy ani přihlašovací údaje.

## 1. Repozitář a základní údaje

- Repo: `/home/radek/Meshcore`
- GitHub: privátní `radektkacik/Meshcore-LiveMap`, branch `main`
- Remote přes SSH, klíč `~/.ssh/meshcore_livemap_github`, v repu nastavený `core.sshCommand`
- Lokální Node: 22.23.2, VPS Node: 20.20.2
- Stack: Vite 8.3.4, Leaflet, vanilla JS, Node HTTP server, SQLite (`better-sqlite3` 11.10.0), MQTT 5.16.1
- UI česky, runtime i18n CZ/EN, volba v localStorage nebo `?lang=en/cs`
- Licence MIT, copyright `MeshCore.cz` (`LICENSE`, `public/LICENSE.txt`)

## 2. Prostředí

### Produkce
- URL: https://mapa.meshcore.cz/
- Release: `20261025T074349Z`
- Build: `20261025-0743-57253a4`
- Asset: `index-BluJrPrx.js`
- Služba `meshcore-live-map`, port 4173, `APP_DIR=/opt/meshcore-live-map`
- Poslední záloha: `/opt/meshcore-live-map/backups/20261025T074349Z.tar.gz`
- Tag: `prod-20261025-0743`

### Beta
- URL: https://2b.meshcore.cz/map/
- Release: `20261025T074324Z`
- Build: `20261025-0743-57253a4`
- Asset: `index-CdWnGBFJ.js`
- Služba `meshcore-live-map-stage`, port 4174, `APP_DIR=/opt/meshcore-live-map-stage`
- Poslední záloha: `/opt/meshcore-live-map-stage/backups/20261025T074324Z.tar.gz`
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

### Mapa a uzly
- Repeater vždy navrchu při překryvu uzlů
- Stack uzlů na stejných souřadnicích
- Detail uzlu: role v hlavičce, relativní časy (`teď`, `12 min`, `3 h`, `2 d`)
- Historie užitečnosti: 7 dní hodinových vzorků, hover tooltip; bez průměrování
- Tmavá mapa: OSM dlaždice + CSS filtr
- Sdílené odkazy: uzel, pozice, filtry, časové okno, jazyk
- Rychlý start: 30s snapshot živých paketů + uzly z cache (SWR), první trasy ~1 s
- Detail trasy z feedu i kliknutím na trasu, seznam hopů, vzdálenosti, SNR
- Mobilní bottom sheet pro detail uzlu/trasy, `?sheet=1`
- Panel Aktivity: uživatelsky měnitelná velikost tažením za levý horní roh, persistováno; dvojklik/Home reset

### LOS
- Dialog se otevře po zapnutí LOS
- Hledání repeaterů pro A/B jménem nebo prefixem
- Ruční výšky antén, frekvence
- Link budget: výkon, zisky, ztráty, citlivost, rezerva; FSPL, Rx, marže, stav
- Fresnelova zóna geometrická, gain ji nemění
- Sdílený odkaz včetně parametrů

### Pokrytí terénu
- Režim **Pokrytí**, klik do mapy/na uzel
- Výška antény, rádius 3–100 km, výchozí **100 km**, frekvence
- Terénní viditelnost + částečná Fresnelova zóna
- Web Worker, DEM dlaždice Mapzen Terrarium přes `/api/terrain/{z}/{x}/{y}.png`
- Serverová cache a rate limit, žádný API klíč
- 20 km ≈ 1–2 MB, 100 km ≈ 10 MB dlaždic; opakování z cache

### Pakety, trasy a Aktivita
- Aktivita seskupuje podle hashe paketu, `×N` = počet observerů
- Detail paketu: všichni observery, čas, hopy, SNR, trasa
- Klik na řádek observeru otevře detail trasy; `↗` zobrazí trasu na mapě
- Focus režim: jen vybraný paket, živý provoz skrytý, trvá do „Zrušit výběr“/Escape
- Deep link `?packet=<hash>`
- TRACE: 1B se zobrazují vždy, SNR skoků v detailu i u hopů
- Ambiguous 1B cesty: výběr celého kandidátního řetězu minimalizací vzdálenosti, kotva podle IATA observeru
- Režim Historie: 300 paketů ze 7 dní; filtry observer/uzel/hash, typ, okno 1 h/24 h/7 dní, „Jen anomálie“
- Anomálie: dlouhý skok >140 km, smyčka, >20 hopů
- Režim Kanály: veřejné dešifrované zprávy z 24 h, rozdělení po `#kanálech`, filtr chipy
- Live limit: **350 tras**, archiv **1 500**, v paměti 3 000 live verzí
- Trasa žije 60 s, max. 32 hopů, max. **170 km** na hop

### Observery
- Data z `/api/observers`, vrstva zapínatelná checkboxem v „Typ nodu“
- Přesná poloha, pokud observer ID odpovídá uzlu se souřadnicemi (23 z 50)
- Jinak přibližná poloha podle IATA (27 z 50), vykreslená jako oblast 25 km
- Clustery pro více observerů na stejné pozici, rozbalitelné detaily
- Detail: online/stale/offline, pakety, pakety/h, noise floor, baterie, uptime, clock skew, model, firmware
- Barevné zdraví: zelená online, oranžová stale, šedá offline

### Statistiky
- Síťový souhrn: uzly, observeři, pakety/h, pakety/24 h, online/stale/offline, počty rolí
- Původní žebříčky uzlů podle metrik zůstávají

### Backend
- `/api/node-history`, `/api/elevation`, `/api/packet-routes`, `/api/observers`, `/api/history`, `/api/recent`, `/api/packets`, `/api/nodes`, `/api/stats`
- Cache `/api/nodes` a `/api/resolve-hops` proti výpadkům CoreScope; uzly se vydávají z cache okamžitě (SWR, soft TTL 15 min)
- Start stránky: paralelně `/api/nodes` + `/api/recent?seconds=30`, dávkové vyřešení prefixů a jedno vykreslení; SSE běží s `?replay=0`
- MQTT reconnect/backoff, SSE feed, replay buffer
- Ukládání TRACE i bez `resolved_path`; cesty se doresolvují na klientu
- Security headers: CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP
- CSP povoluje Google Fonts, OSM, OpenTopoMap, Esri

## 4. Testy a CI

- `npm test`: 75 testů, 72 pass, 3 skip, 0 fail
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

- Zálohy jsou bez `node_modules`, obsahují aplikaci a `data/`.
- Rollback při shodném lockfile ponechá `node_modules`, jinak spustí `npm ci --omit=dev`.
- Na VPS `/root/rollback-meshcore.sh`, aktualizuje se při deployi.
- Retence 20 záloh.
- Rollback aktuální produkce `20261024T190206Z`:

```bash
ssh -i ./cntb root@<VPS_HOST> '/root/rollback-meshcore.sh 20261024T190206Z'
```

## 7. Deploy konvence

- Nasadit pouze přes:
  - `DEPLOY_HOST=root@<VPS_HOST> ./deploy/update-vps.sh`
  - `DEPLOY_HOST=root@<VPS_HOST> ./deploy/update-vps-staging.sh`
- `DEPLOY_HOST` se neukládá do repa, IP se v repu neuvádí.
- Klíč pro VPS: `./cntb`.
- Před nasazením: `npm test`, `node --check server.mjs`, build.
- Po nasazení doplnit řádek do `deploy/RELEASES.md`.
- Nový top-level `*.mjs` přidat do obou deploy skriptů a `apply-release.sh`.
- Bez komentářů v kódu.
- Nekommitovat `node_modules`, `dist`, `data`, `.env`, `cntb`, `cntb.pub`.
- V pracovním stromu je untracked `hmi-manual-template/`; nesouvisí s mapou, necommitovat.

## 8. Známe problémy a rizika

- `/api/health` stále chybí; health check je HTTP 200.
- MQTT reconnecty přicházejí zhruba 1–2× za hodinu, většinou tiše (Cloudflare/broker zavře WSS); keepalive je 30 s, backoff 3–60 s s jitterem, výpadek obvykle 5–10 s. Feed zůstává online.
- CoreScope občas selže při sběru tras (`Packet route update failed: fetch failed`); aplikace jede z cache.
- CoreScope občas odpovídá pomalu (sekundy až desítky sekund); `/api/nodes` se proto vydává z cache okamžitě a obnovuje na pozadí.
- 1B prefixy jsou nejednoznačné; názvy uzlů se mohou lišit od Analyzeru.
- Pakety bez path se nekreslí; PATH (typ 11) se záměrně ignoruje.
- Přibližná poloha observeru je jen IATA oblast, ne přesné letiště.
- Kanály jsou jen veřejné dešifrované zprávy, soukromé zůstávají šifrované.
- OSM dlaždice mají policy riziko při větším provozu („Access blocked“).
- Firewall/SSH hardening není hotový: ufw inactive, PasswordAuthentication yes, root login povolený.
- Cloudflare běží Full se self-signed origin certem, ne Full (strict).
- Chybí obecné rate limity API a E2E testy.
- `hmi-manual-template/` je nesouvisející untracked adresář.

## 9. Backlog

- Firewall a SSH hardening
- Cloudflare Full (strict) – Origin CA nebo Let’s Encrypt
- `/api/health`
- Playwright E2E: mapa, LOS, pokrytí, feed, mobilní sheet
- Rate limity API
- Clustering uzlů při oddálení
- Playback archivu s časovou osou, heatmapa pokrytí
- Přístupnost/klávesnice, další mobilní doladění
- Vlastní tile provider / OSM policy
- Případné odstranění DNS záznamu pro 2b, pokud má být web nedostupný i zvenčí

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
