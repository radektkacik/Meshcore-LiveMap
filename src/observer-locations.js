const AIRPORT_COORDS = {
  BRQ: { lat: 49.1513, lon: 16.6944 },
  HRA: { lat: 50.2532, lon: 15.8452 },
  JCL: { lat: 48.9464, lon: 14.4275 },
  KLV: { lat: 50.2029, lon: 12.915 },
  OLO: { lat: 49.5878, lon: 17.21 },
  OSR: { lat: 49.6963, lon: 18.1111 },
  PED: { lat: 50.0134, lon: 15.7386 },
  PRG: { lat: 50.1008, lon: 14.26 },
  UHE: { lat: 49.0683, lon: 17.445 },
  ULK: { lat: 50.68, lon: 14.04 },
  VOD: { lat: 50.2166, lon: 14.3958 },
  ZLN: { lat: 49.1983, lon: 17.5178 },
};

export function observerAnchor(iata) {
  return AIRPORT_COORDS[String(iata || "").toUpperCase()] || null;
}
