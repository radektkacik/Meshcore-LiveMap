import { getLocale, t } from "./i18n.js";

let configPromise;
let scriptPromise;
let queue = Promise.resolve();

function protectedWrite(path) {
  return ["/api/photos", "/api/photos/report", "/api/comments", "/api/feedback", "/api/node-info"].includes(path)
    || /^\/api\/photos\/[0-9a-f-]{36}\/vote$/.test(path);
}

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const timer = setTimeout(() => fail(), 15_000);
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error(t("security.verificationFailed")));
    };
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    document.head.append(script);
  }).catch((error) => { scriptPromise = null; throw error; });
  return scriptPromise;
}

async function challenge(siteKey) {
  const api = await loadScript();
  return new Promise((resolve, reject) => {
    const container = document.createElement("div");
    container.className = "security-verification";
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    const parent = document.activeElement?.closest("dialog[open]") || dialogs.at(-1) || document.body;
    parent.append(container);
    let widget;
    let finished = false;
    const finish = (token) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      parent.removeEventListener("close", cancelled);
      if (widget != null) api.remove(widget);
      container.remove();
      if (token) resolve(token);
      else reject(new Error(t("security.verificationFailed")));
    };
    const cancelled = () => finish();
    const timer = setTimeout(cancelled, 120_000);
    parent.addEventListener("close", cancelled, { once: true });
    try {
      widget = api.render(container, {
        sitekey: siteKey,
        action: "map_write",
        language: getLocale(),
        appearance: "interaction-only",
        size: "flexible",
        "response-field": false,
        retry: "never",
        callback: finish,
        "error-callback": cancelled,
        "expired-callback": cancelled,
        "timeout-callback": cancelled,
      });
    } catch {
      finish();
    }
  });
}

// A fresh single-use token is generated for every write, including each photo in a batch.
// Call before creating the actual upload's timeout so the challenge doesn't consume it.
export async function writeHeaders(appPath, path, initial = {}) {
  const headers = new Headers(initial);
  if (!protectedWrite(path)) return headers;
  if (!configPromise) {
    configPromise = fetch(appPath("/api/security/config"), { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((response) => {
        if (!response.ok) throw new Error(t("security.verificationFailed"));
        return response.json();
      }).catch((error) => { configPromise = null; throw error; });
  }
  const config = await configPromise;
  if (!config.enabled) {
    configPromise = null;
    return headers;
  }
  const pending = queue.then(() => challenge(config.siteKey));
  queue = pending.catch(() => {});
  headers.set("X-Turnstile-Token", await pending);
  return headers;
}
