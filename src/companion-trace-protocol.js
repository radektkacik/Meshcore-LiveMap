import Constants from "@liamcottle/meshcore.js/src/constants.js";

export function traceSnrTone(snr) {
  return snr >= 5 ? "good" : snr >= 0 ? "fair" : "bad";
}

export function measuredTraceSnrs(result, expectedPath) {
  const hashes = result?.pathHashes;
  const snrs = result?.pathSnrs;
  if (!hashes || hashes.length !== expectedPath.length
      || !Array.from(hashes).every((byte, index) => byte === expectedPath[index])
      || !snrs || snrs.length !== expectedPath.length / 2) {
    throw new Error("trace-path-mismatch");
  }
  return Array.from(snrs, (value) => (value > 127 ? value - 256 : value) / 4);
}

export function partialTraceSnrs(raw, tag, expectedPath) {
  const bytes = Uint8Array.from(raw || []);
  if (bytes.length < 11 || !Number.isInteger(tag) || (bytes[0] & 0x3f) !== 0x26) return null;
  const count = bytes[1];
  if (count > expectedPath.length / 2) return null;
  const offset = 2 + count;
  if (bytes.length !== offset + 9 + expectedPath.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(offset, true) !== tag || view.getUint32(offset + 4, true) !== 0 || bytes[offset + 8] !== 1) return null;
  if (!Array.from(expectedPath).every((byte, index) => bytes[offset + 9 + index] === byte)) return null;
  return Array.from(bytes.slice(2, offset), (value) => (value > 127 ? value - 256 : value) / 4);
}

export function encodeTwoByteTraceCommand(tag, auth, path) {
  const frame = new Uint8Array(10 + path.length);
  frame[0] = Constants.CommandCodes.SendTracePath;
  const view = new DataView(frame.buffer);
  view.setUint32(1, tag, true);
  view.setUint32(5, auth, true);
  frame[9] = 1; // MeshCore trace hash width: 1 << 1 = 2 bytes.
  frame.set(path, 10);
  return frame;
}

export function parseTwoByteTracePush(bufferReader) {
  const reserved = bufferReader.readByte();
  const pathLen = bufferReader.readUInt8();
  const flags = bufferReader.readUInt8();
  const pathSizeShift = flags & 0x03;
  return {
    reserved,
    pathLen,
    flags,
    tag: bufferReader.readUInt32LE(),
    authCode: bufferReader.readUInt32LE(),
    pathHashes: bufferReader.readBytes(pathLen),
    pathSnrs: bufferReader.readBytes(pathLen >> pathSizeShift),
    lastSnr: bufferReader.readInt8() / 4,
  };
}

export function installTwoByteTraceSupport(connection, onSend = () => {}) {
  connection.sendCommandSendTracePath = async function sendTwoByteTrace(tag, auth, path) {
    onSend(tag, path);
    await this.sendToRadioFrame(encodeTwoByteTraceCommand(tag, auth, path));
  };
  connection.onTraceDataPush = function onTwoByteTraceData(bufferReader) {
    this.emit(Constants.PushCodes.TraceData, parseTwoByteTracePush(bufferReader));
  };
}
