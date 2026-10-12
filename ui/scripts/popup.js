import { api, busy, getToken, clearToken, siteOf, matchesSite } from "./api.js";
import { icons } from "./icons.js";

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icons[el.dataset.icon];

let entries = [];
let tab;
let site = "";

function show(view) {
  for (const id of ["loading", "locked", "vault", "editor"]) $(id).hidden = id !== view;
  $("lock").hidden = view === "locked" || view === "loading";
}

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1600);
}

function iconButton(icon, title, onClick, extra = "") {
  const b = document.createElement("button");
  b.className = `icon-btn ${extra}`;
  b.title = title;
  b.innerHTML = icons[icon];
  b.addEventListener("click", onClick);
  return b;
}

function avatar(entry) {
  const box = document.createElement("div");
  box.className = "avatar";
  const img = document.createElement("img");
  const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
  favicon.searchParams.set("pageUrl", `https://${entry.url}`);
  favicon.searchParams.set("size", "32");
  img.src = favicon.href;
  img.alt = "";
  img.onerror = () => (box.textContent = entry.url[0] ?? "?");
  box.append(img);
  return box;
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  } catch {
    toast(`Couldn't copy ${label.toLowerCase()}`);
  }
}

async function fill(entry) {
  try {
    const filled = await chrome.tabs.sendMessage(tab.id, {
      type: "fillCredentials",
      site: entry.url,
      email: entry.email,
      password: entry.password,
    });
    if (filled) window.close();
    else toast("No login form on this page");
  } catch {
    toast("Can't fill on this page");
  }
}

async function remove(entry, button) {
  // two step: first click arms, second deletes
  if (!button.dataset.armed) {
    button.dataset.armed = "1";
    button.title = "Click again to delete";
    button.style.color = "var(--danger)";
    setTimeout(() => {
      delete button.dataset.armed;
      button.style.color = "";
    }, 2500);
    return;
  }
  await busy(button, async () => {
    await guard(api(`/entries/${entry.id}`, { method: "DELETE" }));
    await guard(load());
    toast("Deleted");
  }).catch(() => {});
}

function row(entry, onSite) {
  const li = document.createElement("li");
  li.className = "row";

  const info = document.createElement("div");
  info.className = "info";
  const name = document.createElement("strong");
  const email = document.createElement("span");
  name.textContent = entry.url;
  email.textContent = entry.email;
  info.append(name, email);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    iconButton("user", "Copy username", () => copy(entry.email, "Username")),
    iconButton("key", "Copy password", () => copy(entry.password, "Password")),
    iconButton("edit", "Edit", () => openEditor(entry)),
  );
  const del = iconButton("trash", "Delete", () => remove(entry, del), "danger");
  actions.append(del);

  li.append(avatar(entry), info, actions);

  if (onSite) {
    const fillBtn = document.createElement("button");
    fillBtn.className = "fill";
    fillBtn.textContent = "Fill";
    fillBtn.addEventListener("click", () => busy(fillBtn, () => fill(entry), "Filling…"));
    li.append(fillBtn);
  }
  return li;
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const visible = entries.filter((e) => `${e.url} ${e.email}`.toLowerCase().includes(query));
  const onSite = site ? visible.filter((e) => matchesSite(e.url, site)) : [];

  $("site").textContent = site;
  $("site-block").hidden = onSite.length === 0;
  $("site-list").replaceChildren(...onSite.map((e) => row(e, true)));
  $("list").replaceChildren(...visible.map((e) => row(e, false)));
  $("count").textContent = visible.length || "";
  $("empty").hidden = visible.length > 0;
  $("empty").textContent = entries.length ? "No matches" : "No logins yet";
}

async function load() {
  ({ output: entries } = await api("/entries"));
  render();
}

// any call can find the vault locked (session expired), drop back to the locked view
async function guard(promise) {
  try {
    return await promise;
  } catch (e) {
    if (e.locked) show("locked");
    else toast(e.message);
    throw e;
  }
}

async function openEditor(entry) {
  $("form").reset();
  $("form-error").textContent = "";
  $("f-password").type = "password";
  $("editor-title").textContent = entry ? "Edit login" : "New login";
  $("f-site").value = entry?.url ?? site;
  $("f-email").value = entry?.email ?? "";
  $("f-password").value = entry?.password ?? "";
  // site and email are the key of a login, so only the password changes on edit
  $("f-site").readOnly = $("f-email").readOnly = Boolean(entry);
  show("editor");
  (entry ? $("f-password") : $("f-site")).focus();
  // prefill the last used email when it arrives, without holding up the form
  if (!entry) {
    api("/entries/email")
      .then(({ email }) => {
        if (!$("f-email").value && !$("f-email").readOnly) $("f-email").value = email;
      })
      .catch(() => {});
  }
}

$("unlock").addEventListener("click", (e) =>
  busy(
    e.currentTarget,
    async () => {
      $("locked-error").textContent = "";
      const res = await chrome.runtime.sendMessage({ type: "openUnlock", tabId: tab?.id }).catch((err) => ({ error: err.message }));
      if (res?.error) $("locked-error").textContent = res.error;
      else window.close();
    },
    "Opening Touch ID…",
  ),
);

$("lock").addEventListener("click", (e) =>
  busy(e.currentTarget, async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await clearToken();
    entries = [];
    show("locked");
  }),
);

$("search").addEventListener("input", render);
$("add").addEventListener("click", () => openEditor());
$("back").addEventListener("click", () => show("vault"));

$("reveal").addEventListener("click", () => {
  $("f-password").type = $("f-password").type === "password" ? "text" : "password";
});

$("generate").addEventListener("click", (e) =>
  busy(e.currentTarget, async () => {
    const { password } = await guard(api("/entries/generate", { method: "POST", body: { length: 20 } }));
    $("f-password").value = password;
    $("f-password").type = "text";
  }).catch(() => {}),
);

$("form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("form-error").textContent = "";
  busy(
    $("save"),
    async () => {
      try {
        await guard(
          api("/entries", {
            method: "POST",
            body: { url: siteOf($("f-site").value), email: $("f-email").value.trim(), password: $("f-password").value },
          }),
        );
        await guard(load());
        show("vault");
        toast("Saved");
      } catch (e) {
        if (!e.locked) $("form-error").textContent = e.message;
      }
    },
    "Saving…",
  );
});

// the session can change while the popup is open: backend restarted, or unlocked elsewhere
chrome.storage.session.onChanged.addListener(async ({ token }) => {
  if (!token) return;
  if (!token.newValue) {
    entries = [];
    return show("locked");
  }
  try {
    await load();
    show("vault");
  } catch {}
});

// start
// whatever goes wrong, never leave the popup on the loading view
try {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith("http")) site = siteOf(tab.url);

  if (!(await getToken())) {
    show("locked");
  } else {
    await load();
    show("vault");
    $("search").focus();
  }
} catch (e) {
  show("locked");
  if (!e.locked) $("locked-error").textContent = e.message;
}
