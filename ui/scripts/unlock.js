import { api, getToken, setToken } from "./api.js";
import { icons } from "./icons.js";

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icons[el.dataset.icon];

const toBase64Url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function setup() {
  const options = await api("/auth/setup/options", { method: "POST" });
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  await api("/auth/setup/verify", { method: "POST", body: { credential: credential.toJSON() } });
}

async function unlock() {
  const options = await api("/auth/login/options", { method: "POST" });
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  // the PRF secret is sent on its own, it becomes the vault key on the server
  const secret = credential.getClientExtensionResults().prf?.results?.first;
  const json = credential.toJSON();
  json.clientExtensionResults = {};
  const { token } = await api("/auth/login", {
    method: "POST",
    body: { credential: json, prf: secret ? toBase64Url(secret) : undefined },
  });
  await setToken(token);
}

const embedded = window.top !== window;
let registered;

async function done() {
  if (embedded) await chrome.runtime.sendMessage({ type: "unlocked" });
  else window.close();
}

// embedded unlock only works when LocksMate itself put it on the page
async function allowed() {
  if (!embedded) return true;
  const nonce = location.hash.slice(1);
  const { unlockNonces = [] } = await chrome.storage.session.get("unlockNonces");
  if (!nonce || !unlockNonces.includes(nonce)) return false;
  await chrome.storage.session.set({ unlockNonces: unlockNonces.filter((n) => n !== nonce) });
  return true;
}

function errorText(e) {
  if (e.name === "NotAllowedError") return "Touch ID was cancelled";
  if (e.name === "InvalidStateError" || /pending/i.test(e.message)) return "Touch ID is already open";
  return e.message;
}

const idleLabel = () => (registered === false ? "Set up with Touch ID" : "Unlock with Touch ID");

async function loadStatus() {
  ({ registered } = await api("/auth/status"));
  if (!registered) {
    $("title").textContent = "Set up LocksMate";
    $("subtitle").textContent = "Your fingerprint becomes the only key to your vault.";
  }
  $("label").textContent = idleLabel();
}

let running = false;
async function run({ auto = false } = {}) {
  if (running) return;
  running = true;
  $("error").textContent = "";
  $("hint").textContent = "";
  $("submit").disabled = true;
  $("label").textContent = "Waiting for Touch ID…";
  try {
    if (registered === undefined) await loadStatus();
    if (!registered) {
      await setup();
      registered = true;
    }
    await unlock();
    $("label").textContent = "Unlocked";
    await done();
  } catch (e) {
    // the auto prompt can be refused when this frame isn't focused yet, point at the button instead
    if (auto && e.name === "NotAllowedError") $("hint").textContent = "Click the button to use Touch ID.";
    else $("error").textContent = errorText(e);
    $("submit").focus();
  } finally {
    running = false;
    $("submit").disabled = false;
    if ($("label").textContent !== "Unlocked") $("label").textContent = idleLabel();
  }
}

$("unlock").addEventListener("submit", (event) => {
  event.preventDefault();
  run();
});

if (embedded) document.body.classList.add("embedded");

$("submit").disabled = true;
if (!(await allowed())) {
  $("error").textContent = "Open LocksMate from the toolbar to unlock.";
  throw new Error("unlock page opened outside LocksMate");
}
if (await getToken()) {
  await done();
  throw new Error("already unlocked");
}

$("label").textContent = "Connecting…";
try {
  await loadStatus();
  $("submit").disabled = false;
  // one click from the popup is enough, go straight to Touch ID
  if (registered) run({ auto: true });
} catch (e) {
  // the button retries the status check
  $("error").textContent = e.message;
  $("submit").disabled = false;
  $("label").textContent = "Try again";
}
