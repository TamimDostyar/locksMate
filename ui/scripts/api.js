const BASE = "http://127.0.0.1:9009/api";

// chrome.storage.session lives in memory, is shared by the extension's pages and
// background, and is never visible to content scripts or websites
export const getToken = async () => (await chrome.storage.session.get("token")).token;
export const setToken = (token) => chrome.storage.session.set({ token });
export const clearToken = () => chrome.storage.session.remove("token");

export class LockedError extends Error {
  locked = true;
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json", "X-LocksMate": "1" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  } catch {
    throw new Error("LocksMate server is not running");
  }

  if (res.status === 401 && token) {
    await clearToken();
    throw new LockedError("Vault is locked");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

// "https://www.github.com/login" -> "github.com"
export function siteOf(input) {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return input.trim().toLowerCase();
  }
}

// an entry for github.com also matches gist.github.com
export const matchesSite = (entrySite, site) => site === entrySite || site.endsWith(`.${entrySite}`);
