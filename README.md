# LocksMate

A password manager for Chrome on a Mac that opens with your fingerprint. No master password, no account, no cloud service holding your keys.

Click into a login form and a small key shows up. It fills your saved login, or makes a strong new password and saves it for you.

## Why it's safe

**Your fingerprint is the only key.** When you unlock, Touch ID produces a secret inside your Mac's security chip, and that secret is what decrypts your vault. There's no master password to forget, phish, or leak. (If a Mac's Touch ID can't do this, LocksMate falls back to a key file only your user account can read, and tells you in `host.log`.)

**The database only holds scrambled data.** Every password is encrypted (AES-256) before it's stored. If someone stole the whole database, all they'd get is noise.

**Nothing listens on the network.** There's no server and no open port to find or attack. Chrome starts LocksMate's backend only when the extension needs it, talks to it through a private pipe, and shuts it down when Chrome quits.

**Only this extension can talk to it.** Chrome checks the extension's ID before starting the backend, and the backend checks it again. Other extensions, websites and apps get nothing.

**Websites can't peek.** The key button and the unlock dialog sit in an isolated layer the page can't read or click for you. A login is only filled when *you* click it, and only on the site it belongs to.

**It locks itself.** After 15 minutes of not using it, or when you quit Chrome.

## Install

You need a Mac with Touch ID, Chrome, and Node 24+ with pnpm (only to build it).

1. Put your database settings in `.env` and the database certificate in `ca.pem`:

   ```
   DATABASE_NAME=...
   DATABASE_PASSWORD=...
   DATABASE_HOST=...
   DATABASE_PORT=...
   DATABASE_USER=...
   ```

2. Build and install:

   ```sh
   pnpm install
   pnpm run setup
   ```

   This builds the backend into a single app and installs everything into `~/.locksmate`. After that, LocksMate doesn't need this project folder.

3. In Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `~/.locksmate/extension`.

4. Click the LocksMate icon, then **Set up with Touch ID**. That's it.

Run `pnpm run setup` again whenever you change the code.


Your vault is tied to this Mac's Touch ID. If the Mac is wiped or replaced, the vault can't be opened, so keep that in mind before you rely on it for everything.

## Where things live

| | |
|---|---|
| `ui/` | the Chrome extension |
| `src/` | the backend: Touch ID checks, encryption, database |
| `tools/install.mjs` | builds and installs the app |
| `~/.locksmate/` | the installed app, its settings and `host.log` |
