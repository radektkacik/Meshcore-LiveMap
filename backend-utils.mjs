export class TimeBoundRingBuffer {
  #capacity;
  #entries;
  #maxAgeMs;
  #size = 0;
  #start = 0;

  constructor({ capacity, maxAgeMs }) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be positive");
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new RangeError("maxAgeMs must be non-negative");
    this.#capacity = capacity;
    this.#entries = new Array(capacity);
    this.#maxAgeMs = maxAgeMs;
  }

  add(value, timestamp = Date.now()) {
    this.#removeOlderThan(timestamp - this.#maxAgeMs);
    const index = (this.#start + this.#size) % this.#capacity;
    this.#entries[index] = { timestamp, value };
    if (this.#size === this.#capacity) {
      this.#start = (this.#start + 1) % this.#capacity;
    } else {
      this.#size += 1;
    }
  }

  values(now = Date.now()) {
    this.#removeOlderThan(now - this.#maxAgeMs);
    return Array.from({ length: this.#size }, (_, offset) => (
      this.#entries[(this.#start + offset) % this.#capacity].value
    ));
  }

  #removeOlderThan(cutoff) {
    while (this.#size > 0 && this.#entries[this.#start].timestamp < cutoff) {
      this.#entries[this.#start] = undefined;
      this.#start = (this.#start + 1) % this.#capacity;
      this.#size -= 1;
    }
  }
}

export function decodedPacketPath(decoded) {
  const payload = decoded?.payload?.decoded ?? decoded?.payload ?? {};
  if (Array.isArray(payload.pathHashes) && payload.pathHashes.length) return payload.pathHashes;
  if (decoded?.payloadType === 9) return [];
  if ([0, 1].includes(decoded?.routeType) && Array.isArray(decoded.path)) return decoded.path;
  return [];
}

export function decodedPacketHashBytes(decoded) {
  const payload = decoded?.payload?.decoded ?? decoded?.payload ?? {};
  const value = Number(decoded?.payloadType === 9 ? payload.pathHashSize : decoded?.pathHashSize);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 0;
}
