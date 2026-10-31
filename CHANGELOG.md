# Changelog

Výběr významných funkčních změn MeshCore CZ live mapy. Technický seznam všech
nasazení a rollbacků zůstává v [`deploy/RELEASES.md`](deploy/RELEASES.md).

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
