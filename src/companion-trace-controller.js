import WebBleConnection from "@liamcottle/meshcore.js/src/connection/web_ble_connection.js";
import WebSerialConnection from "@liamcottle/meshcore.js/src/connection/web_serial_connection.js";
import { appendReturnTracePath, buildTracePath, MAX_TRACE_HOPS, moveTraceHop } from "./trace-path.js";
import { installTwoByteTraceSupport } from "./companion-trace-protocol.js";
import { suggestTracePath } from "./trace-suggestion.js";
import { getLocale, t } from "./i18n.js";

export function createCompanionTraceController({ elements, allNodes, neighbors = () => new Map(), onPathChange = () => {} }) {
  let connection = null;
  let selfInfo = null;
  let selecting = false;
  let suggesting = false;
  let sending = false;
  let path = [];
  let suggestionContext = null;

  function setStatus(message, isError = false) {
    elements.companionTraceStatus.textContent = message;
    elements.companionTraceStatus.classList.toggle("error", isError);
  }

  function connected() {
    return Boolean(connection && selfInfo);
  }

  function updateControls() {
    elements.companionTraceConnectBle.disabled = Boolean(connection);
    elements.companionTraceConnectUsb.disabled = Boolean(connection);
    elements.companionTraceDisconnect.hidden = !connection;
    elements.companionTraceSelect.disabled = !connected() || sending;
    elements.companionTraceSuggest.disabled = !connected() || sending || (!suggesting && path.length !== 1);
    elements.companionTraceAlternative.disabled = !connected() || sending || suggesting || !suggestionContext;
    elements.companionTraceReturn.disabled = path.length < 2 || sending;
    elements.companionTraceClear.disabled = path.length === 0 || sending;
    elements.companionTraceSend.disabled = !connected() || path.length === 0 || sending || suggesting;
    elements.companionTraceSelect.textContent = t(selecting ? "companionTrace.selectStop" : "companionTrace.selectStart");
    elements.companionTraceSuggest.textContent = t(suggesting ? "companionTrace.suggestCancel" : "companionTrace.suggest");
  }

  function renderPath() {
    elements.companionTracePath.replaceChildren(...path.map((key, index) => {
      const node = allNodes().find((candidate) => String(candidate.public_key || "").toLowerCase() === key);
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${index + 1}. ${node?.name || key.slice(0, 12)} · ${key.slice(0, 4).toUpperCase()}`;
      const actions = document.createElement("span");
      actions.className = "companion-trace-hop-actions";
      for (const [direction, symbol, offset] of [["up", "↑", -1], ["down", "↓", 1]]) {
        const move = document.createElement("button");
        move.type = "button";
        move.textContent = symbol;
        const description = t(offset < 0 ? "companionTrace.moveUp" : "companionTrace.moveDown", { hop: index + 1 });
        move.setAttribute("aria-label", description);
        move.title = description;
        move.disabled = sending || index + offset < 0 || index + offset >= path.length;
        move.addEventListener("click", () => {
          if (sending) return;
          suggestionContext = null;
          path = moveTraceHop(path, index, index + offset);
          elements.companionTraceResult.textContent = "";
          renderPath();
          onPathChange([...path]);
          elements.companionTracePath.children[index + offset]?.querySelector(`[data-direction="${direction}"]`)?.focus();
        });
        move.dataset.direction = direction;
        actions.append(move);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.disabled = sending || suggesting;
      remove.setAttribute("aria-label", getLocale() === "en" ? `Remove hop ${index + 1}` : `Odebrat hop ${index + 1}`);
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (sending || suggesting) return;
        suggestionContext = null;
        path.splice(index, 1);
        elements.companionTraceResult.textContent = "";
        renderPath();
        onPathChange([...path]);
      });
      actions.append(remove);
      item.append(label, actions);
      return item;
    }));
    updateControls();
  }

  function addHop(node) {
    if (!selecting) return false;
    if (node?.role !== "repeater") {
      setStatus(t("companionTrace.hopNotRepeater"), true);
      return true;
    }
    const key = String(node.public_key || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) return true;
    if (suggesting) {
      const suggestion = suggestTracePath(path[0], key, neighbors(), allNodes());
      if (!suggestion) {
        setStatus(t("companionTrace.suggestNotFound"), true);
        return true;
      }
      path = suggestion.path;
      suggestionContext = { start: path[0], destination: key, seen: new Set([path.join(",")]) };
      suggesting = false;
      selecting = false;
      elements.companionTraceResult.textContent = t("companionTrace.suggestResult", {
        age: Math.max(0, Math.ceil((Date.now() - suggestion.oldest) / 3_600_000)),
      });
      setStatus(t("companionTrace.suggestReady"));
      renderPath();
      onPathChange([...path]);
      return true;
    }
    if (path.length >= MAX_TRACE_HOPS) {
      setStatus(t("companionTrace.pathTooLong"), true);
      return true;
    }
    try {
      buildTracePath([...path, key], allNodes());
    } catch (error) {
      if (error.message !== "ambiguous-prefix") {
        setStatus(t("companionTrace.traceError"), true);
        return true;
      }
      setStatus(t("companionTrace.hashCollision", { prefix: key.slice(0, 4).toUpperCase() }), true);
      return true;
    }
    path.push(key);
    suggestionContext = null;
    elements.companionTraceResult.textContent = "";
    setStatus(t("companionTrace.status.connected", {
      name: selfInfo.name || "Companion",
      key: bytesToHex(selfInfo.publicKey).slice(0, 12),
    }));
    renderPath();
    onPathChange([...path]);
    return true;
  }

  function waitForConnected(candidate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        candidate.off("connected", onConnected);
        candidate.off("disconnected", onDisconnected);
        reject(new Error(t("companionTrace.connectTimeout")));
      }, 15_000);
      const onConnected = () => {
        clearTimeout(timeout);
        candidate.off("disconnected", onDisconnected);
        resolve();
      };
      const onDisconnected = () => {
        clearTimeout(timeout);
        candidate.off("connected", onConnected);
        reject(new Error(t("companionTrace.connectionLost")));
      };
      candidate.on("connected", onConnected);
      candidate.on("disconnected", onDisconnected);
    });
  }

  async function connect(transport) {
    if (connection) return;
    if (transport === "ble" && !navigator.bluetooth) {
      setStatus(t("companionTrace.unsupportedBle"), true);
      return;
    }
    if (transport === "serial" && !navigator.serial) {
      setStatus(t("companionTrace.unsupportedUsb"), true);
      return;
    }
    elements.companionTraceConnectBle.disabled = true;
    elements.companionTraceConnectUsb.disabled = true;
    setStatus(t("companionTrace.status.connecting"));
    let candidate;
    try {
      candidate = transport === "ble" ? await WebBleConnection.open() : await WebSerialConnection.open();
      if (!candidate) {
        setStatus(t("companionTrace.status.disconnected"));
        updateControls();
        return;
      }
      connection = candidate;
      installTwoByteTraceSupport(candidate);
      const disconnected = () => {
        if (connection !== candidate) return;
        connection = null;
        selfInfo = null;
        selecting = false;
        suggesting = false;
        setStatus(t("companionTrace.status.disconnected"));
        updateControls();
      };
      candidate.on("disconnected", disconnected);
      await waitForConnected(candidate);
      selfInfo = await candidate.getSelfInfo(15_000);
      if (connection !== candidate) throw new Error(t("companionTrace.connectionLost"));
      setStatus(t("companionTrace.status.connected", {
        name: selfInfo.name || "Companion",
        key: bytesToHex(selfInfo.publicKey).slice(0, 12),
      }));
      updateControls();
    } catch (error) {
      if (candidate) {
        try { await candidate.close(); } catch {}
      }
      if (connection === candidate) connection = null;
      selfInfo = null;
      selecting = false;
      suggesting = false;
      setStatus(error?.message || t("companionTrace.traceError"), true);
      updateControls();
    }
  }

  async function disconnect() {
    const current = connection;
    connection = null;
    selfInfo = null;
    selecting = false;
    suggesting = false;
    updateControls();
    try { await current?.close(); } catch {}
    setStatus(t("companionTrace.status.disconnected"));
  }

  async function sendTrace() {
    if (!connected()) {
      setStatus(t("companionTrace.connectedRequired"), true);
      return;
    }
    if (!path.length) {
      setStatus(t("companionTrace.pathEmpty"), true);
      return;
    }
    let bytes;
    try {
      bytes = buildTracePath(path, allNodes());
    } catch {
      setStatus(t("companionTrace.traceError"), true);
      return;
    }
    selecting = false;
    sending = true;
    elements.companionTraceResult.textContent = "";
    renderPath();
    setStatus(t("companionTrace.traceSending"));
    try {
      const result = await connection.tracePath(bytes);
      const snrs = Array.from(result.pathSnrs || []).map((value) => ((value > 127 ? value - 256 : value) / 4).toFixed(1));
      const route = [...path].map((key) => {
        const node = allNodes().find((candidate) => String(candidate.public_key || "").toLowerCase() === key);
        return node?.name || key.slice(0, 8);
      });
      const trace = route.map((name, index) => `${name}${snrs[index] == null ? "" : ` (${snrs[index]} dB)`}`).join(" → ");
      elements.companionTraceResult.textContent = t("companionTrace.traceResult", {
        hops: result.pathHashes ? result.pathHashes.length / 2 : path.length,
        route: trace,
        snr: (Number(result.lastSnr) || 0).toFixed(1),
      });
      onPathChange([...path], { success: true, result });
      setStatus(t("companionTrace.status.connected", {
        name: selfInfo.name || "Companion",
        key: bytesToHex(selfInfo.publicKey).slice(0, 12),
      }));
    } catch (error) {
      const message = String(error?.message || error || "");
      setStatus(message === "timeout" ? t("companionTrace.traceFailed") : t("companionTrace.traceError"), true);
      onPathChange([...path], { success: false });
    } finally {
      sending = false;
      renderPath();
    }
  }

  elements.companionTraceTitle.textContent = t("companionTrace.title");
  elements.companionTraceHint.textContent = t("companionTrace.hint");
  elements.companionTraceConnectBle.textContent = t("companionTrace.connectBle");
  elements.companionTraceConnectUsb.textContent = t("companionTrace.connectUsb");
  elements.companionTraceDisconnect.textContent = t("companionTrace.disconnect");
  elements.companionTraceClear.textContent = t("companionTrace.clear");
  elements.companionTraceReturn.textContent = t("companionTrace.addReturn");
  elements.companionTraceSend.textContent = t("companionTrace.send");
  elements.companionTraceSuggest.hidden = import.meta.env.VITE_BETA !== "1";
  elements.companionTraceAlternative.hidden = elements.companionTraceSuggest.hidden;
  elements.companionTraceAlternative.textContent = t("companionTrace.alternative");
  elements.companionTraceSuggestHint.hidden = elements.companionTraceSuggest.hidden;
  elements.companionTraceSuggestHint.textContent = t("companionTrace.suggestHint");
  setStatus(t("companionTrace.status.disconnected"));
  updateControls();

  elements.companionTraceConnectBle.addEventListener("click", () => void connect("ble"));
  elements.companionTraceConnectUsb.addEventListener("click", () => void connect("serial"));
  elements.companionTraceDisconnect.addEventListener("click", () => void disconnect());
  elements.companionTraceSelect.addEventListener("click", () => {
    if (!connected() || sending) return;
    selecting = !selecting;
    suggesting = false;
    setStatus(selecting ? t("companionTrace.selectHint") : t("companionTrace.status.connected", {
      name: selfInfo.name || "Companion",
      key: bytesToHex(selfInfo.publicKey).slice(0, 12),
    }));
    renderPath();
  });
  elements.companionTraceClear.addEventListener("click", () => {
    path = [];
    suggestionContext = null;
    suggesting = false;
    selecting = false;
    elements.companionTraceResult.textContent = "";
    renderPath();
    onPathChange([]);
  });
  elements.companionTraceSuggest.addEventListener("click", () => {
    if (!connected() || sending) return;
    if (suggesting) {
      suggesting = false;
      selecting = false;
      setStatus(t("companionTrace.suggestCancelled"));
    } else {
      if (path.length !== 1) return;
      suggesting = true;
      selecting = true;
      setStatus(t("companionTrace.suggestSelectDestination"));
    }
    renderPath();
    updateControls();
  });
  elements.companionTraceAlternative.addEventListener("click", () => {
    if (!connected() || sending || suggesting || !suggestionContext) return;
    const suggestion = suggestTracePath(
      suggestionContext.start, suggestionContext.destination, neighbors(), allNodes(), Date.now(), suggestionContext.seen,
    );
    if (!suggestion) {
      setStatus(t("companionTrace.alternativeMissing"), true);
      return;
    }
    path = suggestion.path;
    suggestionContext.seen.add(path.join(","));
    elements.companionTraceResult.textContent = t("companionTrace.suggestResult", {
      age: Math.max(0, Math.ceil((Date.now() - suggestion.oldest) / 3_600_000)),
    });
    setStatus(t("companionTrace.suggestReady"));
    renderPath();
    onPathChange([...path]);
  });
  elements.companionTraceReturn.addEventListener("click", () => {
    if (sending || path.length < 2) return;
    try {
      path = appendReturnTracePath(path);
    } catch {
      setStatus(t("companionTrace.pathTooLong"), true);
      return;
    }
    suggestionContext = null;
    elements.companionTraceResult.textContent = "";
    if (connected()) {
      setStatus(t("companionTrace.status.connected", {
        name: selfInfo.name || "Companion",
        key: bytesToHex(selfInfo.publicKey).slice(0, 12),
      }));
    }
    renderPath();
    onPathChange([...path]);
  });
  elements.companionTraceSend.addEventListener("click", () => void sendTrace());

  return {
    addHop,
    disconnect,
    isSelecting: () => selecting,
    path: () => [...path],
  };
}

function bytesToHex(bytes) {
  return Array.from(bytes || []).map((byte) => Number(byte).toString(16).padStart(2, "0")).join("");
}
