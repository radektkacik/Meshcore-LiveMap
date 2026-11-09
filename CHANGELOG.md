# Changelog

Výběr významných funkčních změn MeshCore CZ live mapy. Technický seznam všech
nasazení a rollbacků zůstává v [`deploy/RELEASES.md`](deploy/RELEASES.md).

## 2026-11-09 — Odkaz na galerii konkrétního nodu
- Prostředí: produkce i beta
- Build: 20261109-0924-2355a50
- V záhlaví každé nodové sekce v galerii je tlačítko **Sdílet**.
- Zkopíruje odkaz ve tvaru `?gallery=1&galleryNode=<public_key>`.
- Odkaz otevře fotogalerii filtrovanou přesně na daný nod.

## 2026-11-09 — Hodnocení fotek
- Prostředí: produkce i beta
- Build: 20261109-0937-03d3a97
- U fotek lze anonymně kliknout na **👍 like** nebo **👎 dislike**.
- Hlasovací tlačítka jsou overlay přímo na fotce, ne pod ní; v lightboxu jsou v pravém dolním rohu fotky.
- V přehledu galerie se zobrazují jen nenulové počty jako statické odznaky; lajkovat se dá v detailu/lightboxu.
- Opraveno: přehled galerie zobrazuje existující hlasy i na produkci.
- Hlasování lze vypnout přes `PHOTO_VOTING=0`.
- Jeden prohlížeč má jeden hlas na fotku; opakovaným kliknutím se hlas zruší.
- Počty jsou vidět v galerii i v lightboxu a aktualizují se okamžitě.
- Hlasy se ukládají lokálně do `photos.sqlite`; server uchovává jen hash anonymního voliče.
- Přidán `POST /api/photos/:id/vote`.

## 2026-11-08 — Sdílený odkaz na fotogalerii
- Prostředí: produkce i beta
- Build: 20261108-2057-ac924c0
- Galerii lze otevřít přímo odkazem `?gallery=1`.
- Produkce: `https://mapa.meshcore.cz/?gallery=1`
- Beta: `https://mapa.meshcore.cz/beta/?gallery=1`

## 2026-11-08 — Modularizace serveru
- Prostředí: produkce i beta
- Build: 20261108-2017-fae08cc
- `server.mjs` zmenšen z 3 348 na 1 474 řádků.
- HTTP routing je v `http-server.mjs`.
- Přihlašování a admin session jsou v `admin-auth.mjs`.
- MQTT příjem, reconnect a CzHealth ingest jsou v `mqtt-ingest.mjs`.
- Periodické collectory jsou v `collectors.mjs`.
- Výšky a terénní dlaždice jsou v `elevation-terrain.mjs`.
- Provozní monitoring je v `monitor.mjs`.
- Deploy skripty a release kontrola byly rozšířené o nové moduly.
- Ověřeno: health, MQTT, veřejné API, admin login, statistiky, hledání, fotogalerie, terénní dlaždice.

## 2026-11-08 — Fotogalerie všech fotek
- Prostředí: produkce i beta
- Build: 20261108-1927-32fb548
- Beta používá stejné funkční UI jako produkce; export, sdílení pohledu a beta-only legendu už beta navíc nezobrazuje.
- Vedle filtru **Jen nody s fotkou** je tlačítko **Galerie**.
- Galerie zobrazí všechny schválené fotky všech nodů.
- Fotky jsou seskupené podle nodu.
- Nody jsou seřazené podle své **nejnovější fotky** — nod s nejnovějším uploadem je první.
- Uvnitř každého nodu jsou fotky **od nejnovějších**.
- Fotky nahrané za poslední **3 dny** mají badge **nový**.
- Kliknutím na název nodu v kartě nebo v záhlaví sekce přejdeš přímo na nod na mapě.
- Kliknutím na fotku se otevře lightbox; lze v něm listovat všemi fotkami galerie.
- Tlačítko **Přejít na nod** v lightboxu zavře galerii a zobrazí nod na mapě.
- Opraveno: proklik z názvu nodu v galerii i ze záhlaví sekce znovu otevírá nod na mapě.
- Hledání filtruje podle názvu nodu, popisu nebo autora.
- Nový endpoint `GET /api/photos/all` vrací jen schválené fotky a veřejná metadata.
- Logika galerie je v samostatném `photo-gallery-controller.js`; řazení a badge řeší `photo-gallery-model.js`.
- Lightbox, zoom, swipe, report a otevírání správy jsou v samostatném `photo-lightbox-controller.js`.
- Upload, HEIC převod, tokeny a správa fotek jsou v samostatných `photo-upload-controller.js`, `photo-manage-controller.js`, `photo-token-store.js` a `photo-file-utils.js`.
- Hledání nodů, observerů, paketů a kanálů je v samostatném `search-controller.js`.
- Statistiky sítě, žebříčky nodů a statistiky návštěv jsou v samostatném `stats-controller.js`.

## 2026-11-07 — Neaktivita po 12 hodinách
- Prostředí: produkce i beta
- Build: 20261107-1443-4644ef0
- Nod je nyní považovaný za neaktivní po **12 hodinách** bez aktivity, místo dřívější 1 hodiny.
- Filtr se jmenuje **Jen neaktivní nody (12 h)**.
- Platí i pro štítek AKTIVNÍ/NEAKTIVNÍ v popupu a detailu.

## 2026-11-07 — Nové nody na mapě
- Prostředí: produkce i beta
- Build: 20261107-1438-1b5521b
- Nově objevené nody mají po dobu **24 hodin** oranžový kroužek.
- V popupu, tooltipu a detailu mají štítek **nový**.
- V legende je položka **Nový nod (24 h)**.
- Hranice se počítá z `first_seen`; starší nody vzhled nemění.

## 2026-11-07 — Správa vlastních fotek
- Prostředí: produkce i beta
- Build: 20261107-1221-7f965b3
- Uživatel může upravit autora/popisek nebo smazat fotku, kterou nahrál.
- Po uploadu se vydá náhodný token; prohlížeč si ho uloží lokálně a server ukládá jen jeho hash.
- Volitelné heslo při uploadu umožňuje správu i z jiného zařízení nebo po ztrátě tokenu; heslo je na serveru uložené jako scrypt hash.
- V lightboxu je akce „Upravit / smazat vlastní fotku“; token nebo heslo je nutné ověřit před každou změnou.
- Starší fotky nemají vlastnický token/heslo a zůstávají spravovatelné přes administraci.

## 2026-11-07 — Více fotek na nod
- Prostředí: produkce i beta
- Build: 20261107-0853-7f01719
- Výchozí limit fotek na jeden nod zvýšen z 8 na **12**.
- Počet fotek v dávce zůstává 5; celkové limity uložiště se nemění.
- Hodnotu lze dál přepsat proměnnou `PHOTO_MAX_PER_NODE`.

## 2026-11-06 — Úrovně baterie podle chemie
- Prostředí: produkce i beta
- Build: 20261106-1934-24fc93e
- Status baterie se počítá z napětí na článek podle typu baterie.
- Li-ion: plná ≥ 4,05 V, ok ≥ 3,60 V, nízká ≥ 3,40 V, kritická < 3,40 V.
- LiFePO4: plná ≥ 3,35 V, ok ≥ 3,20 V, nízká ≥ 3,00 V, kritická < 3,00 V.
- LTO: plná ≥ 2,60 V, ok ≥ 2,40 V, nízká ≥ 2,20 V, kritická < 2,20 V.
- Pb: plná ≥ 2,10 V, ok ≥ 2,05 V, nízká ≥ 1,95 V, kritická < 1,95 V.
- U 2S/3S se napětí dělí počtem článků; `auto`, Na-ion a neznámé typy zůstávají bez statusu.
- Přidána úroveň **Plná** do filtru, legendy a ikony baterie.

## 2026-11-06 — CzHealth v3 a regiony
- Prostředí: produkce i beta
- Build: 20261106-1920-e6ee871
- Podpora nového formátu CzHealth v3: DAY, SUMMARY i CONFIG.
- Kompaktní faceplate nodu zůstává krátký; regiony, typ baterie a doplňková telemetrie jsou až v detailu nodu.
- Ikona baterie se zobrazuje i u neznámého stavu (neutrální obrys), takže není zaměnitelná s vypnutou/chybějící baterií.
- U uzlů, které posílají jen SUMMARY, detail zobrazí rozsahy min/avg/max/last místo prázdného grafu.
- U nodu se zobrazuje napětí, teplota, případně proud a vlhkost.
- Zobrazen je typ baterie, počet článků v sérii a zdroj napětí (`ADC`, `INA`, `BMS`).
- Status baterie se počítá jen pro Li-ion se známým počtem článků; u ostatních typů se zobrazuje pouze měřené napětí.
- CONFIG zobrazuje domácí, výchozí a flood regiony včetně `*` a upozornění na neúplný seznam.
- CONFIG sám nevytváří senzorový vzorek ani nemění čas posledního měření.
- SUMMARY se ukládá jako rozsahy a poslední hodnoty, ne jako smyšlená historie.
- Staré v1 záznamy se ignorují; telemetrický filtr používá pouze přijatá senzorová data.
- Beta ověřena na živých v3 repeaterech `Dev_68B76D`, `OVA-Test`, `BraEastYagi` a `nedvezi.meshcore.cz`.

## 2026-11-05 — Trasy skryté při filtru nodů
- Prostředí: produkce i beta
- Build: 20261105-1107-e492fb4
- Při zapnutém filtru **Jen nody s fotkou** nebo **Jen nody s telemetrií** se automaticky skryjí trasy.
- Spolu s trasami se skryjí i SNR popisky a animace tras.
- Po vypnutí filtru se trasy vrátí podle původního nastavení „Skrýt trasy“.

## 2026-11-05 — Filtr telemetrie a stav baterie
- Prostředí: produkce i beta
- Build: 20261105-1102-9485e81
- Filtr **Jen nody s telemetrií** zobrazí pouze nody s CzHealth daty.
- Volba stavu umožňuje zobrazit všechny, nebo jen baterie OK / nízká / kritická / stará data.
- U health nodů je na mapě malý štítek s baterkou; počet čárek a barva určují stav.
- Barvy samotných nodů zůstávají podle užitečnosti, takže se zdraví baterie neplete s Top 5 % a Top 5–15 %.
- Legenda se při zapnutém filtru rozšíří o stavy baterie.

## 2026-11-05 — Mobil: žádné zvětšování celé stránky
- Prostředí: produkce i beta
- Build: 20261105-0914-38af917
- Pinch na levém panelu, dialogu nebo jiném UI už nemění zoom celé stránky.
- Pinch na mapě dál plynule zoomuje mapu.
- Fotogalerie má vlastní dvouprstý pinch zoom, takže zvětšování fotky funguje i bez zoomu celé stránky.
- Ve fotogalerii lze vodorovným swipe přepínat mezi fotkami; u zvětšené fotky swipe posouvá fotografii.
- Upravený viewport a `touch-action`; na iOS navíc blokované systémové gesto stránky.
- Po nasazení je potřeba stránku jednou obnovit, aby se zrušil případný starý zoom.

## 2026-11-05 — Schvalování přímo z Telegramu
- Prostředí: produkce
- Build: 20261105-0812-f980e4d
- Nové fotky, žádosti o smazání/nahlášení fotky a čekající změny info nodu lze potvrdit tlačítky v Telegramu.
- Tlačítka **Schválit**, **Smazat fotku**, **Zamítnout žádost**, **Schválit změnu** a **Zamítnout** provádějí stejnou akci jako administrace.
- Webhook se sám registruje při startu a je chráněný tajným tokenem; tlačítka mají podepsaná data.
- Akce je povolená jen pro nakonfigurovaný chat, případně pro seznam `TELEGRAM_ADMIN_USER_IDS`.
- Beta zůstává bez interaktivních tlačítek, protože s produkcí sdílí stejného bota a webhook může být jen jeden.

## 2026-11-04 — CzHealth: baterie, teplota a historie
- Prostředí: produkce i beta
- Build: 20261104-2157-f6d9eb8
- Mapa dekóduje vlastní CzHealth pakety z MQTT i z uložené historie tras.
- U repeatérů se zobrazuje napětí baterie, teplota, proud, nabíjení a externí napájení.
- Health data se doplňují i zpětně z již uložených paketů; historie se drží 90 dní.
- V detailu nodu je graf baterie a teploty pro 24 h, 7 dní a 30 dní.
- Stav baterie je vidět v hlavičce nodu, v tooltipu při najetí a v sekci Provoz.
- Přibyl endpoint `/api/node-health`; `/api/nodes` obsahuje poslední health stav.

## 2026-11-04 — Přehlednější karta nodu a čitelnější UI
- Prostředí: produkce i beta
- Build: 20261104-2157-f6d9eb8
- Skóre a užitečnost jsou sjednocené v Síťovém hodnocení, historie je níže v Přehledu.
- Veřejný klíč s kopírováním je přímo na hlavní obrazovce nodu.
- Nody bez souřadnic jdou najít v hledání a otevřít v detailu jako „bez polohy“.
- Písmo v kartách, popupech a dialozích je větší a kontrastnější.
- Uživatel si může zvolit velikost písma: Menší / Normální / Větší; volba se ukládá v prohlížeči.
- Health údaje se zobrazují také v minimalistickém tooltipu repeateru.

## 2026-11-01 — Přehlednější popup nodu na produkci
- Prostředí: produkce i beta
- Build: 20261101-0848-beadd9a
- Popup nodu zobrazuje základní info a fotky přímo na hlavním panelu.
- Uživatelské info má viditelných prvních 5 řádků, zbytek se rozbaluje.
- Přibyli sousedé a tlačítka Odkaz / QR kontakt / Otevřít v Analyzeru.
- Z meshcore.cz bylo převzato 18 textů a 47 fotek; fotky jsou lokální, zmenšené a se zdrojem.

## 2026-11-01 — Ruční sync z meshcore.cz
- Prostředí: beta
- Build: 20261101-0904-30f2482
- V administraci lze porovnat uložené info s aktuální wiki stránkou.
- Sync jde spustit jednotlivě i hromadně pro všechny importované nody.
- Přenáší se text a nové obrázky; nic se nespouští automaticky ani pravidelně.

## 2026-11-01 — Beta na mapa.meshcore.cz/beta
- Prostředí: beta
- Build: 20261101-0808-91339dd
- Beta je nově na `https://mapa.meshcore.cz/beta/`.
- Stará adresa `https://2b.meshcore.cz/betamap/` na ni přesměrovává.

## 2026-11-01 — Beta: detail nodu
- Prostředí: beta
- Build: 20261101-0803-c6ee71c
- Popup nodu na mapě je zkrácený na přehled a krátký výňatek info.
- Plné info, fotky, komentáře a síťové údaje jsou na `/nod/<public_key>` v tabech.
- Detail má vlastní adresu, tlačítko zpět a na mobilu celoobrazovkový režim.

## 2026-11-01 — Beta: import z meshcore.cz
- Prostředí: beta
- Build: 20261101-0748-101ba4f
- V administraci přibyl ruční import textu z veřejné wiki stránky repeateru.
- Před uložením se zobrazí náhled a zdroj; fotky se zatím nekopírují.
- Importovaný text má u nodu odkaz na původní stránku a uvádí zdroj.

## 2026-10-31 — Beta: přehlednější mapa
- Prostředí: beta
- Build: 20261031-1308-232a0ef
- Legenda doplněna o Direct a ostatní typy paketů.
- Tlačítko „Sdílet pohled“ uloží kompletní filtry, vrstvy i přiblížení do odkazu.
- Detail nodu má souhrn fotek, komentářů, infa a poslední aktivity.
- Observerské shluky se na mobilu otevírají ve spodním panelu.
- Beta má zapnutý provozní monitoring s upozorněními do Telegramu.

## 2026-10-31 — Větší přiblížení mapy
- Prostředí: produkce i beta
- Build: 20261031-1238-2672080
- Maximální zoom mapy je nově 19 místo 14.

## 2026-10-29 — Beta na nové adrese
- Prostředí: beta
- Build: 20261029-0756-86b61ad
- Beta je nově na `https://2b.meshcore.cz/betamap/`.
- Původní `https://2b.meshcore.cz/map/` přesměrovává na produkci `https://mapa.meshcore.cz/`.

## 2026-10-29 — Komentáře k nodům
- Prostředí: produkce i beta
- Build: 20261029-0649-4e2748e
- V detailu nodu je tlačítko „Zobrazit komentáře“ s vlastním dialogem.
- Komentáře se zveřejňují ihned, jméno je nepovinné a text má 2–500 znaků.
- Správce je může mazat v `/admin/comments`.

## 2026-10-28 — Uživatel volí náhled fotky
- Prostředí: produkce i beta
- Build: 20261028-1608-47316e5
- Při nahrání dvou až pěti fotek lze u jedné zvolit „Náhled“.
- U fotky čekající na schválení se náhled nastaví po schválení; správce může volbu kdykoli přepsat.

## 2026-10-28 — Fotky v tooltipu a volba náhledu
- Prostředí: produkce i beta
- Build: 20261028-0913-50b8d88
- Při najetí na nod se zobrazí malý náhled fotky, pokud ji nod má.
- Náhled se stahuje až při najetí a používá zvolenou, případně nejnovější schválenou fotku.
- Správce může v `/admin/photos` zvolit „Nastavit jako náhled“; při skrytí nebo smazání fotky se použije další.

## 2026-10-27 — Veřejný changelog
- Prostředí: produkce i beta
- Build: 20261027-1628-e4d4c8c
- Přidána stránka `/changelog` (beta `/map/changelog`) s výběrem významných změn.
- Produkční a beta verze zobrazují pouze změny pro své prostředí.

## 2026-10-27 — Uživatelské info k nodům
- Prostředí: produkce i beta
- Build: 20261027-1154-c992da8
- V detailu nodu lze zveřejnit info o hardwaru, baterii, panelu, anténě a podobně.
- První text se zveřejní ihned, další změny čekají na schválení správcem.
- Volitelné heslo omezí navrhování dalších změn; správce může text přímo upravit.

## 2026-10-27 — Fotky: dávky, popisy a okamžité zveřejnění
- Prostředí: produkce i beta
- Build: 20261027-0825-ee388fd
- Nahrání až pěti fotek najednou s volitelným popisem u každé fotky.
- Fotky se zveřejňují ihned a správce dostane Telegram notifikaci.
- Galerie, lightbox a přepínač „Jen nody s fotkou“.

## 2026-10-26 — Administrace s heslem
- Prostředí: produkce i beta
- Build: 20261026-1940-7519e41
- Jedna administrace na `/admin` s heslem a dvanáctihodinovou session.
- Moderace fotek a žádostí, kniha návštěv a správa uživatelského info.
- Staré tokenové odkazy zůstávají funkční.

## 2026-10-26 — Fotogalerie a lightbox
- Prostředí: produkce i beta
- Build: 20261026-1920-4f42d90
- Dávkové nahrávání fotek, mřížka náhledů a popisky.
- Celoobrazovkový lightbox se zoomem, procházením a klávesovými zkratkami.
- Žádosti o smazání nebo nahlášení fotky.

## 2026-10-26 — Delší historie Paketů/h
- Prostředí: produkce i beta
- Build: 20261026-1847-03fb01d
- Graf Paketů/h nově nabízí 24 h, 7 dní, 30 dní a 1 rok.
- Surová data se drží 30 dní, hodinové agregáty 730 dní a denní 1825 dní.

## 2026-10-26 — Analytika nodu
- Prostředí: produkce i beta
- Build: 20261026-1824-294b033
- Souhrnné statistiky z Analyzeru, přímé observery, adverty a trasy přes nod.
- Clock skew a další diagnostika přímo v detailu nodu.

## 2026-10-26 — TRACE, SNR a přerušení tras
- Prostředí: produkce i beta
- Build: 20261026-1229-79e5e36
- SNR štítky u TRACE při přiblížení a barvy podle SNR.
- Seskupení TRACE podle tagu a označení přerušení trasy.

## 2026-10-25 — Sousedé nodu a Telegram notifikace
- Prostředí: produkce i beta
- Build: 20261025-1944-9780605
- Sousedé nodu na mapě se spojnicemi, četnostmi a souhrnnou lištou.
- Telegram notifikace na nové fotky, žádosti o smazání a knihu návštěv.

## 2026-10-25 — Fotky nodů
- Prostředí: produkce i beta
- Build: 20261025-1856-3e81ef4
- Veřejné nahrávání fotek s moderací, galerií a lightboxem.
- Převod HEIC z iPhonu, limit rozlišení 2400 px a filtr „Jen nody s fotkou“.
- Fotky jsou uložené mimo zálohy.

## 2026-10-25 — Hledání, zdraví a export
- Prostředí: produkce i beta
- Build: 20261025-1410-73eff1c
- Globální hledání nodů, observerů, paketů a kanálů.
- API `/api/health` a `/api/search`.
- Export nodů, observerů a tras do CSV/GeoJSON je dostupný na betě.

## 2026-10-25 — Detail nodu a odkazy do Analyzeru
- Prostředí: produkce i beta
- Build: 20261025-1534-6f8c3c6
- Detail nodu ukazuje V síti od, region a obohacené sousedy.
- Odkazy na paket, trasu a nod v Analyzeru.

## 2026-10-25 — Graf a historie Paketů/h
- Prostředí: produkce i beta
- Build: 20261025-0920-af3b587
- Klik na Paketů/h otevře graf za 24 hodin a 7 dní.
- Historie se plní vzorky každých pět minut.

## 2026-10-24 — Kanály, zdraví observerů a anomálie
- Prostředí: produkce i beta
- Build: 20261024-1435-a3cb8d3
- Zdraví observerů, síťový souhrn a detekce anomálií tras.
- Veřejné kanály rozdělené podle #kanálů.

## 2026-10-24 — Clustery observerů
- Prostředí: produkce i beta
- Build: 20261024-1902-bdcd33f
- Observeři bez přesné polohy se shlukují podle IATA.
- Clustery mají rozbalitelné detaily jednotlivých observerů.

## 2026-10-23 — Vrstva observerů a historie
- Prostředí: produkce i beta
- Build: 20261023-1219-7d0320c
- Vrstva observerů s přesnou nebo přibližnou polohou.
- Historie paketů s filtry a SNR hodnotami u TRACE.
