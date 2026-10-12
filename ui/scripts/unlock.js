import { api, getToken, setToken } from "./api.js";
import { icons } from "./icons.js";

const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icons[el.dataset.icon];

if (await getToken()) window.close();

// don't guess: if the server can't be reached we don't know whether to set up or unlock
let registered;
$("submit").disabled = true;
try {
  ({ registered } = await api("/auth/status"));
  $("submit").disabled = false;
  if (!registered) {
    $("code").hidden = false;
    $("code").required = true;
    $("title").textContent = "Set up LocksMate";
    $("subtitle").textContent = "Enter the setup code shown in your terminal and choose a master password.";
    $("label").textContent = "Set up with Touch ID";
    $("code").focus();
  }
} catch (e) {
  $("error").textContent = `${e.message}. Start it with pnpm start, then reopen this window.`;
}

async function setup(password) {
  const code = $("code").value.trim();
  const options = await api("/auth/setup/options", { method: "POST", body: { code } });
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  return api("/auth/setup/verify", {
    method: "POST",
    body: { code, password, credential: credential.toJSON() },
  });
}

async function login(password) {
  const options = await api("/auth/login/options", { method: "POST" });
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  return api("/auth/login", { method: "POST", body: { password, credential: credential.toJSON() } });
}

$("unlock").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").textContent = "";
  $("submit").disabled = true;
  try {
    const { token } = await (registered ? login($("password").value) : setup($("password").value));
    await setToken(token);
    window.close();
  } catch (e) {
    $("error").textContent = e.name === "NotAllowedError" ? "Touch ID was cancelled" : e.message;
    $("password").select();
  } finally {
    $("submit").disabled = false;
  }
});
