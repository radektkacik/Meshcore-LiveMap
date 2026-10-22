# MeshCore CZ Live Map

Živá mapa paketových tras české sítě MeshCore. Paketový provoz přijímá živě z
MQTT; veřejné API služby [CoreScope](https://analyzer.meshcore.cz/) poskytuje
seznam uzlů, statistiky a resolver hop prefixů.

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

Backupy jsou v `/opt/meshcore-live-map/backups`; uchovává se posledních 20.
Zálohy neobsahují `node_modules` – rollback proto při shodném lockfile ponechá
stávající závislosti a při změně je doinstaluje. Při neúspěšném startu se
předchozí verze obnoví automaticky. Soubor `.env` není součástí balíčku ani
backupu a aktualizace jej nemění. Konfigurace systemd a Nginx se tímto běžným
updatem také nemění.

Aplikace bude dostupná na `http://localhost:4173`. Proměnná `PORT` mění port
produkčního serveru. MQTT připojení se nastavuje v `.env` podle `.env.example`;
přihlašovací údaje zůstávají pouze na serveru.

## Datový tok

- `/api/nodes?limit=2000` načte všechny známé uzly a jejich souřadnice. Bez
  explicitního limitu CoreScope vrací pouze prvních 50 položek. Uzly a souhrnné
  statistiky se obnovují nezávisle každých 15 minut.
- Backend odebírá MQTT topic `meshcore/+/+/packets`, dekóduje raw hlavičku a
  path a posílá pakety prohlížeči přes SSE endpoint `/events/packets`. Novému
  klientovi endpoint přehraje také pakety přijaté během posledních 120 sekund.
  Replay buffer má nejvýše 5 000 paketů a SSE endpoint chrání limity klientů a
  odpojením pomalých příjemců.
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
- Animace tras je ve výchozím stavu řešená canvas rendererem (jedna kresba,
  posun `lineDashOffset` bez CSS animací). Méně výkonnou SVG variantu s CSS
  animací `stroke-dashoffset` lze zapnout parametrem `?anim=svg`. Animaci lze
  vypnout přepínačem v panelu.
- `/api/visit-stats?days=<n>` vrací interní statistiku návštěv mapy (návštěvy,
  unikátní návštěvníci přes denní hash IP a maximální souběžný počet diváků).
  Ukládá se do `data/visits.sqlite`; raw IP se neukládá.
- `/api/node-history?key=<public_key>&days=7` vrací hodinové vzorky metrik
  vybraného uzlu z `data/node-metrics.sqlite` pro mini graf v detailu uzlu.
- `/api/history?since=<ms>&limit=<n>` vrací uložené trasy z vlastní databáze.
  Na něm stojí archivní okna 5 min / 1 h / 24 h a sousedská analýza, takže
  fungují i pro starší data a po restartu.
- `/api/packet-routes?hash=<hash>` vrací všechny observery, kteří daný paket
  zaznamenali, z `data/packets.sqlite` (bez ohledu na to, zda jsou v aktuálním
  feedu). Klik na položku Aktivity zobrazí seznam výskytů a všechny trasy.
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
vybere prostorově nejbližší uzel k předchozímu bodu trasy. Bez předchozího bodu
se kolidující prefix nepoužije. Cesty delší než 32 prefixů se ignorují a hop,
pro který by vznikl skok delší než 150 km, se přeskočí; vzdálenostní limit
blokuje zjevně chybné dálkové skoky.
Nastavení zobrazení 1B tras se ukládá do `localStorage`. Filtry velikosti hashe
lze zapnout pro 1B, 2B a 3B samostatně; role uzlů mají vlastní přepínače.
Archivní okna (5 min / 1 h / 24 h) kreslí uloženou historii z `/api/history`.
Přepínače pouze filtrují společný route store; po opětovném zapnutí se dosud
neexpirované trasy, feed a poslední trasy uzlů znovu zobrazí.

Z typů paketů jsou ve výchozím stavu viditelné zprávy (`DIRECT`, `CHANNEL`),
`ADVERT` a diagnostické `TRACE`. `PATH` se nekreslí vůbec (jeho trasy bývají
z velké části nerozřešené a působí nereálně) a přepínač ostatních typů zobrazí
jen `REQ`, `RESPONSE`, `ACK`, `DATA` a `CONTROL`. `TRACE` se barví podle SNR.

Viditelnost trasy je pevně nastavená na 60 sekund bez postupného slábnutí; po
uplynutí této doby se trasa odstraní okamžitě. Současně se vykresluje vždy
nejvýše 250 nejnovějších živých tras, aby špičkový provoz nezhoršil plynulost
mapy. Trasy nad tento strop zůstávají dostupné v popupu uzlu.
Mapovým podkladem je standardní světlá mapa OpenStreetMap.

Stejný paket může během floodu postupně získávat delší nebo odlišnou cestu.
Aplikace proto novější cestou aktualizuje aktivní trasu danou kombinací hashe
paketu a observeru.

Živé trasy se kreslí na canvas (ne SVG). Čárkování se posouvá jedním společným
`lineDashOffset`. Animace je omezená na 10 FPS a neběží bez aktivních tras, ve
skrytém tabu.

Rozhraní používá kompaktní plovoucí HUD nad mapou, vyhledávání uzlů a samostatný
panel posledních tras. Kliknutí na uzel otevře popup se stavem, časy pozorování,
relay statistikami, dostupnou telemetrií a veřejným klíčem. HUD lze kliknutím na
symbol sbalit.

Popup při otevření ukazuje také poslední trasu zachycenou přes daný uzel od
načtení stránky: typ a čas paketu, délku hop hashe, celý seznam uzlů a pozici
  daného uzlu v trase. Tlačítko trasu vykreslí jako samostatnou očíslovanou vrstvu
  na mapě; vrstva automaticky zmizí po 20 sekundách nebo po kliknutí do mapy. Veřejný
klíč lze z popupu zkopírovat do schránky.

Popup umí lokálně vygenerovat QR kontakt ve formátu dokumentovaném MeshCore:
`meshcore://contact/add?name=...&public_key=...&type=...`. QR lze naskenovat
mobilní aplikací a žádná data se při jeho vytvoření neposílají externí službě.

Uzel je označen jako aktivní, pokud během poslední hodiny odeslal advert, byl
slyšen nebo přes něj podle Analyzeru prošel relay provoz (`last_relayed`).
Top 25/100 používá sedmidenní průměr metrik uložený v SQLite a zahrnuje uzly
aktivní během posledních 24 hodin. Server načítá metriky každých 15 minut,
ukládá nejvýše jeden aktualizovaný vzorek za hodinu a historii drží 30 dní v
`data/node-metrics.sqlite`.

## Pokrytí terénu

Tlačítko **Pokrytí** zapne režim, ve kterém kliknutí do mapy nebo na uzel spočítá
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
tras, deduplikaci souběžných paketů, ranking uzlů, MQTT replay buffer a HTTP
chování při neplatném URL, timeoutu CoreScope a překročení SSE limitu.

## Licence

Kód projektu je dostupný pod licencí MIT – viz [`LICENSE`](LICENSE).
Copyright (c) 2026 MeshCore.cz.

Licence se vztahuje na zdrojový kód tohoto repozitáře. Závislosti
(`leaflet`, `better-sqlite3`, `mqtt`, `qrcode`, `@michaelhart/meshcore-decoder`)
mají vlastní licence. Data z CoreScope, MQTT feed, dlaždice OpenStreetMap,
OpenTopoMap, Esri a Mapzen Terrarium a služba Open-Meteo se řídí podmínkami
svých poskytovatelů; MIT licence je nepřebírá. Ikona selfh.st je použita pod
CC BY 4.0.

Odkaz na licenci je i v GUI v poznámce pod legendou (`LICENSE.txt`).

