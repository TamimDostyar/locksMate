// In-page LocksMate: a key button on login fields with a dropdown of this site's logins
// and a password generator. Lives in a closed shadow root so the page can't style or reach into it.
(() => {
  if (window.top !== window) return;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
    .wrap {
      --bg: #fff; --hover: #f1f1f4; --border: #e3e3e8; --text: #17171c; --muted: #6c6c78;
      --accent: #f5b400; --on-accent: #17171c;
      position: fixed; pointer-events: none;
    }
    @media (prefers-color-scheme: dark) {
      .wrap { --bg: #1d1d23; --hover: #2a2a33; --border: #34343f; --text: #f2f2f5; --muted: #9b9ba8; }
    }
    .key {
      position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
      width: 22px; height: 22px; border: none; border-radius: 6px; cursor: pointer;
      display: grid; place-items: center; pointer-events: auto;
      background: var(--accent); color: var(--on-accent);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
    }
    .panel {
      position: absolute; top: calc(100% + 6px); right: 0; width: 290px; pointer-events: auto;
      background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.18); overflow: hidden;
    }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid var(--border); font-weight: 650;
    }
    .mark { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: var(--accent); color: var(--on-accent); }
    .mark svg { width: 12px; height: 12px; }
    .site { margin-left: auto; color: var(--muted); font-weight: 400; font-size: 12px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ul { list-style: none; padding: 6px; max-height: 240px; overflow-y: auto; }
    li button {
      width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px; border: none;
      border-radius: 7px; background: none; color: var(--text); text-align: left; cursor: pointer;
    }
    li button:hover, li button:focus-visible { background: var(--hover); outline: none; }
    .avatar {
      flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px;
      background: var(--hover); color: var(--muted); font-weight: 600; text-transform: uppercase;
    }
    .gen .avatar { background: var(--accent); color: var(--on-accent); }
    .text { min-width: 0; }
    .text b, .text small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .text b { font-weight: 550; }
    .text small { color: var(--muted); font-size: 12px; }
    .sep { height: 1px; background: var(--border); margin: 4px 6px; }
    .msg { padding: 14px 12px; color: var(--muted); }
  `;
  const KEY_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8M16 7l3 3M18 5l2 2"/></svg>';
  const LOCK_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const host = document.createElement("locksmate-ui");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${CSS}</style>
    <div class="wrap" hidden>
      <button class="key" title="LocksMate">${KEY_ICON}</button>
      <div class="panel" hidden></div>
    </div>`;
  const wrap = root.querySelector(".wrap");
  const keyButton = root.querySelector(".key");
  const panel = root.querySelector(".panel");
  document.documentElement.append(host);

  let field = null;

  // ---------- finding login fields ----------

  const visible = (el) => el.offsetParent !== null && !el.disabled && !el.readOnly;
  const passwordsIn = (scope) => [...scope.querySelectorAll('input[type="password"]')].filter(visible);

  // the form, or the nearest container that holds a password field (many sites have no <form>)
  function scopeOf(input) {
    if (input.form) return input.form;
    for (let el = input.parentElement; el; el = el.parentElement) {
      if (passwordsIn(el).length) return el;
    }
    return document;
  }

  function emailFieldIn(scope) {
    const inputs = [...scope.querySelectorAll("input")].filter(
      (i) => visible(i) && ["email", "text", "tel", ""].includes(i.type),
    );
    return (
      inputs.find((i) => i.type === "email" || /email|username/i.test(i.autocomplete)) ??
      inputs.find((i) => /mail|user|login|account|identifier/i.test(`${i.name} ${i.id} ${i.placeholder}`)) ??
      inputs[0]
    );
  }

  function isLoginField(el) {
    if (!(el instanceof HTMLInputElement) || !visible(el)) return false;
    if (el.type === "password") return true;
    const scope = scopeOf(el);
    return scope !== document && emailFieldIn(scope) === el;
  }

  // works with React/Vue controlled inputs too
  function setValue(input, value) {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillForm(anchor, email, password) {
    const scope = scopeOf(anchor);
    const passwords = passwordsIn(scope);
    if (!passwords.length) return false;
    const emailInput = emailFieldIn(scope);
    if (emailInput && email) setValue(emailInput, email);
    // sign up forms have a confirm field, fill every password box
    for (const input of passwords) setValue(input, password);
    return true;
  }

  // ---------- button + dropdown ----------

  function place() {
    if (!field) return;
    const box = field.getBoundingClientRect();
    Object.assign(wrap.style, {
      top: `${box.top}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  }

  function attach(input) {
    field = input;
    place();
    wrap.hidden = false;
  }

  function hide() {
    wrap.hidden = true;
    panel.hidden = true;
    field = null;
  }

  const send = (message) =>
    chrome.runtime.sendMessage(message).catch(() => ({ error: "LocksMate was updated, reload the page" }));

  function item({ label, sub, avatar, cls = "", onClick }) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = cls;
    const av = document.createElement("span");
    av.className = "avatar";
    if (avatar.startsWith("<svg")) av.innerHTML = avatar;
    else av.textContent = avatar;
    const text = document.createElement("span");
    text.className = "text";
    const strong = document.createElement("b");
    strong.textContent = label;
    text.append(strong);
    if (sub) {
      const small = document.createElement("small");
      small.textContent = sub;
      text.append(small);
    }
    b.append(av, text);
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the page field
    b.addEventListener("click", (e) => e.isTrusted && onClick());
    li.append(b);
    return li;
  }

  function renderPanel(children) {
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span class="mark">${LOCK_ICON}</span>LocksMate`;
    const site = document.createElement("span");
    site.className = "site";
    site.textContent = location.hostname.replace(/^www\./, "");
    head.append(site);
    panel.replaceChildren(head, ...children);
  }

  function message(text) {
    const p = document.createElement("p");
    p.className = "msg";
    p.textContent = text;
    return p;
  }

  async function openPanel() {
    const anchor = field;
    panel.hidden = false;
    renderPanel([message("Loading…")]);
    const res = await send({ type: "logins" });
    if (field !== anchor) return;

    if (res.locked) {
      const list = document.createElement("ul");
      list.append(
        item({
          label: "Unlock LocksMate",
          sub: "With Touch ID",
          avatar: LOCK_ICON,
          cls: "gen",
          onClick: () => {
            send({ type: "unlock" });
            hide();
          },
        }),
      );
      return renderPanel([list]);
    }
    if (res.error) return renderPanel([message(res.error)]);

    const list = document.createElement("ul");
    for (const login of res.logins) {
      list.append(
        item({
          label: login.email || "(no username)",
          sub: "Fill this login",
          avatar: (login.email || "?")[0],
          onClick: async () => {
            const creds = await send({ type: "fill", id: login.id });
            if (creds.password) fillForm(anchor, creds.email, creds.password);
            hide();
          },
        }),
      );
    }
    if (res.logins.length) {
      const sep = document.createElement("li");
      sep.className = "sep";
      list.append(sep);
    }
    list.append(
      item({
        label: "Generate strong password",
        sub: res.logins.length ? "New account or password change" : "Fills and saves it to your vault",
        avatar: KEY_ICON,
        cls: "gen",
        onClick: async () => {
          const creds = await send({ type: "generate" });
          if (creds.password) fillForm(anchor, creds.email, creds.password);
          hide();
        },
      }),
    );
    renderPanel([list]);
  }

  keyButton.addEventListener("mousedown", (e) => e.preventDefault());
  keyButton.addEventListener("click", (e) => {
    if (!e.isTrusted) return; // the page's own scripts can't open it
    if (panel.hidden) openPanel();
    else panel.hidden = true;
  });

  document.addEventListener("focusin", (e) => {
    if (e.composedPath()[0] === host || e.target === host) return;
    if (isLoginField(e.target)) attach(e.target);
    else hide();
  });

  document.addEventListener("mousedown", (e) => {
    if (!e.composedPath().includes(host) && e.target !== field) hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") panel.hidden = true;
  });

  addEventListener("scroll", place, { capture: true, passive: true });
  addEventListener("resize", place, { passive: true });

  // ---------- filling from the toolbar popup ----------

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message.type !== "fillCredentials") return;
    const here = location.hostname.replace(/^www\./, "");
    if (here !== message.site && !here.endsWith(`.${message.site}`)) return reply(false);
    const target = field ?? passwordsIn(document)[0];
    reply(Boolean(target) && fillForm(target, message.email, message.password));
  });

  // ---------- saving what gets submitted ----------

  // a submit button fires both click and submit, only send once
  let lastSaved = "";
  function capture(scope) {
    const password = passwordsIn(scope).find((i) => i.value);
    if (!password) return;
    const email = emailFieldIn(scopeOf(password))?.value ?? "";
    const key = `${email}\n${password.value}`;
    if (key === lastSaved) return;
    lastSaved = key;
    setTimeout(() => (lastSaved = ""), 3000);
    send({ type: "save", email, password: password.value });
  }

  document.addEventListener("submit", (e) => e.isTrusted && capture(e.target), true);
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const submit = e.target.closest('button, input[type="submit"]');
      if (!submit || submit.type !== "submit") return;
      capture(submit.form ?? scopeOf(submit));
    },
    true,
  );
})();
