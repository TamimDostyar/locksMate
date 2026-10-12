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

let registered;

async function run() {
  $("error").textContent = "";
  $("submit").disabled = true;
  try {
    if (!registered) {
      await setup();
      registered = true;
    }
    await unlock();
    window.close();
  } catch (e) {
    $("error").textContent = e.name === "NotAllowedError" ? "Touch ID was cancelled" : e.message;
  } finally {
    $("submit").disabled = false;
  }
}

$("unlock").addEventListener("submit", (event) => {
  event.preventDefault();
  run();
});

if (await getToken()) window.close();

$("submit").disabled = true;
try {
  ({ registered } = await api("/auth/status"));
  $("submit").disabled = false;
  if (!registered) {
    $("title").textContent = "Set up LocksMate";
    $("subtitle").textContent = "Your fingerprint becomes the only key to your vault.";
    $("label").textContent = "Set up with Touch ID";
  } else {
    // one click from the popup is enough, go straight to Touch ID
    run();
  }
} catch (e) {
  $("error").textContent = `${e.message}. Start it with pnpm start, then reopen this window.`;
}
