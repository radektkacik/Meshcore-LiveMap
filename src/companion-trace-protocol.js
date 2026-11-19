import Constants from "@liamcottle/meshcore.js/src/constants.js";

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

export function installTwoByteTraceSupport(connection) {
  connection.sendCommandSendTracePath = async function sendTwoByteTrace(tag, auth, path) {
    await this.sendToRadioFrame(encodeTwoByteTraceCommand(tag, auth, path));
  };
  connection.onTraceDataPush = function onTwoByteTraceData(bufferReader) {
    this.emit(Constants.PushCodes.TraceData, parseTwoByteTracePush(bufferReader));
  };
}
