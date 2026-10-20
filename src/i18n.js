const STORAGE_KEY = "meshcoreLocale";
const LOCALES = ["cs", "en"];
const TAGS = { cs: "cs-CZ", en: "en-GB" };

const cs = {
  "common.unknown": "Neznámé",
  "common.unknownNode": "Neznámý uzel",
  "common.unknownShort": "Neznámý",
  "common.yes": "Ano",
  "common.no": "Ne",
  "common.today": "Dnes",
  "common.copy": "Kopírovat",
  "common.copied": "Zkopírováno",
  "common.copyFailed": "Nelze kopírovat",
  "common.active": "Aktivní",
  "common.inactive": "Neaktivní",
  "role.repeater": "Repeater",
  "role.companion": "Companion",
  "role.room": "Room",
  "role.sensor": "Sensor",
  "role.unknown": "Ostatní",
  "units.hops": { one: "{count} hop", few: "{count} hopy", other: "{count} hopů" },
  "units.observers": { one: "{count} observer", few: "{count} observeři", other: "{count} observerů" },
  "units.neighbors": { one: "{count} soused", few: "{count} sousedé", other: "{count} sousedů" },
  "units.links": { one: "{count} spojení", few: "{count} spojení", other: "{count} spojení" },
  "feed.empty": "Čekám na paket s trasou…",
  "feed.loadingHistory": "Načítám historii…",
  "map.waiting": "Čekám na živá data…",
  "map.waitingMqtt": "Čekám na živá data — MQTT nedostupné",
  "connection.mqttOnline": "MQTT online",
  "connection.mqttOffline": "MQTT nedostupné",
  "connection.nodesFailed": "Uzly nelze načíst",
  "node.basicDetails": "Základní údaje",
  "node.trafficDetails": "Provoz",
  "node.networkDetails": "Síťové hodnocení",
  "node.role": "Role",
  "node.lastActivity": "Poslední aktivita",
  "node.lastAdvert": "Poslední advert",
  "node.lastRelay": "Poslední relay",
  "node.coordinates": "Souřadnice",
  "node.prefix": "Prefix",
  "node.hashMode": "Hash režim",
  "node.hashStatus": "Stav hashe",
  "node.inconsistentHash": "Nekonzistentní hash",
  "node.relayActive": "Relay aktivní",
  "node.relay1h": "Relay za 1 h",
  "node.relay24h": "Relay za 24 h",
  "node.unscopedRelay24h": "Relay bez scope za 24 h",
  "node.advertPackets": "Advert paketů",
  "node.battery": "Baterie",
  "node.temperature": "Teplota",
  "node.coverage": "Pokrytí",
  "node.criticality": "Kritičnost",
  "node.trafficShare": "Podíl provozu",
  "node.usefulness7d": "Užitečnost (7 dní)",
  "node.coverage7d": "Pokrytí (7 dní)",
  "node.trafficShare7d": "Podíl provozu (7 dní)",
  "node.bridge7d": "Bridge (7 dní)",
  "node.criticality7d": "Kritičnost (7 dní)",
  "node.defaultScope": "Výchozí scope",
  "node.transportedScopes": "Přenášené scopes",
  "node.foreign": "Zahraniční uzel",
  "node.scoreSamples": "7denní průměr z {count} hodinových vzorků.",
  "node.scoreCurrent": "Aktuální hodnota; dlouhodobá historie zatím není dostupná.",
  "node.usefulnessHow": "Jak se počítá užitečnost",
  "node.usefulnessFormula": "<b>30 %</b> bridge + <b>25 %</b> pokrytí + <b>25 %</b> kritičnost + <b>20 %</b> podíl provozu.",
  "node.usefulnessGradeNote": "A ≥ 65 % · B ≥ 45 % · C ≥ 30 % · D ≥ 15 % · jinak F",
  "node.bridgeMeaning": "Význam uzlu na nejvýhodnějších cestách.",
  "node.coverageMeaning": "Jak dobře uzel dosáhne zbytku sítě.",
  "node.criticalityMeaning": "Nakolik by odstranění uzlu rozdělilo síť.",
  "node.trafficShareMeaning": "Část provozu přenesená tímto uzlem.",
  "node.meshcoreNode": "MeshCore uzel",
  "node.publicKey": "Veřejný klíč",
  "node.showQr": "Zobrazit QR kontakt",
  "node.lastRouteTitle": "Poslední zachycená trasa",
  "node.noRoute": "Zatím nebyla zachycena žádná trasa.",
  "node.showRoute": "Zobrazit trasu na mapě",
  "node.neighborsTitle": "Sousedé",
  "node.noNeighbors": "Zatím nebyly zachyceny žádné spoje.",
  "node.neighborsTotal": "celkem {neighbors} · {connections}",
  "node.prefixHelp": "Začátek veřejného klíče používaný jako identifikátor uzlu v trase.",
  "node.hashModeHelp": "Počet bajtů prefixu ukládaných do path. Delší hash snižuje riziko kolize uzlů.",
  "node.hashStatusHelp": "Zda byl hash režim potvrzený advertem, odvozený z tras, nebo zatím neznámý.",
  "node.inconsistentHashHelp": "Uzel byl pozorován s více různými délkami path hashe.",
  "node.relayActiveHelp": "Uzel se během sledovaného období objevil jako relay hop.",
  "node.relay1hHelp": "Počet výskytů uzlu jako relay hop během poslední hodiny.",
  "node.relay24hHelp": "Počet výskytů uzlu jako relay hop během posledních 24 hodin.",
  "node.unscopedRelayHelp": "Část relay provozu tvořená flood pakety bez scope. Vyšší počet může ukazovat na nevhodné nastavení flood.max.unscoped.",
  "node.advertHelp": "Počet zachycených oznámení, kterými uzel zveřejňuje svoji identitu a metadata.",
  "node.usefulnessHelp": "Vážené celkové skóre složené z bridge, pokrytí, kritičnosti a podílu provozu. {window}",
  "node.coverageHelp": "Průměr toho, jak dobře je uzel přes kvalitní cesty dosažitelný ze zbytku mesh sítě.",
  "node.trafficShareHelp": "Průměr podílu neadvertového provozu, ve kterém se uzel objevil jako relay hop.",
  "node.bridgeHelp": "Průměr toho, jak často uzel leží na nejvýhodnějších cestách mezi ostatními uzly.",
  "node.criticalityHelp": "Průměr míry, nakolik by odstranění tohoto uzlu rozdělilo síť. Vyšší hodnota znamená menší zastupitelnost.",
  "node.defaultScopeHelp": "Scope, do kterého uzel standardně omezuje svůj flood provoz.",
  "node.transportedScopesHelp": "Scopes pozorované u provozu přeneseného tímto uzlem.",
  "node.foreignHelp": "Uzel je podle síťových metadat vedený mimo domácí oblast.",
  "node.hashStatus.confirmed": "Potvrzený",
  "node.hashStatus.suspected": "Předpokládaný",
  "node.hashStatus.unknown": "Neznámý",
  "node.hashEvidence.advert": "advert",
  "node.hashEvidence.path": "trasa",
  "stats.emptyCombination": "Pro tuto kombinaci metriky a období nejsou data.",
  "stats.emptyMetric": "Žádná data pro tuto metriku.",
  "stats.today": "Dnes",
  "stats.total": "Celkem",
  "stats.visitsToday": "{visits} návštěv · {unique} unikátních · max {peak}",
  "stats.visitsTotal": "{visits} návštěv · max {peak} souběžně",
  "stats.show": "Statistiky",
  "stats.hide": "Skrýt statistiky",
  "activity.show": "Aktivita",
  "activity.hide": "Skrýt aktivitu",
  "feedback.emptyPublic": "Zatím žádné veřejné vzkazy.",
  "feedback.visitor": "Návštěvník",
  "feedback.tooShort": "Zpráva musí mít alespoň 5 znaků.",
  "feedback.sending": "Odesílám…",
  "feedback.sent": "Děkujeme, zpráva byla odeslána.",
  "feedback.failed": "Odeslání selhalo. Zkuste to prosím znovu.",
  "feedback.failedWith": "Odeslání selhalo: {message}",
  "los.chartLabel": "Výškový profil trasy",
  "los.status.terrain": "terén v paprsku",
  "los.status.fresnel": "Fresnel",
  "los.status.clear": "volné",
  "los.hover": "{distance} km · terén {terrain} m · LOS {line} m · clearance {clearance} m ({status})",
  "los.result.blocked": "terén blokuje paprsek",
  "los.result.clear": "volná přímá viditelnost",
  "los.result.fresnel": "zásah do Fresnelovy zóny",
  "los.summary": "{distance} km · F1 {fresnel} m · clearance {clearance} m · Fresnel {fresnelClearance} m · {status}",
  "los.calculating": "Počítám výšky terénu…",
  "los.someMissing": "Některé výšky se nepodařilo načíst. Zkuste „Přepočítat“.",
  "los.dragHint": "Body lze táhnout po mapě, profil se přepočítá.",
  "los.rateLimited": "Open-Meteo dočasně omezuje načítání výšek. Zkuste „Přepočítat“ za ~{seconds} s.",
  "los.loadFailed": "Výšky se nepodařilo načíst. Zkuste „Přepočítat“ za chvíli.",
  "los.pointA": "A: {name} ({role}). Klikněte na druhý bod.",
  "los.pointBHint": "Klikněte na druhý bod.",
  "los.firstHint": "Klikněte na první bod nebo uzel.",
  "los.pointTooltip": "{label}: {name} ({role})",
  "lang.switchToEnglish": "Přepnout do angličtiny",
  "lang.switchToCzech": "Přepnout do češtiny",
  "lang.production": "produkce ↗",
  "lang.productionTitle": "Přejít na produkční verzi",
};

const en = {
  "common.unknown": "Unknown",
  "common.unknownNode": "Unknown node",
  "common.unknownShort": "Unknown",
  "common.yes": "Yes",
  "common.no": "No",
  "common.today": "Today",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.copyFailed": "Unable to copy",
  "common.active": "Active",
  "common.inactive": "Inactive",
  "role.repeater": "Repeater",
  "role.companion": "Companion",
  "role.room": "Room",
  "role.sensor": "Sensor",
  "role.unknown": "Other",
  "units.hops": { one: "{count} hop", other: "{count} hops" },
  "units.observers": { one: "{count} observer", other: "{count} observers" },
  "units.neighbors": { one: "{count} neighbour", other: "{count} neighbours" },
  "units.links": { one: "{count} link", other: "{count} links" },
  "feed.empty": "Waiting for a route packet…",
  "feed.loadingHistory": "Loading history…",
  "map.waiting": "Waiting for live data…",
  "map.waitingMqtt": "Waiting for live data — MQTT unavailable",
  "connection.mqttOnline": "MQTT online",
  "connection.mqttOffline": "MQTT unavailable",
  "connection.nodesFailed": "Unable to load nodes",
  "node.basicDetails": "Basic details",
  "node.trafficDetails": "Traffic",
  "node.networkDetails": "Network rating",
  "node.role": "Role",
  "node.lastActivity": "Last activity",
  "node.lastAdvert": "Last advert",
  "node.lastRelay": "Last relay",
  "node.coordinates": "Coordinates",
  "node.prefix": "Prefix",
  "node.hashMode": "Hash mode",
  "node.hashStatus": "Hash status",
  "node.inconsistentHash": "Inconsistent hash",
  "node.relayActive": "Relay active",
  "node.relay1h": "Relay (1 h)",
  "node.relay24h": "Relay (24 h)",
  "node.unscopedRelay24h": "Unscoped relay (24 h)",
  "node.advertPackets": "Advert packets",
  "node.battery": "Battery",
  "node.temperature": "Temperature",
  "node.coverage": "Coverage",
  "node.criticality": "Criticality",
  "node.trafficShare": "Traffic share",
  "node.usefulness7d": "Usefulness (7 days)",
  "node.coverage7d": "Coverage (7 days)",
  "node.trafficShare7d": "Traffic share (7 days)",
  "node.bridge7d": "Bridge (7 days)",
  "node.criticality7d": "Criticality (7 days)",
  "node.defaultScope": "Default scope",
  "node.transportedScopes": "Transported scopes",
  "node.foreign": "Foreign node",
  "node.scoreSamples": "7-day average from {count} hourly samples.",
  "node.scoreCurrent": "Current value; long-term history is not available yet.",
  "node.usefulnessHow": "How usefulness is calculated",
  "node.usefulnessFormula": "<b>30%</b> bridge + <b>25%</b> coverage + <b>25%</b> criticality + <b>20%</b> traffic share.",
  "node.usefulnessGradeNote": "A ≥ 65% · B ≥ 45% · C ≥ 30% · D ≥ 15% · otherwise F",
  "node.bridgeMeaning": "How important the node is on the most advantageous paths.",
  "node.coverageMeaning": "How well the node reaches the rest of the network.",
  "node.criticalityMeaning": "How much removing the node would split the network.",
  "node.trafficShareMeaning": "Share of traffic carried by this node.",
  "node.meshcoreNode": "MeshCore node",
  "node.publicKey": "Public key",
  "node.showQr": "Show QR contact",
  "node.lastRouteTitle": "Last captured route",
  "node.noRoute": "No route captured yet.",
  "node.showRoute": "Show route on map",
  "node.neighborsTitle": "Neighbours",
  "node.noNeighbors": "No links captured yet.",
  "node.neighborsTotal": "total {neighbors} · {connections}",
  "node.prefixHelp": "Start of the public key used as the node identifier in a route.",
  "node.hashModeHelp": "Number of prefix bytes stored in the path. A longer hash reduces the risk of node collisions.",
  "node.hashStatusHelp": "Whether the hash mode was confirmed by an advert, inferred from routes, or is still unknown.",
  "node.inconsistentHashHelp": "The node was observed with multiple different path hash lengths.",
  "node.relayActiveHelp": "The node appeared as a relay hop during the observed period.",
  "node.relay1hHelp": "Number of times the node appeared as a relay hop during the last hour.",
  "node.relay24hHelp": "Number of times the node appeared as a relay hop during the last 24 hours.",
  "node.unscopedRelayHelp": "Share of relay traffic made up of flood packets without a scope. A higher count may indicate an unsuitable flood.max.unscoped setting.",
  "node.advertHelp": "Number of captured adverts with which the node publishes its identity and metadata.",
  "node.usefulnessHelp": "Weighted overall score composed of bridge, coverage, criticality and traffic share. {window}",
  "node.coverageHelp": "Average of how well the node is reachable from the rest of the mesh via good-quality paths.",
  "node.trafficShareHelp": "Average share of non-advert traffic in which the node appeared as a relay hop.",
  "node.bridgeHelp": "Average of how often the node lies on the most advantageous paths between other nodes.",
  "node.criticalityHelp": "Average of how much removing this node would split the network. A higher value means less redundancy.",
  "node.defaultScopeHelp": "The scope to which the node normally limits its flood traffic.",
  "node.transportedScopesHelp": "Scopes observed in traffic transported by this node.",
  "node.foreignHelp": "According to network metadata, the node is outside the home area.",
  "node.hashStatus.confirmed": "Confirmed",
  "node.hashStatus.suspected": "Inferred",
  "node.hashStatus.unknown": "Unknown",
  "node.hashEvidence.advert": "advert",
  "node.hashEvidence.path": "path",
  "stats.emptyCombination": "No data for this metric and period combination.",
  "stats.emptyMetric": "No data for this metric.",
  "stats.today": "Today",
  "stats.total": "Total",
  "stats.visitsToday": "{visits} visits · {unique} unique · peak {peak}",
  "stats.visitsTotal": "{visits} visits · peak {peak} concurrent",
  "stats.show": "Statistics",
  "stats.hide": "Hide statistics",
  "activity.show": "Activity",
  "activity.hide": "Hide activity",
  "feedback.emptyPublic": "No public messages yet.",
  "feedback.visitor": "Visitor",
  "feedback.tooShort": "The message must be at least 5 characters long.",
  "feedback.sending": "Sending…",
  "feedback.sent": "Thank you, your message has been sent.",
  "feedback.failed": "Sending failed. Please try again.",
  "feedback.failedWith": "Sending failed: {message}",
  "los.chartLabel": "Route elevation profile",
  "los.status.terrain": "terrain in beam",
  "los.status.fresnel": "Fresnel",
  "los.status.clear": "clear",
  "los.hover": "{distance} km · terrain {terrain} m · LOS {line} m · clearance {clearance} m ({status})",
  "los.result.blocked": "terrain blocks the beam",
  "los.result.clear": "clear line of sight",
  "los.result.fresnel": "Fresnel zone obstruction",
  "los.summary": "{distance} km · F1 {fresnel} m · clearance {clearance} m · Fresnel {fresnelClearance} m · {status}",
  "los.calculating": "Calculating terrain elevations…",
  "los.someMissing": "Some elevations could not be loaded. Try “Recalculate”.",
  "los.dragHint": "Drag the points on the map to recalculate the profile.",
  "los.rateLimited": "Open-Meteo is temporarily rate-limiting elevation requests. Try “Recalculate” in ~{seconds} s.",
  "los.loadFailed": "Elevations could not be loaded. Try “Recalculate” in a moment.",
  "los.pointA": "A: {name} ({role}). Click the second point.",
  "los.pointBHint": "Click the second point.",
  "los.firstHint": "Click the first point or a node.",
  "los.pointTooltip": "{label}: {name} ({role})",
  "lang.switchToEnglish": "Switch to English",
  "lang.switchToCzech": "Switch to Czech",
  "lang.production": "production ↗",
  "lang.productionTitle": "Go to the production version",
};

export const TRANSLATIONS = { cs, en };

export const STATIC_EN = {
  "Živá mapa paketových tras české sítě MeshCore": "Live map of packet routes on the Czech MeshCore network",
  "MeshCore CZ · živý provoz": "MeshCore CZ · live traffic",
  "Mapa živých tras": "Live route map",
  "Ovládání mapy": "Map controls",
  "Skrýt nebo zobrazit panel": "Hide or show panel",
  "live mapa": "live map",
  "Přepnout světlé a tmavé téma": "Toggle light and dark theme",
  "Otevřít MeshCore.cz": "Open MeshCore.cz",
  "Připojuji API": "Connecting to API",
  "Trasy": "Routes",
  "Paketů/h": "Packets/h",
  "Hledat uzel podle názvu nebo prefixu…": "Search nodes by name or prefix…",
  "Aktivita": "Activity",
  "Statistiky": "Statistics",
  "Změřit přímou viditelnost mezi dvěma body": "Measure line of sight between two points",
  "Kniha návštěv": "Guestbook",
  "Podklad mapy": "Base map",
  "Základní": "Standard",
  "Satelitní": "Satellite",
  "Časové okno": "Time window",
  "Časové okno tras": "Route time window",
  "Velikost hashe": "Hash size",
  "Role uzlu": "Node role",
  "Ostatní": "Other",
  "Zobrazit ostatní typy": "Show other types",
  "REQ, RESPONSE, ACK, DATA a CONTROL": "REQ, RESPONSE, ACK, DATA and CONTROL",
  "Animovat trasy": "Animate routes",
  "Zobrazit názvy uzlů": "Show node names",
  "Legenda": "Legend",
  "Top 25 Užitečnost": "Top 25 usefulness",
  "Top 100 Užitečnost": "Top 100 usefulness",
  "Zpráva": "Message",
  "TRACE (barvy podle SNR)": "TRACE (colours by SNR)",
  "Kolik lidí má právě otevřenou mapu": "How many people have the map open right now",
  "právě prohlíží mapu": "viewing the map now",
  "Data: CoreScope / MeshCore CZ (živý MQTT feed), archiv z vlastní databáze. Soukromý obsah zpráv zůstává šifrovaný. Podklady: OpenStreetMap, OpenTopoMap, Esri. Výšky: Open-Meteo. Ikona: selfh.st (CC BY 4.0).": "Data: CoreScope / MeshCore CZ (live MQTT feed), archive from our own database. Private message content remains encrypted. Basemaps: OpenStreetMap, OpenTopoMap, Esri. Elevations: Open-Meteo. Icon: selfh.st (CC BY 4.0).",
  "Poslední trasy": "Latest routes",
  "Živá aktivita": "Live activity",
  "poslední trasy": "latest routes",
  "Čekám na paket s trasou…": "Waiting for a route packet…",
  "Statistiky sítě": "Network statistics",
  "Zavřít statistiky": "Close statistics",
  "Vysvětlení metrik": "Metric explanations",
  "Hodnoty pocházejí z uzlů a dlouhodobých hodinových vzorků (sběr po 15 minutách).": "Values come from nodes and long-term hourly samples (collected every 15 minutes).",
  "Přenos": "Traffic",
  "Počet výskytů uzlu jako relay hop za zvolené období.": "Number of times the node appeared as a relay hop during the selected period.",
  "Přenos bez scope": "Unscoped traffic",
  "Část relay provozu tvořená flood pakety bez scope za 24 h. Vyšší hodnota může znamenat nevhodné nastavení flood.max.unscoped.": "Share of relay traffic made up of flood packets without a scope over 24 h. A higher value may indicate an unsuitable flood.max.unscoped setting.",
  "Advertů": "Adverts",
  "Počet zachycených oznámení, kterými uzel zveřejňuje svoji identitu.": "Number of captured adverts with which the node publishes its identity.",
  "Podíl provozu": "Traffic share",
  "Část neadvertového provozu, ve kterém se uzel objevil jako relay hop.": "Share of non-advert traffic in which the node appeared as a relay hop.",
  "Užitečnost": "Usefulness",
  "Složené skóre: 30 % bridge + 25 % pokrytí + 25 % kritičnost + 20 % podíl provozu.": "Composite score: 30% bridge + 25% coverage + 25% criticality + 20% traffic share.",
  "Pokrytí": "Coverage",
  "Jak dobře je uzel přes kvalitní cesty dosažitelný ze zbytku sítě.": "How well the node is reachable from the rest of the network via good-quality paths.",
  "Bridge": "Bridge",
  "Jak často uzel leží na nejvýhodnějších cestách mezi ostatními uzly.": "How often the node lies on the most advantageous paths between other nodes.",
  "Kritičnost": "Criticality",
  "Nakolik by odstranění uzlu rozdělilo síť.": "How much removing the node would split the network.",
  "Období: 1 h a 24 h ukazují aktuální hodnotu, 7 dní dlouhodobý průměr. Přenos bez scope je dostupný jen za 24 h.": "Periods: 1 h and 24 h show the current value, 7 days shows the long-term average. Unscoped traffic is available for 24 h only.",
  "Metrika": "Metric",
  "Období": "Period",
  "7 dní": "7 days",
  "Počet uzlů": "Number of nodes",
  "Zavřít QR kontakt": "Close QR contact",
  "MeshCore kontakt": "MeshCore contact",
  "QR kód MeshCore kontaktu": "MeshCore contact QR code",
  "Naskenujte v mobilní aplikaci MeshCore": "Scan in the MeshCore mobile app",
  "Zavřít měření": "Close measurement",
  "Přímá viditelnost": "Line of sight",
  "Přepočítat": "Recalculate",
  "Frekvence (MHz)": "Frequency (MHz)",
  "Anténa A (m)": "Antenna A (m)",
  "Anténa B (m)": "Antenna B (m)",
  "Barvy úseků: zelená = volná, oranžová = zásah do Fresnelovy zóny, červená = terén blokuje paprsek. V profilu je plná Fresnelova zóna (F1) světle modrá, doporučených 60 % výrazněji. Výšky: Open-Meteo (Copernicus DEM, ~90 m).": "Segment colours: green = clear, orange = Fresnel zone obstruction, red = terrain blocks the beam. In the profile, the full Fresnel zone (F1) is light blue and the recommended 60% is stronger. Elevations: Open-Meteo (Copernicus DEM, ~90 m).",
  "Zavřít knihu návštěv": "Close guestbook",
  "Zanechte vzkaz, nahlášení chyby nebo návrh. Můžete ho zveřejnit, nebo poslat jen správci.": "Leave a message, a bug report or a suggestion. You can publish it or send it only to the administrator.",
  "Jméno (nepovinné, zobrazí se u veřejného vzkazu)": "Name (optional, shown with public messages)",
  "Např. Petr": "e.g. Peter",
  "Typ": "Type",
  "Vzkaz": "Message",
  "Chyba": "Bug",
  "Návrh na vylepšení": "Feature request",
  "Napište vzkaz…": "Write a message…",
  "Kontakt (nepovinné, nikdy se nezobrazí veřejně)": "Contact (optional, never shown publicly)",
  "E-mail nebo jiný kontakt": "Email or other contact",
  "Zveřejnit v knize návštěv (uvidí ji všichni)": "Publish in the guestbook (visible to everyone)",
  "Zavřít": "Close",
  "Odeslat": "Send",
  "Veřejné vzkazy": "Public messages",
};

function resolveLocale() {
  if (typeof window === "undefined") return "cs";
  try {
    const requested = new URLSearchParams(window.location.search).get("lang");
    if (LOCALES.includes(requested)) {
      window.localStorage.setItem(STORAGE_KEY, requested);
      return requested;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (LOCALES.includes(stored)) return stored;
  } catch {
    return "cs";
  }
  return "cs";
}

let locale = resolveLocale();

export function getLocale() {
  return locale;
}

export function setLocale(next) {
  if (!LOCALES.includes(next)) return;
  locale = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      return;
    }
  }
}

export function localeTag() {
  return TAGS[locale];
}

export function t(key, params = {}) {
  const template = messagesFor(locale)[key] ?? messagesFor("cs")[key] ?? key;
  return interpolate(template, params);
}

export function tCount(key, count, params = {}) {
  const entry = messagesFor(locale)[key] ?? messagesFor("cs")[key];
  if (entry == null) return key;
  if (typeof entry === "string") return interpolate(entry, { count, ...params });
  const rule = new Intl.PluralRules(localeTag()).select(count);
  const template = entry[rule] ?? entry.other ?? entry.many ?? entry.one;
  return interpolate(template, { count, ...params });
}

export function formatNumber(value) {
  return new Intl.NumberFormat(localeTag()).format(Number(value) || 0);
}

export function formatPercent(value) {
  return new Intl.NumberFormat(localeTag(), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function formatTime(value) {
  return new Date(value).toLocaleTimeString(localeTag());
}

export function formatDate(value) {
  return new Date(value).toLocaleDateString(localeTag());
}

export function formatDateTime(value) {
  return new Date(value).toLocaleString(localeTag());
}

export function roleLabel(role) {
  const key = `role.${role || "unknown"}`;
  const dictionary = messagesFor(locale);
  return Object.hasOwn(dictionary, key) ? t(key) : t("role.unknown");
}

export function applyStaticTranslations(root = typeof document !== "undefined" ? document : null) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  if (locale !== "en" || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const text = raw.trim();
    const translated = STATIC_EN[text];
    if (!translated) continue;
    const start = raw.indexOf(text);
    node.nodeValue = raw.slice(0, start) + translated + raw.slice(start + text.length);
  }
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of ["title", "aria-label", "placeholder", "content", "alt"]) {
      const value = element.getAttribute(attribute);
      if (value && STATIC_EN[value]) element.setAttribute(attribute, STATIC_EN[value]);
    }
  }
}

function messagesFor(code) {
  return code === "en" ? en : cs;
}

function interpolate(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (
    Object.hasOwn(params, key) ? String(params[key]) : match
  ));
}
