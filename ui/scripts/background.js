import { api, getToken, siteOf, matchesSite } from "./api.js";

const UNLOCK_URL = chrome.runtime.getURL("pages/unlock.html");
const EXTENSION_ROOT = chrome.runtime.getURL("");

// Touch ID closes the toolbar popup, so unlocking happens in a small window of its own
async function openUnlock() {
  const [open] = await chrome.tabs.query({ url: UNLOCK_URL });
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

// generated passwords waiting for the form to be submitted, by site
const pending = new Map();

async function generate(site) {
  const { password } = await api("/entries/generate", { method: "POST", body: { length: 20 } });
  const { email } = await api("/entries/email");
  const existing = (await loginsFor(site)).some((e) => e.email === email);
  if (existing) {
    // changing a password: only replace the saved one once the site actually accepts the form
    pending.set(site, password);
  } else {
    // new account: save now so a generated password is never lost
    await api("/entries", { method: "POST", body: { url: site, email, password } });
  }
  return { email, password };
}

async function save(site, email, password) {
  if (typeof password !== "string" || !password) return { saved: false };
  email = String(email ?? "").trim();
  const known = (await loginsFor(site)).find((e) => e.email === email);
  // never overwrite a saved password with whatever was typed (could be a typo on a login form),
  // unless it's the password we generated for this site
  if (known && pending.get(site) !== password) return { saved: false };
  pending.delete(site);
  if (known?.password === password) return { saved: false };
  await api("/entries", { method: "POST", body: { url: site, email, password } });
  return { saved: true };
}

async function fromPage(message, sender) {
  // the site always comes from Chrome, never from the page itself
  const site = siteOf(sender.url);
  if (message.type === "unlock") {
    await openUnlock();
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
  if (sender.url?.startsWith(EXTENSION_ROOT) && message.type === "openUnlock") work = openUnlock().then(() => ({}));
  else if (sender.tab && sender.url?.startsWith("http")) work = fromPage(message, sender);
  else return false;

  work.then(reply, (e) => reply(e.locked ? { locked: true } : { error: e.message }));
  return true;
});
