// Builds LocksMate into a standalone app and installs it into ~/.locksmate:
//   locksmate-host   the backend as one executable (Node bundled in, no project folder needed)
//   extension/       the Chrome extension to load once with "Load unpacked"
//   config.env       database settings (copied from .env), ca.pem the database certificate
// and registers the backend with Chrome so only the LocksMate extension can start it.
//
//   node tools/install.mjs [--chrome-dir=<Chrome user data dir>] [--home=<dir>]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const NODE_VERSION = "v24.21.0";
const HOST_NAME = "com.locksmate.vault";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const home = args.home ?? homedir();
const chromeDir = args["chrome-dir"] ?? join(home, "Library", "Application Support", "Google", "Chrome");
const out = join(root, "build");
const appDir = join(home, ".locksmate");
const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: ["ignore", "ignore", "inherit"] });

mkdirSync(out, { recursive: true });

// 1. the backend as a single JavaScript file
console.log("bundling backend…");
await build({
  entryPoints: [join(root, "index.ts")],
  outfile: join(out, "host.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["pg-native"],
  logLevel: "warning",
});

// 2. the official Node binary (Homebrew's links to Homebrew libraries, so it can't stand alone)
const arch = process.arch === "arm64" ? "arm64" : "x64";
const nodeDir = join(out, `node-${NODE_VERSION}-darwin-${arch}`);
const nodeBin = join(nodeDir, "bin", "node");
if (!existsSync(nodeBin)) {
  console.log(`downloading Node ${NODE_VERSION}…`);
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const tar = `node-${NODE_VERSION}-darwin-${arch}.tar.gz`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((l) => l.endsWith(`  ${tar}`))?.split(" ")[0];
  const data = Buffer.from(await (await fetch(`${base}/${tar}`)).arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (!expected || actual !== expected) throw new Error(`checksum mismatch for ${tar}`);
  writeFileSync(join(out, tar), data);
  run("tar", ["-xzf", join(out, tar), "-C", out]);
  rmSync(join(out, tar));
}

// 3. Node + bundle = one executable (Node's "single executable application")
console.log("building executable…");
const seaConfig = join(out, "sea-config.json");
writeFileSync(seaConfig, JSON.stringify({
  main: join(out, "host.cjs"),
  output: join(out, "sea.blob"),
  disableExperimentalSEAWarning: true,
}));
run(nodeBin, ["--experimental-sea-config", seaConfig]);
const exe = join(out, "locksmate-host");
copyFileSync(nodeBin, exe);
chmodSync(exe, 0o755);
run("codesign", ["--remove-signature", exe]);
run(process.execPath, [join(root, "node_modules", "postject", "dist", "cli.js"), exe, "NODE_SEA_BLOB", join(out, "sea.blob"),
  "--sentinel-fuse", SEA_FUSE, "--macho-segment-name", "NODE_SEA"]);
run("codesign", ["--sign", "-", exe]);

// 4. install into ~/.locksmate
console.log(`installing into ${appDir}…`);
mkdirSync(appDir, { recursive: true, mode: 0o700 });
chmodSync(appDir, 0o700);
const installedExe = join(appDir, "locksmate-host");
rmSync(installedExe, { force: true });
copyFileSync(exe, installedExe);
chmodSync(installedExe, 0o700);

for (const [from, to] of [[".env", "config.env"], ["ca.pem", "ca.pem"]]) {
  const source = join(root, from);
  const target = join(appDir, to);
  if (existsSync(source)) {
    copyFileSync(source, target);
    chmodSync(target, 0o600);
  } else if (!existsSync(target)) {
    throw new Error(`${from} is missing, it's needed once to install`);
  }
}

const extensionDir = join(appDir, "extension");
rmSync(extensionDir, { recursive: true, force: true });
cpSync(join(root, "ui"), extensionDir, { recursive: true });

// 5. tell Chrome about the backend, for the LocksMate extension only
const { key } = JSON.parse(readFileSync(join(root, "ui", "manifest.json"), "utf8"));
const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
const extensionId = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
const hostsDir = join(chromeDir, "NativeMessagingHosts");
mkdirSync(hostsDir, { recursive: true });
writeFileSync(join(hostsDir, `${HOST_NAME}.json`), JSON.stringify({
  name: HOST_NAME,
  description: "LocksMate vault backend",
  path: installedExe,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
}, null, 2));

console.log(`
LocksMate installed in ${appDir}
  backend:    ${installedExe}
  extension:  ${extensionDir}  (id ${extensionId})
  logs:       ${join(appDir, "host.log")}

First time only: chrome://extensions → Developer mode → Load unpacked → ${extensionDir}
The project folder isn't needed to run LocksMate anymore.`);
