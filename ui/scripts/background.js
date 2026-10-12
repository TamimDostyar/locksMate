import { api, getToken, setTransport, siteOf, matchesSite } from "./api.js";

const HOST = "com.locksmate.vault";
const REQUEST_MS = 20_000;
let port;
let nextId = 0;
const inFlight = new Map();

function nativeRequest(request) {
  if (!port) {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener((message) => {
      inFlight.get(message.id)?.(message);
      inFlight.delete(message.id);
    });
    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message ?? "";
      const error = /not found/i.test(reason)
        ? "LocksMate backend isn't installed, run pnpm run setup"
        : "LocksMate backend stopped, see ~/.locksmate/host.log";
      for (const done of inFlight.values()) done({ status: 0, error });
      inFlight.clear();
      port = undefined;
      chrome.storage.session.remove("token");
    });
  }
  const id = ++nextId;
  return new Promise((resolve) => {
    // a hung backend must not leave buttons waiting forever
    const timer = setTimeout(() => {
      inFlight.delete(id);
      resolve({ status: 0, error: "LocksMate backend didn't respond, try again" });
    }, REQUEST_MS);
    inFlight.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    try {
      port.postMessage({ id, ...request });
    } catch {
      inFlight.get(id)?.({ status: 0, error: "LocksMate backend stopped, try again" });
      inFlight.delete(id);
    }
  });
}

setTransport(nativeRequest);

const UNLOCK_URL = chrome.runtime.getURL("pages/unlock.html");
const EXTENSION_ROOT = chrome.runtime.getURL("");

// unlock shows on top of the page the user is on; the one-time nonce makes sure only
// LocksMate can open it there, not a website embedding the unlock page itself
// repeated clicks while an unlock is opening reuse the same attempt
const unlocking = new Map();
function openUnlock(tabId) {
  const key = tabId ?? "window";
  if (!unlocking.has(key)) {
    unlocking.set(key, showUnlock(tabId).finally(() => unlocking.delete(key)));
  }
  return unlocking.get(key);
}

async function showUnlock(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
  if (tab?.url?.startsWith("http")) {
    // a list, so a newer nonce never invalidates an unlock frame that's still loading
    const nonce = crypto.randomUUID();
    const { unlockNonces = [] } = await chrome.storage.session.get("unlockNonces");
    await chrome.storage.session.set({ unlockNonces: [...unlockNonces, nonce].slice(-5) });
    const shown = await chrome.tabs.sendMessage(tab.id, { type: "showUnlock", nonce }).catch(() => false);
    if (shown) return;
  }
  return openUnlockWindow();
}

// fallback for pages LocksMate can't draw on, like the new tab page
async function openUnlockWindow() {
  const [open] = await chrome.tabs.query({ url: `${UNLOCK_URL}*` });
  if (open) return chrome.windows.update(open.windowId, { focused: true });

  const current = await chrome.windows.getLastFocused();
  const width = 380;
  const placement =
    current.left !== undefined && current.width !== undefined
      ? { left: current.left + current.width - width - 16, top: (current.top ?? 0) + 72 }
      : {};
  return chrome.windows.create({ url: UNLOCK_URL, type: "popup", width, height: 460, focused: true, ...placement });
}

async function loginsFor(site) {
  const { output } = await api("/entries");
  return output.filter((e) => matchesSite(e.url, site));
}

const generatedFor = new Map();

// spamming generate gets the same password back instead of saving several
const generating = new Map();
function generate(site) {
  if (!generating.has(site)) {
    generating.set(site, generateNow(site).finally(() => generating.delete(site)));
  }
  return generating.get(site);
}

async function generateNow(site) {
  const [{ password }, { email }] = await Promise.all([
    api("/entries/generate", { method: "POST", body: { length: 20 } }),
    api("/entries/email"),
  ]);
  const existing = (await loginsFor(site)).some((e) => e.email === email);
  if (existing) {
    generatedFor.set(site, password);
  } else {
    await api("/entries", { method: "POST", body: { url: site, email, password } });
  }
  return { email, password };
}

async function save(site, email, password) {
  if (typeof password !== "string" || !password) return { saved: false };
  email = String(email ?? "").trim();
  const known = (await loginsFor(site)).find((e) => e.email === email);

  if (known && generatedFor.get(site) !== password) return { saved: false };
  generatedFor.delete(site);
  if (known?.password === password) return { saved: false };
  await api("/entries", { method: "POST", body: { url: site, email, password } });
  return { saved: true };
}

async function fromPage(message, sender) {
  const site = siteOf(sender.url);
  if (message.type === "unlock") {
    await openUnlock(sender.tab.id);
    return {};
  }
  if (!(await getToken())) return { locked: true };

  switch (message.type) {
    case "logins":
      return { logins: (await loginsFor(site)).map(({ id, email }) => ({ id, email })) };
    case "fill": {
      const entry = (await loginsFor(site)).find((e) => e.id === message.id);
      return entry ? { email: entry.email, password: entry.password } : { error: "Login not found" };
    }
    case "generate":
      return generate(site);
    case "save":
      return save(site, message.email, message.password);
  }
  return { error: "Unknown request" };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let work;
  const fromExtension = sender.url?.startsWith(EXTENSION_ROOT);
  if (fromExtension && message.type === "api") work = nativeRequest(message.request);
  else if (fromExtension && message.type === "openUnlock") work = openUnlock(message.tabId).then(() => ({}));
  else if (fromExtension && message.type === "unlocked" && sender.tab)
    work = chrome.tabs.sendMessage(sender.tab.id, { type: "unlocked" }).catch(() => {}).then(() => ({}));
  else if (sender.tab && sender.url?.startsWith("http")) work = fromPage(message, sender);
  else return false;

  work.then(reply, (e) => reply(e.locked ? { locked: true } : { error: e.message }));
  return true;
});
