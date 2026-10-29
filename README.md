# MeshCore CZ Live Map

Živá mapa paketových tras české sítě MeshCore. Paketový provoz přijímá živě z
MQTT; veřejné API služby [CoreScope](https://analyzer.meshcore.cz/) poskytuje
seznam nodů, statistiky a resolver hop prefixů.

## Spuštění

```bash
npm install
npm run dev
```

Produkční sestavení:

```bash
npm run build
npm start
```

Aktuální VPS instance běží jako systemd služba `meshcore-live-map` v adresáři
`/opt/meshcore-live-map` a Nginx ji zpřístupňuje na
`https://mapa.meshcore.cz/` (root). Beta instance běží jako
`meshcore-live-map-stage` na `https://2b.meshcore.cz/map/`. Reprodukovatelné
konfigurace jsou v adresáři [`deploy`](deploy/). Produkční frontend pro root se
sestaví příkazem:

```bash
npm run build
```

Beta build pro `/map/`:

```bash
VITE_BASE_PATH=/map/ npm run build
```

Build zároveň vygeneruje stránku `/changelog` (na betě `/map/changelog`)
z ručně udržovaného [`CHANGELOG.md`](CHANGELOG.md). Ten obsahuje jen významné
funkční změny, ne každý build; technický seznam všech nasazení zůstává
v [`deploy/RELEASES.md`](deploy/RELEASES.md). Odkaz „Změny verzí“ je v patičce
mapy; společná změna se zobrazí na produkci i betě.

## Aktualizace VPS

Aktualizace se provádí pouze skriptem, který před výměnou ověří build ve
staging adresáři, připraví přesnou sadu produkčních závislostí, vytvoří backup
a po restartu služby provede health check. Pokud se lockfile nezměnil, použije
již ověřené serverové závislosti a nestahuje je znovu:

```bash
DEPLOY_HOST=root@your-server ./deploy/update-vps.sh
```

Hostitel se v repozitáři záměrně neuvádí. Pro beta instanci použijte
`./deploy/update-vps-staging.sh` se stejným `DEPLOY_HOST`.

Oba deploy skripty načtou `DEPLOY_HOST` také z gitignorovaného souboru
`.deploy.env` v kořeni repa, pokud proměnná není v prostředí:

```bash
printf 'DEPLOY_HOST=root@your-server\n' > .deploy.env
chmod 600 .deploy.env
```

Backupy jsou v `/opt/meshcore-live-map/backups`; uchovává se posledních 20.
Zálohy neobsahují `node_modules` – rollback proto při shodném lockfile ponechá
stávající závislosti a při změně je doinstaluje. Při neúspěšném startu se
předchozí verze obnoví automaticky. Soubor `.env` není součástí balíčku ani
backupu a aktualizace jej nemění. Fotky nodů v `uploads/` se do záloh
nezahrnují. Konfigurace systemd a Nginx se tímto běžným updatem také nemění.

Aplikace bude dostupná na `http://localhost:4173`. Proměnná `PORT` mění port
produkčního serveru. MQTT připojení se nastavuje v `.env` podle `.env.example`;
přihlašovací údaje zůstávají pouze na serveru.

## Datový tok

- `/api/nodes?limit=2000` načte všechny známé nody a jejich souřadnice. Bez
  explicitního limitu CoreScope vrací pouze prvních 50 položek. Nody a souhrnné
  statistiky se obnovují nezávisle každých 15 minut. Server drží nodovou cache
  (7 dní) a vydává ji okamžitě (stale-while-revalidate); při cache starší než
  15 minut odpoví s `X-Data-Stale: 1` a obnovení běží na pozadí. Start stránky
  tak nečeká na pomalý CoreScope.
- `/api/node-detail?key=<public_key>` sloučí detail z Analyzeru
  (`/api/nodes/<key>`, `/health`, `/neighbors`, `/paths`, `/clock-skew`) do
  jedné odpovědi s cache 5 minut. Klient z něj v detailu nodu zobrazuje total
  packets, packets today, avg hops/SNR, přímé observery, poslední adverty,
  trasy přes nod a clock skew. Při výpadku vrátí poslední cache s
  `X-Data-Stale: 1`.
- `GET /api/node-info?key=<public_key>` vrací zveřejněný uživatelský text k nodu
  (hardware, baterie, panel, anténa…). `POST /api/node-info` s JSON
  `{key, text, author}` jej uloží; první text u nodu se zveřejní ihned,
  každá další změna čeká na schválení správcem (`status: "pending"`) a veřejný
  text se nemění, dokud ji správce neschválí. Heslo je nepovinné: když ho
  uživatel při prvním vložení zadá (6–128 znaků), server uloží jen scrypt hash
  a další úpravu povolí jen se správným heslem. Bez hesla může změny navrhovat
  kdokoli, ale stále je schvaluje správce. Text má 5–1000 znaků, autor je
  nepovinný. Ukládá se do `data/node-info.sqlite`; správce v `/admin/node-info`
  schvaluje, zamítá, maže a může text i přímo upravit (uložení se zveřejní
  ihned a zruší případný čekající návrh). Platí limit 10 úprav/h, 50/den
  a 5s pauza na IP. Zapomenuté heslo se neobnovuje; správce může info smazat
  a uživatel jej založí znovu.
- `GET /api/comments?key=<public_key>` vrací komentáře k nodu, `POST /api/comments`
  s JSON `{key, text, author}` je zveřejní ihned. Text má 2–500 znaků, autor je
  nepovinný; platí limit 10 komentářů/h, 200/den a 15s pauza na IP. Data jsou
  v `data/comments.sqlite`. Správce je může mazat v `/admin/comments`; nový
  komentář mu přijde i do Telegramu.
- `/api/recent?seconds=30` vrací posledních N sekund živých paketů z paměťového
  kruhového bufferu (max. 120 s) jako jeden JSON. Klient ho načte paralelně
  s nody, všechny prefixy vyřeší jedním dávkovým requestem a trasy vykreslí
  najednou, místo aby zpracovával stovky SSE událostí po jednom.
- `/api/packet-history?hours=24|168|720|8760` vrací historii paketů/h.
  Do 168 h (7 dní) používá hodinové hodnoty ze surových vzorků v
  `stats_samples`, delší období (30 dní, 1 rok) z denních agregátů v
  `stats_daily` (denní intervaly od místní půlnoci). Server ukládá `packetsLastHour`
  z Analyzeru každých 5 minut;
  surová data drží 30 dní, hodinové agregáty 730 dní a denní 1825 dní
  (`STATS_HOURLY_RETENTION_DAYS`, `STATS_DAILY_RETENTION_DAYS`). Chybějící
  hodiny/dny jsou `null` (mezera), žádný dopočet; starší data než 30 dní před
  nasazením agregace nelze zpětně doplnit.
- `/api/stats` se ukládá do `data/stats-cache.json` (24 h). Při výpadku
  Analyzeru se vydá poslední známá odpověď s `X-Data-Stale: 1`; pokud cache
  chybí, server dopočítá `packetsLastHour` z lokální DB (unikátní hashe za
  poslední hodinu dostupných dat) a odpoví s `partial: true` a
  `X-Data-Source: local`. Klient stale/partial hodnotu zobrazí oranžově a
  zkusí obnovu za 60 s.
- Backend odebírá MQTT topic `meshcore/+/+/packets`, dekóduje raw hlavičku a
  path a posílá pakety prohlížeči přes SSE endpoint `/events/packets`. Nový
  klient se připojuje s `?replay=0` a historii dostane přes `/api/recent`;
  po reconnectu si snapshot znovu načte. Replay buffer má nejvýše 5 000 paketů
  a SSE endpoint chrání limity klientů a odpojením pomalých příjemců. MQTT
  spojení používá keepalive 30 s; po výpadku se reconnectuje s backoffem
  3–60 s a jitterem, takže výpadek brokeru nezpůsobí smyčku stovek připojení.
- `/api/resolve-hops` převádí path prefixy na repeatery a souřadnice.
- Backend každých 5 minut stahuje z CoreScope poslední rozřešené trasy a ukládá
  je do SQLite (`data/packets.sqlite`). Deduplikuje se podle dvojice hash paketu
  a observer, takže se data přes restart serveru i opakované stahování drží.
  Retence je 7 dní (konfigurovatelné přes `PACKET_RETENTION_MS`,
  `PACKET_MAX_ROWS` a `PACKET_COLLECT_MS`).
- `GET /api/feedback/public` vrací veřejnou knihu návštěv — jen zprávy označené
  `isPublic`, bez kontaktu, IP a user-agenta. Správce může zprávu skrýt přes
  `GET /api/feedback/moderate?token=<FEEDBACK_TOKEN>&id=<id>&hidden=0|1`.
- `POST /api/feedback` ukládá zpětnou vazbu (typ, zpráva, nepovinný kontakt) do
  `data/feedback.sqlite`; platí limity: 15 zpráv za hodinu na IP, pauza 30 s mezi
  zprávami, 300 za den celkem a strop 5 000 uložených zpráv. IP se bere z socketu a `X-Forwarded-For`
  se použije jen od důvěryhodného peeru (loopback nebo `TRUST_PROXY=1`), aby se
  limit nedal obejít podvrženou hlavičkou. Administrace je na
  `GET /api/feedback/view?token=<FEEDBACK_TOKEN>` (HTML) nebo
  `GET /api/feedback?token=<FEEDBACK_TOKEN>` (JSON). Bez správného tokenu vrací 404.
- `GET /api/photos?key=<public_key>` vrací schválené fotky nodu. `GET
  /api/photos/nodes` vrací počty schválených fotek podle nodů (`nodeKey`,
  `count`, `coverId` zvolené fotky) pro přepínač „Jen nody s fotkou“ v HUD
  a malý náhled v tooltipu při najetí na nod. Správce může v `/admin/photos`
  u schválené fotky zvolit „Nastavit jako náhled“; bez volby se použije
  nejnovější schválená fotka. `POST /api/photos`
  přijímá binární JPEG/PNG/WebP (max 5 MB) s hlavičkami `X-Photo-Key`,
  `X-Photo-Author` a `X-Photo-Consent: 1`; volitelný `X-Photo-Caption` lze
  zadat u každé fotky (např. hardware, baterie, panel). Klient umožní vybrat až 5 fotek
  najednou a posílá je postupně s `X-Photo-Batch-Size`, `X-Photo-Batch-Index`
  a `X-Photo-Batch-Id`; volitelná hlavička `X-Photo-Cover: 1` označí fotku,
  která má být náhledem nodu. U pending fotky se náhled nastaví po schválení;
  správce může volbu kdykoli přepsat. Server mezi fotkami stejné dávky
  přeskočí 10s pauzu a Telegram notifikaci pošle jednou za dávku. Ve výchozím stavu se fotka
  uloží jako `pending` a zobrazí se až po schválení. S `PHOTO_AUTO_APPROVE=1`
  se ihned uloží jako `approved`, zobrazí se v galerii a správce ji může
  dodatečně smazat. `GET /api/photos/config` vrací `{ autoApprove }`.
- Administrace je na `GET /admin` (beta `/map/admin`). Přihlašuje se heslem
  `ADMIN_PASSWORD`; když není nastavené, použije se `FEEDBACK_TOKEN`, případně
  `PHOTO_TOKEN`. Po přihlášení drží server HttpOnly session cookie 12 hodin
  (`ADMIN_SESSION_SECRET`, `ADMIN_SESSION_TTL_MS`). Sekce: přehled, fotky
  (čekající/schválené/skryté/vše/žádosti) a zpětná vazba. Staré tokenové URL
  `/api/photos/view?token=…` a `/api/feedback/view?token=…` zůstávají funkční.
- Moderace fotek je i nadále dostupná na `GET /api/photos/view?token=<PHOTO_TOKEN>`
  (fallback `FEEDBACK_TOKEN`), odkud lze fotky schválit, skrýt nebo smazat; volba
  náhledu je v nové administraci `/admin/photos`. Soubory i
  `photos.sqlite` jsou v `uploads/` mimo `data/`, takže se nedostanou do záloh.
  Platí limity: 8 fotek/hodinu na IP, 30/den, 8 fotek na nod, 2 GB celkem
  a max. 2400 px na delší straně (klient posílá max. 2000 px).
  HEIC/HEIF z iPhonu prohlížeč převede přes `libheif-js` (WASM) na WebP,
  takže se nemusí ručně exportovat jako JPEG.
- `POST /api/photos/report` (JSON `photoId`, `reason`, `message`, `contact`)
  založí žádost o smazání nebo nahlášení fotky. Žádosti se zobrazují v tabu
  „Žádosti“ v administraci fotek; správce může fotku smazat nebo žádost zamítnout.
  Limit je 5 žádostí za hodinu na IP.
- Volitelné Telegram notifikace pro správce: `TELEGRAM_BOT_TOKEN` a
  `TELEGRAM_CHAT_ID`. Upozornění chodí na novou fotku čekající na schválení,
  žádost o smazání fotky a volitelně (`TELEGRAM_NOTIFY_FEEDBACK=1`) i na novou
  zprávu v knize návštěv a nový komentář k nodu (`TELEGRAM_NOTIFY_COMMENTS=0`
  notifikace vypne). Zprávy obsahují počty čekajících položek; odkaz
  do administrace lze zapnout přes `TELEGRAM_ADMIN_LINK=1` (odkaz už neobsahuje
  token, vede na `/admin`). U automaticky zveřejněných fotek notifikace vede
  na schválené fotky a obsahuje upozornění, že je možné je smazat.
  `PUBLIC_BASE_URL` určuje základ odkazu (u bety `https://2b.meshcore.cz/map`).
- Animace tras je ve výchozím stavu řešená canvas rendererem (jedna kresba,
  posun `lineDashOffset` bez CSS animací). Méně výkonnou SVG variantu s CSS
  animací `stroke-dashoffset` lze zapnout parametrem `?anim=svg`. Animaci lze
  vypnout přepínačem v panelu.
- `/api/visit-stats?days=<n>` vrací interní statistiku návštěv mapy (návštěvy,
  unikátní návštěvníci přes denní hash IP a maximální souběžný počet diváků).
  Ukládá se do `data/visits.sqlite`; raw IP se neukládá.
- `/api/node-history?key=<public_key>&days=7` vrací hodinové vzorky metrik
  vybraného nodu z `data/node-metrics.sqlite` pro mini graf v detailu nodu.
- `/api/history?since=<ms>&limit=<n>` vrací uložené trasy z vlastní databáze.
  Na něm stojí archivní okna 5 min / 1 h / 24 h a sousedská analýza, takže
  fungují i pro starší data a po restartu.
- `/api/packet-routes?hash=<hash>` vrací všechny observery, kteří daný paket
  zaznamenali, z `data/packets.sqlite` (bez ohledu na to, zda jsou v aktuálním
  feedu). Klik na položku Aktivity zobrazí seznam výskytů a všechny trasy.
- `/api/search?hash=<prefix>` hledá v `data/packets.sqlite` hashe začínající
  zadaným hex prefixem (2–64 znaků) a vrací nejnovější výskyt každého z nich.
  Používá ho globální hledání v HUD.
- `/api/health` vrací diagnostiku: uptime, stav MQTT, počet reconnectů a stáří
  posledního paketu, stáří cache nodů a statistik, počet SSE streamů a velikosti
  SQLite databází. Vrací vždy HTTP 200; `status` je `ok`, nebo `degraded`.
- Hledání v HUD prohledává nody, observery, hashe paketů (živé trasy i lokální
  archiv) a veřejné kanály; výsledek se otevře přímo na mapě. Tlačítko Export
  stáhne nody, observery nebo právě zobrazené trasy jako CSV (UTF-8, středník)
  nebo GeoJSON.
- Režim Live zobrazuje výhradně živé pakety z MQTT (SSE). Při výpadku MQTT se
  tedy nevykreslují žádné trasy — žádná zastaralá cache se nepoužívá.
- Proti nereálným trasám: u přímých tras (`Direct`, `TransportDirect`) se
  observer na konec nepřidává (není součástí cesty); při nejednoznačném prefixu
  (víc kandidátů bez jasně nejbližšího) se trasa v daném místě přeruší; chybějící
  hop trasu přeruší místo spojení přes celou mapu.
- Každý observer publikuje vlastní MQTT pozorování. Aktivní trasy se identifikují
  kombinací hashe paketu a observeru; novější varianta stejné trasy nahradí
  předchozí. Feed seskupuje záznamy podle hashe paketu a kliknutím zobrazí
  všechny observery, kteří paket zaznamenali. Zobrazení všech tras přepne mapu
  do režimu pouze vybraného paketu – živý provoz se skryje a vybrané trasy
  zůstanou, dokud se neklikne na „Zrušit výběr“ nebo Escape.
- Lokální proxy je nutná, protože Analyzer neposílá CORS hlavičky.

Trasy se vykreslují pro všechny délky hop prefixů (včetně 1B). U hopu, který
Analyzer neoznačí jako jednoznačný (`unique_prefix`) a má více kandidátů, se
vybere prostorově nejbližší nod k předchozímu bodu trasy. Bez předchozího bodu
se kolidující prefix nepoužije. Cesty delší než 32 prefixů se ignorují a hop,
pro který by vznikl skok delší než 150 km, se přeskočí; vzdálenostní limit
blokuje zjevně chybné dálkové skoky.
Nastavení zobrazení 1B tras se ukládá do `localStorage`. Filtry velikosti hashe
lze zapnout pro 1B, 2B a 3B samostatně; role nodů mají vlastní přepínače.
Archivní okna (5 min / 1 h / 24 h) kreslí uloženou historii z `/api/history`.
Přepínače pouze filtrují společný route store; po opětovném zapnutí se dosud
neexpirované trasy, feed a poslední trasy nodů znovu zobrazí.

Z typů paketů jsou ve výchozím stavu viditelné zprávy (`DIRECT`, `CHANNEL`),
`ADVERT` a diagnostické `TRACE`. `PATH` se nekreslí vůbec (jeho trasy bývají
z velké části nerozřešené a působí nereálně) a přepínač ostatních typů zobrazí
jen `REQ`, `RESPONSE`, `ACK`, `DATA` a `CONTROL`. `TRACE` se barví podle SNR.
Trasy `TRACE` s 1B prefixy se zobrazují vždy, i když je filtr 1B vypnutý –
jinak by typicky nebyly vidět žádné trace pakety.

Viditelnost trasy je pevně nastavená na 60 sekund bez postupného slábnutí; po
uplynutí této doby se trasa odstraní okamžitě. Současně se vykresluje vždy
nejvýše 350 nejnovějších živých tras, aby špičkový provoz nezhoršil plynulost mapy. Trasy nad tento strop zůstávají dostupné v popupu nodu.
Mapovým podkladem je standardní světlá mapa OpenStreetMap.

Stejný paket může během floodu postupně získávat delší nebo odlišnou cestu.
Aplikace proto novější cestou aktualizuje aktivní trasu danou kombinací hashe
paketu a observeru.

Živé trasy se kreslí na canvas (ne SVG). Čárkování se posouvá jedním společným
`lineDashOffset`. Animace je omezená na 10 FPS a neběží bez aktivních tras, ve
skrytém tabu.

Rozhraní používá kompaktní plovoucí HUD nad mapou, vyhledávání nodů a samostatný
panel posledních tras. Panel Aktivity lze zvětšit tažením za levý horní roh
(nebo klávesami se šipkami po fokusu na roh); velikost se ukládá do
`localStorage`, dvojklik nebo Home ji vrátí na výchozí. Kliknutí na nod otevře popup se stavem, časy pozorování,
relay statistikami, dostupnou telemetrií a veřejným klíčem. HUD lze kliknutím na
symbol sbalit.

Popup při otevření ukazuje také poslední trasu zachycenou přes daný nod od
načtení stránky: typ a čas paketu, délku hop hashe, celý seznam nodů a pozici
  daného nodu v trase. Tlačítko trasu vykreslí jako samostatnou očíslovanou vrstvu
  na mapě; vrstva automaticky zmizí po 20 sekundách nebo po kliknutí do mapy. Veřejný
klíč lze z popupu zkopírovat do schránky.

Popup umí lokálně vygenerovat QR kontakt ve formátu dokumentovaném MeshCore:
`meshcore://contact/add?name=...&public_key=...&type=...`. QR lze naskenovat
mobilní aplikací a žádná data se při jeho vytvoření neposílají externí službě.

Nod je označen jako aktivní, pokud během poslední hodiny odeslal advert, byl
slyšen nebo přes něj podle Analyzeru prošel relay provoz (`last_relayed`).
Top 5 % / 5–15 % používá sedmidenní průměr metrik uložený v SQLite a zahrnuje nody
aktivní během posledních 24 hodin. Server načítá metriky každých 15 minut,
ukládá nejvýše jeden aktualizovaný vzorek za hodinu a historii drží 30 dní v
`data/node-metrics.sqlite`.

Posledních až 200 zobrazených živých tras se ukládá do `localStorage` (max. 15
minut). Po refreshi stránky se okamžitě vykreslí přerušovaně s odznakem
„z cache“ a po příchodu živých tras se nahradí; tím se nečeká na první paket
s trasou, pokud je feed zrovna tichý nebo je nedostupný Analyzer.

Kliknutí na metriku „Paketů/h“ otevře graf 24 h / 7 dní ze skutečných vzorků
Analyzeru. Server je ukládá každých 5 minut do `node-metrics.sqlite` (retence
30 dní); mezery znamenají výpadek nebo dobu před začátkem sběru. Aktuální hodina
je neúplná.

## Telegram notifikace

Volitelná upozornění správci na novou fotku čekající na schválení, žádost
o smazání fotky a případně novou zprávu v knize návštěv.

1. V Telegramu vytvořte bota přes `@BotFather` (`/newbot`) a získejte token.
2. Botovi napište `/start`, potom načtěte `chat.id` z
   `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. Do `.env` doplňte:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
PUBLIC_BASE_URL=https://mapa.meshcore.cz
TELEGRAM_NOTIFY_PHOTOS=1
TELEGRAM_NOTIFY_REPORTS=1
TELEGRAM_NOTIFY_FEEDBACK=0
TELEGRAM_ADMIN_LINK=0
TELEGRAM_SILENT=0
```

`TELEGRAM_ADMIN_LINK=1` přidá do zprávy odkaz do administrace `/admin`
(bez tokenu). Po změně `.env` restartujte službu. Stav je vidět v `/api/health`
v poli `notifications.telegram`.

## Pokrytí terénu

Tlačítko **Pokrytí** zapne režim, ve kterém kliknutí do mapy nebo na nod spočítá
terénní viditelnost z daného bodu. Volitelná je výška antény, rádius a frekvence
(pro částečný zásah Fresnelovy zóny). Výsledek se zobrazí jako překryv nad mapou:

- zelená – přímá viditelnost,
- oranžová – viditelnost s částečným zásahem Fresnelovy zóny,
- bez barvy – terén blokuje.

Výpočet běží ve Web Workeru a používá výškové dlaždice Mapzen Terrarium
(45–90 m/px), které server proxyuje a kešuje na `/api/terrain/{z}/{x}/{y}.png`.
Jde o terénní model: budovy, les, difrakce a rádiové ztráty se nezapočítávají.
Pro 20 km okolí se načítá řádově jednotky MB dlaždic, výsledek je orientační.

## Testy

```bash
npm test
```

Testy pokrývají SQLite agregaci, parsování path hashů, nedestruktivní filtrování
tras, deduplikaci souběžných paketů, ranking nodů, MQTT replay buffer a HTTP
chování při neplatném URL, timeoutu CoreScope a překročení SSE limitu.

## Licence

Kód projektu je dostupný pod licencí MIT – viz [`LICENSE`](LICENSE).
HEIC/HEIF dekódování v prohlížeči používá [`libheif-js`](https://github.com/catdad-experiments/libheif-js) (LGPL-3.0), načítaný dynamicky jen při nahrání HEIC fotky.
Copyright (c) 2026 MeshCore.cz.

Licence se vztahuje na zdrojový kód tohoto repozitáře. Závislosti
(`leaflet`, `better-sqlite3`, `mqtt`, `qrcode`, `@michaelhart/meshcore-decoder`)
mají vlastní licence. Data z CoreScope, MQTT feed, dlaždice OpenStreetMap,
OpenTopoMap, Esri a Mapzen Terrarium a služba Open-Meteo se řídí podmínkami
svých poskytovatelů; MIT licence je nepřebírá. Ikona selfh.st je použita pod
CC BY 4.0.

Odkaz na licenci je i v GUI v poznámce pod legendou (`LICENSE.txt`).

