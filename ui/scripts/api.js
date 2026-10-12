
export const getToken = async () => (await chrome.storage.session.get("token")).token;
export const setToken = (token) => chrome.storage.session.set({ token });
export const clearToken = () => chrome.storage.session.remove("token");

export class LockedError extends Error {
  locked = true;
}

let transport = (request) => chrome.runtime.sendMessage({ type: "api", request });
export const setTransport = (fn) => (transport = fn);

export async function api(path, { method = "GET", body } = {}) {
  const token = await getToken();
  const res = await transport({ method, path: `/api${path}`, body, token });
  if (!res?.status) throw new Error(res?.error ?? "LocksMate backend is not available");

  if (res.status === 401 && token) {
    await clearToken();
    throw new LockedError("Vault is locked");
  }
  if (res.status >= 400) throw new Error(res.body?.error ?? "Something went wrong");
  return res.body;
}

// runs fn once at a time per button: repeat clicks while it's working are ignored
export async function busy(button, fn, text) {
  if (button.disabled) return;
  const label = button.innerHTML;
  button.disabled = true;
  if (text) button.textContent = text;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    if (text) button.innerHTML = label;
  }
}

export function siteOf(input) {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return input.trim().toLowerCase();
  }
}

export const matchesSite = (entrySite, site) => site === entrySite || site.endsWith(`.${entrySite}`);
