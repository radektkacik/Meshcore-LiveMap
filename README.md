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
`https://mapa.meshcore.cz/` (root). Reprodukovatelné konfigurace jsou
v adresáři [`deploy`](deploy/). Produkční frontend se sestaví příkazem:

```bash
npm run build
```

Build zároveň vygeneruje stránku `/changelog` z ručně udržovaného
[`CHANGELOG.md`](CHANGELOG.md). Ten obsahuje jen významné funkční změny, ne
každý build; technický seznam všech nasazení zůstává
v [`deploy/RELEASES.md`](deploy/RELEASES.md). Odkaz „Změny verzí“ je v patičce
mapy. Pro oddělené testovací prostředí lze použít samostatný `APP_DIR` a
systemd službu.

## Instalace na nový VPS

Pro nový Debian/Ubuntu VPS slouží `deploy/install-vps.sh`. Předpokládá, že je
repozitář naklonovaný na serveru a skript se spouští jako root:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone https://github.com/radektkacik/Meshcore-LiveMap.git /opt/meshcore-live-map
cd /opt/meshcore-live-map
sudo DOMAIN=mapa.example.cz INSTALL_NGINX=1 bash deploy/install-vps.sh
```

Skript zajistí:

- instalaci systémových závislostí (Node.js 20.19+/22, build nástroje, git,
  rsync, případně nginx),
- vytvoření uživatele/skupiny `meshcore-map` a adresářů `data/`, `uploads/`,
  `backups/`,
- vytvoření `.env` z `.env.example` (existující `.env` nikdy nepřepíše),
- instalaci závislostí, build frontendu a odstranění vývojových závislostí,
- instalaci systemd služby, storage drop-inu a rollback skriptu,
- volitelnou instalaci nginx konfigurace pro zadaný `DOMAIN`,
- spuštění služby a ověření `/api/health`.

### Proměnné instalace

| Proměnná | Výchozí | Význam |
|---|---|---|
| `APP_DIR` | `/opt/meshcore-live-map` | Adresář aplikace |
| `APP_USER` / `APP_GROUP` | `meshcore-map` | Systémový uživatel a skupina |
| `SERVICE` | `meshcore-live-map.service` | Název systemd služby |
| `PORT` | `4173` | Interní port aplikace |
| `DOMAIN` | – | Doména pro nginx |
| `INSTALL_NGINX` | `0` | `1` nainstaluje nginx konfiguraci |
| `FORCE_NGINX` | `0` | `1` přepíše existující nginx konfiguraci |
| `SKIP_APT` | `0` | `1` přeskočí instalaci systémových balíčků |
| `NODE_MAJOR` | `22` | Major verze Node.js při instalaci |

Po instalaci doplňte `.env` a restartujte službu:

```bash
sudo nano /opt/meshcore-live-map/.env
sudo systemctl restart meshcore-live-map
systemctl status meshcore-live-map
curl -s http://127.0.0.1:4173/api/health
```

Do `.env` patří zejména MQTT přihlášení, `FEEDBACK_TOKEN` nebo
`ADMIN_PASSWORD`, volitelně `PHOTO_TOKEN` a Telegram údaje. Hodnoty zůstávají
pouze na serveru a nejsou součástí repozitáře.

### Nginx a TLS

Instalační skript vytvoří pouze HTTP konfiguraci. Pro HTTPS použijte například
Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mapa.example.cz
```

Konfigurace pro Cloudflare a reverse proxy jsou v `deploy/nginx-*.conf`.
Pokud na VPS běží výchozí nginx stránka, můžete vypnout
`/etc/nginx/sites-enabled/default`.

### Převod existujících dat

Při přesunu z jiného VPS zkopírujte před instalací nebo po ní `.env`, `data/`
a `uploads/`. Instalační skript existující data ani `.env` nepřepisuje.
Pro běžné aktualizace již běžící instance používejte `deploy/update-vps.sh`,
ne instalační skript.

## Aktualizace VPS

Aktualizace se provádí pouze skriptem, který před výměnou ověří build
v dočasném adresáři, připraví přesnou sadu produkčních závislostí, vytvoří
backup a po restartu služby provede health check. Build zapisuje `dist/build.json`;
`/api/version` podle něj vrací aktuální build a otevřená stránka se po zjištění
nové verze jednou automaticky obnoví. Pokud se lockfile nezměnil, použije
již ověřené serverové závislosti a nestahuje je znovu:

```bash
DEPLOY_HOST=root@your-server ./deploy/update-vps.sh
```

Hostitel se v repozitáři záměrně neuvádí. Deploy skript načte `DEPLOY_HOST`
také z gitignorovaného souboru `.deploy.env` v kořeni repa, pokud proměnná není
v prostředí:

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
  `{key, text, author, password?, token?}` jej uloží; první text u nodu se
  zveřejní ihned a prohlížeč dostane **token vlastníka**, který si uloží.
  Majitel (platný token nebo správné heslo) zveřejní další změnu ihned
  a může info také smazat; změna bez platného tokenu a bez správného hesla se
  uloží jako návrh (`status: "pending"`) a zveřejní se až po schválení
  správcem. Smazat info může také správce. Heslo je
  nepovinné (6–128 znaků); server ukládá jen scrypt hash a umožní jím správu
  i z jiného zařízení. Text má 5–1000 znaků, autor je nepovinný. Ukládá se do
  `data/node-info.sqlite`; správce v `/admin/node-info` schvaluje, zamítá,
  maže a může text i přímo upravit (uložení se zveřejní ihned a zruší případný
  čekající návrh). Platí limit 10 úprav/h, 50/den a 5s pauza na IP.
  Zapomenutý token ani heslo se neobnovují; správce může info smazat a
  uživatel jej založí znovu.
- `GET /admin/repeater-import` je ruční import textu z veřejné DokuWiki
  stránky `meshcore.cz/repeatery:<slug>`. Server zkusí odvodit slug z názvu
  nodu, zobrazí náhled a správce potvrdí uložení. Importuje se jen text,
  ne fotky; zdroj a licence se zobrazují u nodu. Adresa je omezená na
  `meshcore.cz` a namespace `repeatery`.
- `GET /admin/repeater-sync` je ruční porovnání uloženého info s aktuální
  wiki stránkou. Zobrazí rozdíly textu a nové obrázky; správce potvrdí,
  co se má převzít. `GET /admin/repeater-sync-all` udělá stejné porovnání pro
  všechny importované nody a umožní hromadný sync. Nic se nespouští automaticky
  ani pravidelně.
- `GET /api/comments?key=<public_key>` vrací komentáře k nodu, `GET
  /api/comments/count?key=<public_key>` jen jejich počet. `POST /api/comments`
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
  a malý náhled v tooltipu při najetí na nod. `GET /api/photos/all` vrací
  nejnovější schválené fotky všech nodů včetně `nodeKey` a `nodeName`; používá
  je fotogalerie otevíraná tlačítkem „Galerie“ vedle filtru nebo odkazem
  `?gallery=1`. Galerii konkrétního nodu lze otevřít přes
  `?gallery=1&galleryNode=<public_key>`; galerie u každé nodové sekce nabízí
  tlačítko „Sdílet“ pro zkopírování tohoto odkazu. Fotky mají anonymní hodnocení `likes`/`dislikes`;
  `POST /api/photos/:id/vote` s hlavičkou `X-Photo-Voter` a tělem
  `{ "value": 1 | -1 | 0 }` hlas uloží, změní nebo zruší. Jeden prohlížeč má
  jeden hlas na fotku, server ukládá jen jeho hash. Hlasování je ve výchozím
  stavu zapnuté; vypnout ho lze přes `PHOTO_VOTING=0`. Správce může v `/admin/photos`
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
   Každá nahraná fotka dostane jedinečný správcovský token uložený v
   `localStorage` tohoto prohlížeče; server uchovává pouze jeho hash. Volitelné
   heslo pro správu (8–128 znaků) se ukládá jako scrypt hash a umožní fotku
   upravit nebo smazat i z jiného zařízení či po ztrátě tokenu. Akce „Upravit /
   smazat vlastní fotku“ je v lightboxu; starší fotky nahrané před touto funkcí
   může spravovat pouze administrátor.
- Detail nodu je dostupný na `/nod/<public_key>`.
  Popup na mapě je zkrácený; plné info, fotky, komentáře a síťové údaje jsou
  v podstránce s taby.
- Administrace je na `GET /admin`. Přihlašuje se heslem
  `ADMIN_PASSWORD`; když není nastavené, použije se `FEEDBACK_TOKEN`, případně
  `PHOTO_TOKEN`. Po přihlášení drží server HttpOnly session cookie 12 hodin
  (`ADMIN_SESSION_SECRET`, `ADMIN_SESSION_TTL_MS`). Sekce: přehled, fotky
  (čekající/schválené/skryté/vše/žádosti) a zpětná vazba. Staré tokenové URL
  `/api/photos/view?token=…` a `/api/feedback/view?token=…` zůstávají funkční.
- Moderace fotek je i nadále dostupná na `GET /api/photos/view?token=<PHOTO_TOKEN>`
  (fallback `FEEDBACK_TOKEN`), odkud lze fotky schválit, skrýt nebo smazat; volba
  náhledu je v nové administraci `/admin/photos`. Soubory i
  `photos.sqlite` jsou v `uploads/` mimo `data/`, takže se nedostanou do záloh.
  Platí limity: 8 fotek/hodinu na IP, 30/den, 12 fotek na nod, 2 GB celkem
  a max. 2400 px na delší straně (klient posílá max. 2000 px).
  HEIC/HEIF z iPhonu prohlížeč převede přes `libheif-js` (WASM) na WebP,
  takže se nemusí ručně exportovat jako JPEG.
- `POST /api/photos/report` (JSON `photoId`, `reason`, `message`, `contact`)
  založí žádost o smazání nebo nahlášení fotky. Žádosti se zobrazují v tabu
  „Žádosti“ v administraci fotek; správce může fotku smazat nebo žádost zamítnout.
  Limit je 5 žádostí za hodinu na IP.
- Provozní monitoring: `MONITOR_ALERTS=1` zapne kontrolu MQTT, stáří paketů,
  zaplnění disku, dostupnosti zadaných health URL a expirace TLS certifikátů.
  Kontroly se posílají do Telegramu; seznam URL se nastavuje v `MONITOR_URLS`
  (čárkou oddělené). Výchozí interval je 5 minut, timeout 30 s a alert se
  pošle až po dvou neúspěšných kontrolách; stejný alert se opakuje po 1 hodině.
- Volitelné Telegram notifikace pro správce: `TELEGRAM_BOT_TOKEN` a
  `TELEGRAM_CHAT_ID`. Upozornění chodí na novou fotku čekající na schválení,
  žádost o smazání fotky a volitelně (`TELEGRAM_NOTIFY_FEEDBACK=1`) i na novou
  zprávu v knize návštěv a nový komentář k nodu (`TELEGRAM_NOTIFY_COMMENTS=0`
  notifikace vypne). Zprávy obsahují počty čekajících položek; odkaz
  do administrace lze zapnout přes `TELEGRAM_ADMIN_LINK=1` (odkaz už neobsahuje
  token, vede na `/admin`). Volitelně lze fotky, žádosti a změny info nodu
  schvalovat tlačítky přímo v Telegramu (`TELEGRAM_INTERACTIVE=1`). U automaticky zveřejněných fotek notifikace vede
  na schválené fotky a obsahuje upozornění, že je možné je smazat.
  `PUBLIC_BASE_URL` určuje základ odkazu.
- Animace tras je ve výchozím stavu řešená canvas rendererem (jedna kresba,
  posun `lineDashOffset` bez CSS animací). Méně výkonnou SVG variantu s CSS
  animací `stroke-dashoffset` lze zapnout parametrem `?anim=svg`. Animaci lze
  vypnout přepínačem v panelu.
- `/api/visit-stats?days=<n>` vrací interní statistiku návštěv mapy (návštěvy,
  unikátní návštěvníci přes denní hash IP a maximální souběžný počet diváků).
  Ukládá se do `data/visits.sqlite`; raw IP se neukládá.
- `/api/node-history?key=<public_key>&days=7` vrací hodinové vzorky metrik
  vybraného nodu z `data/node-metrics.sqlite` pro mini graf v detailu nodu.
- `/api/node-health?key=<public_key>&days=7` vrací CzHealth telemetrii nodu
  (napětí, teplota, vlhkost, proud a konfiguraci baterie). Podrobnosti viz
  [Telemetrie (CzHealth)](#telemetrie-czhealth).
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
- Zápisová API (`POST`, `PUT`, `PATCH`, `DELETE`) ověřují `Origin`/`Referer`
  a `Host`. Fotky, komentáře, node info ani feedback proto nelze nahrávat
  z cizí domény nebo cizího reverse proxy. Povolené domény lze rozšířit přes
  `WRITE_ALLOWED_ORIGINS` a `WRITE_ALLOWED_HOSTS`.
- Živá streamová data (`/events/packets`, `/api/recent`, `/api/history`,
  `/api/packets`, `/api/packet-routes`, `/api/search`, `/api/resolve-hops`)
  jsou stejnou kontrolou omezena na vlastní domény. Cizí server je nemůže dál
  šířit.
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
se kolidující prefix nepoužije. Cesty delší než 32 prefixů se ignorují.
Hop, pro který by vznikl skok delší než 170 km u 1B tras nebo 300 km u 2B+
tras, se přeskočí; vzdálenostní limit blokuje zjevně chybné dálkové skoky.
Od 140 km se hop navíc označí jako dlouhý skok.
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
Podklady lze přepínat: OpenStreetMap (raster), OpenFreeMap (vektor),
VersaTiles (vektor), OpenTopoMap a satelitní snímky Esri. Vektorové podklady se
načítají lazy přes MapLibre GL až při prvním přepnutí.

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

Velikost písma v celé aplikaci se mění pětistupňovým přepínačem (výchozí
„Malé“); volba se ukládá do `localStorage` a veškeré texty řídí CSS proměnná
`--font-scale`. V síťových statistikách je výchozí metrikou „Užitečnost“.

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

## Telemetrie (CzHealth)

Repeatery s firmwarem mesh-cz v1.18.0.02rc8+ vysílají do MQTT telemetrii
CzHealth. Server přijímá formát **v3** i novější **v4** (DAY, SUMMARY, CONFIG)
současně a obojí ukládá do `data/cz-health.sqlite`; formáty 3 a 4 žijí vedle
sebe a historická data zůstávají zachovaná.

- `GET /api/node-health?key=<public_key>&days=7` vrací vzorky (napětí, teplota,
  vlhkost, proud, zdroj napětí) a konfiguraci baterie (typ, počet článků,
  verze firmware).
- Stav baterie se vyhodnocuje podle chemie a napětí: Li-ion 4050/3600/3400 mV,
  LiFePO4 3350/3200/3000 mV, LTO 2600/2400/2200 mV a Pb 2100/2050/1950 mV
  (úrovně full/ok/warn/critical). Typ `auto` se počítá jako Li-ion; `other`,
  Na-ion a neznámé typy stav nemají. Typ `lto-vlastik` se hodnotí jen při
  zdroji BMS (u ADC/INA jde o výstup měniče).
- Filtr „Jen nody s telemetrií“ a „Stav telemetrie“ nabízejí stavy Plná,
  Baterie OK, `< Baterie OK`, Nízká, Kritická a Stará data. Volba
  `< Baterie OK` zobrazí pouze nody s nízkou nebo kritickou baterií.
- Volba „Hodnota na mapě“ zobrazí u každého nodu teplotu nebo napětí (tučně,
  bez jména a pozadí); překrývající se popisky se skládají do kompaktní mřížky.
- Zdravotní data se považují za čerstvá 48 hodin, konfigurace 8 dní; po
  překročení se stav zobrazí jako „Stará data“.

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

### Schvalování přímo z Telegramu

Volitelně lze žádosti a čekající změny potvrdit tlačítky přímo v Telegramu:

```bash
TELEGRAM_INTERACTIVE=1
TELEGRAM_WEBHOOK_SECRET=vygenerujte-napriklad-openssl-rand-hex-32
# Volitelné: omezí tlačítka na konkrétní Telegram user ID
TELEGRAM_ADMIN_USER_IDS=990790915
```

Po restartu aplikace se webhook sám zaregistruje na
`PUBLIC_BASE_URL/api/telegram/webhook` a ověří ho tajným tokenem. Tlačítka se
přidají k:

- nové fotce čekající na schválení: **Schválit** / **Smazat**,
- žádosti o smazání nebo nahlášení fotky: **Smazat fotku** / **Zamítnout žádost**,
- čekající změně uživatelského info nodu: **Schválit změnu** / **Zamítnout**.

Webhook může být pro jednoho bota jen jeden. Proto zapínejte
`TELEGRAM_INTERACTIVE` pouze na jedné instanci. Pokud používáte skupinový chat, nastavte `TELEGRAM_ADMIN_USER_IDS`,
jinak jsou tlačítka povolena jen pro chat ID z `TELEGRAM_CHAT_ID`.

## Přímá viditelnost (LOS)

Tlačítko **LOS** zapne nástroj přímé viditelnosti mezi dvěma body. Oba konce se
vyberou kliknutím do mapy nebo na nod; výchozí výška antény je 2 m. Nástroj
spočítá terénní profil a Fresnelovu zónu (poměr zásahu je nastavitelný) a zobrazí
profil s překážkami, světlost vůči terénu a Fresnelově zóně a odhad linkového
rozpočtu (frekvence, výkon, zisky, ztráty, citlivost, požadovaná rezerva).
Výškový profil bere z `/api/elevation`; odkaz na konkrétní výpočet lze sdílet.

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
