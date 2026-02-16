#!/usr/bin/env node
import { hostname, homedir, networkInterfaces } from "os";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, openSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, execFileSync, type ChildProcess } from "child_process";
import http from "http";
import https from "https";
import WebSocket from "ws";
import qrcode from "qrcode-terminal";
import * as p from "@clack/prompts";

// --- Config (env vars with config-file fallback) ---

function ensureConfigFile(): string {
  const tsDir = join(homedir(), ".terminalsync");
  const configPath = join(tsDir, "config");
  if (!existsSync(configPath)) {
    mkdirSync(tsDir, { recursive: true });
    const genToken = randomBytes(32).toString("hex");
    writeFileSync(
      configPath,
      `TERMINALSYNC_TOKEN=${genToken}\nTERMINALSYNC_HOST=0.0.0.0\nTERMINALSYNC_PORT=8089\n`
    );
  }
  return configPath;
}

function loadConfigFile(): Record<string, string> {
  const configPath = ensureConfigFile();
  const contents = readFileSync(configPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

function setConfigValue(key: string, value: string): void {
  const configPath = ensureConfigFile();
  const contents = readFileSync(configPath, "utf-8");
  const lines = contents.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(key + "=")) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    // Append before trailing empty line if present
    if (updated.length > 0 && updated[updated.length - 1] === "") {
      updated.splice(updated.length - 1, 0, `${key}=${value}`);
    } else {
      updated.push(`${key}=${value}`);
    }
  }
  writeFileSync(configPath, updated.join("\n"));
}

const fileConfig = loadConfigFile();
const host = process.env.TERMINALSYNC_HOST ?? fileConfig.TERMINALSYNC_HOST ?? "0.0.0.0";
const port = process.env.TERMINALSYNC_PORT ?? fileConfig.TERMINALSYNC_PORT ?? "8089";
const token = process.env.TERMINALSYNC_TOKEN ?? fileConfig.TERMINALSYNC_TOKEN;
const tunnelEnabled = (process.env.TERMINALSYNC_TUNNEL ?? fileConfig.TERMINALSYNC_TUNNEL ?? "true") === "true";
// Dead feature flag — when enabled, cmdConnect() would use buildDeepLink() for native app URLs
const _appDeeplinkEnabled = (process.env.TERMINALSYNC_APP_DEEPLINK ?? fileConfig.TERMINALSYNC_APP_DEEPLINK ?? "false") === "true";

function wsUrl(): string {
  return `ws://${host}:${port}`;
}

// --- Helpers ---

let seq = 0;
function send(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify({ ...msg, seq: ++seq }));
}

function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function openWs(): WebSocket {
  if (!token) die("TERMINALSYNC_TOKEN is required");
  const ws = new WebSocket(wsUrl(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ws;
}

// --- Auto-start server ---

interface HealthResponse {
  status: string;
  clients: number;
  tunnelUrl?: string;
}

function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function fetchHealth(): Promise<HealthResponse | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/health`, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warn(msg: string): void {
  process.stderr.write(`\x1b[33m[terminalsync] ${msg}\x1b[0m\n`);
}

function fallbackShell(): never {
  const shell = process.env.SHELL || "/bin/sh";
  warn(`Falling back to ${shell}`);
  try {
    execFileSync(shell, { stdio: "inherit" });
  } catch {
    // shell exited
  }
  process.exit(0);
}

async function ensureServer(): Promise<boolean> {
  if (await checkHealth()) return true;

  // Server not running — spawn it
  const cliDir = dirname(fileURLToPath(import.meta.url));   // dist/cli/
  const distDir = dirname(cliDir);                           // dist/
  const serverEntry = join(distDir, "index.js");
  const tsDir = join(homedir(), ".terminalsync");
  const logPath = join(tsDir, "server.log");

  if (!existsSync(serverEntry)) {
    warn(`Server entry not found: ${serverEntry}`);
    return false;
  }

  let logFd: number;
  try {
    logFd = openSync(logPath, "a");
  } catch {
    warn(`Cannot open log file: ${logPath}`);
    return false;
  }

  try {
    const child = spawn("node", [serverEntry], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        TERMINALSYNC_TOKEN: token,
        TERMINALSYNC_HOST: host,
        TERMINALSYNC_PORT: port,
        TERMINALSYNC_TUNNEL: tunnelEnabled ? "true" : "false",
      },
    });
    child.unref();
  } catch {
    warn("Failed to spawn server process");
    return false;
  }

  // Poll for readiness
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (await checkHealth()) return true;
  }

  warn("Server failed to start within 4s. Check ~/.terminalsync/server.log");
  return false;
}

// --- Subcommands ---

async function cmdList(): Promise<void> {
  if (!(await ensureServer())) die("Cannot reach server");
  const ws = openWs();

  ws.on("open", () => {
    send(ws, { type: "list_sessions", payload: {} });
  });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "session_list") {
      const sessions = msg.payload.sessions as Array<{
        id: string;
        name: string;
        status: string;
        attachedClients: number;
        source: string;
      }>;
      if (sessions.length === 0) {
        console.log("No sessions.");
      } else {
        for (const s of sessions) {
          console.log(
            `${s.id}  ${s.name}  ${s.status}  clients=${s.attachedClients}  source=${s.source}`
          );
        }
      }
      ws.close();
    } else if (msg.type === "error") {
      die(`Error: ${msg.payload.message}`);
    }
  });

  ws.on("error", (err) => die(`WebSocket error: ${err.message}`));

  await new Promise<void>((resolve) => ws.on("close", resolve));
}

async function cmdAttach(targetId: string): Promise<void> {
  if (!(await ensureServer())) die("Cannot reach server");
  const ws = openWs();
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const pendingOutput: Buffer[] = [];
  let attached = false;

  ws.on("open", () => {
    send(ws, { type: "attach", payload: { target: targetId, cols, rows } });
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      if (!attached) {
        pendingOutput.push(raw as Buffer);
      } else {
        process.stdout.write(raw as Buffer);
      }
      return;
    }
    const msg = JSON.parse(raw.toString());
    if (msg.type === "attached") {
      attached = true;
      enterRawProxy(ws);
      for (const buf of pendingOutput) process.stdout.write(buf);
      pendingOutput.length = 0;
    } else if (msg.type === "resized") {
      // PTY was resized by a smaller client — the shell already got SIGWINCH
      // so output will be formatted for the new size. No local action needed.
    } else if (msg.type === "detached") {
      cleanup();
      process.exit(0);
    } else if (msg.type === "error") {
      die(`Error: ${msg.payload.message}`);
    }
  });

  ws.on("error", (err) => die(`WebSocket error: ${err.message}`));
  ws.on("close", () => {
    cleanup();
    process.exit(0);
  });
}

async function cmdShare(): Promise<void> {
  if (process.env.TERMINALSYNC_SESSION) return;
  checkForUpdate();
  if (!(await ensureServer())) fallbackShell();
  const ws = openWs();
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const name = hostname();
  const pendingOutput: Buffer[] = [];
  let attached = false;

  let sessionId: string | null = null;

  ws.on("open", () => {
    send(ws, { type: "create_session", payload: { name, cols, rows } });
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      if (!attached) {
        pendingOutput.push(raw as Buffer);
      } else {
        process.stdout.write(raw as Buffer);
      }
      return;
    }
    const msg = JSON.parse(raw.toString());

    if (msg.type === "session_created") {
      sessionId = msg.payload.id;
      send(ws, { type: "attach", payload: { target: sessionId, cols, rows } });
    } else if (msg.type === "attached") {
      attached = true;
      enterRawProxy(ws);
      for (const buf of pendingOutput) process.stdout.write(buf);
      pendingOutput.length = 0;
    } else if (msg.type === "resized") {
      // PTY was resized by a smaller client — the shell already got SIGWINCH
      // so output will be formatted for the new size. No local action needed.
    } else if (msg.type === "detached") {
      cleanup();
      process.exit(0);
    } else if (msg.type === "error") {
      die(`Error: ${msg.payload.message}`);
    }
  });

  ws.on("error", (err) => die(`WebSocket error: ${err.message}`));
  ws.on("close", () => {
    cleanup();
    process.exit(0);
  });
}

// --- Raw-mode proxy ---

let rawMode = false;
function sendResize(ws: WebSocket): void {
  send(ws, {
    type: "resize",
    payload: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
    },
  });
}

function enterRawProxy(ws: WebSocket): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    rawMode = true;
  }
  process.stdin.resume();

  // Sync terminal size now — it may differ from what create_session used
  // (e.g. terminal emulator finished resizing, or another client resized the PTY)
  sendResize(ws);

  process.stdin.on("data", (chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, { type: "input", payload: { data: chunk.toString() } });
    }
  });

  process.stdout.on("resize", () => {
    if (ws.readyState === WebSocket.OPEN) {
      sendResize(ws);
    }
  });

  const onSignal = () => {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, { type: "detach", payload: {} });
    }
    cleanup();
    process.exit(0);
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
}

function cleanup(): void {
  if (rawMode && process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    rawMode = false;
  }
  process.stdin.pause();
}

// --- Config command ---

async function cmdConfig(): Promise<void> {
  p.intro("terminalsync config");

  const currentConfig = loadConfigFile();
  const currentTunnel = (currentConfig.TERMINALSYNC_TUNNEL ?? "false") === "true";
  const currentPort = currentConfig.TERMINALSYNC_PORT ?? "8089";

  const enableTunnel = await p.confirm({
    message: "Enable tunnel? (share outside local network)",
    initialValue: currentTunnel,
  });
  if (p.isCancel(enableTunnel)) {
    p.cancel("Config cancelled.");
    process.exit(0);
  }

  const newPort = await p.text({
    message: "Server port",
    initialValue: currentPort,
  });
  if (p.isCancel(newPort)) {
    p.cancel("Config cancelled.");
    process.exit(0);
  }

  setConfigValue("TERMINALSYNC_TUNNEL", enableTunnel ? "true" : "false");
  setConfigValue("TERMINALSYNC_PORT", newPort);

  p.outro("Config saved!");
}

// --- QR code connect command ---

function getLanIp(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return host; // fall back to configured host
}

function buildDeepLink(opts: { sessionId?: string; tunnelUrl?: string; lanHost?: string }): string {
  const sessionPath = opts.sessionId ? `/terminal/${opts.sessionId}` : "";
  const params = new URLSearchParams();
  if (opts.tunnelUrl) {
    params.set("url", opts.tunnelUrl);
  } else if (opts.lanHost) {
    params.set("host", opts.lanHost);
    params.set("port", port);
  }
  params.set("token", token!);
  return `terminalsync:/${sessionPath}?${params.toString()}`;
}

function buildWebUrl(opts: { sessionId?: string; tunnelUrl?: string; lanHost?: string }): string {
  const hash = opts.sessionId ? `${token}/${opts.sessionId}` : token!;
  if (opts.tunnelUrl) {
    return `${opts.tunnelUrl}/#${hash}`;
  }
  return `http://${opts.lanHost}:${port}/#${hash}`;
}

function printQr(url: string, exitAfter: boolean): void {
  process.stderr.write(`${url}\n`);
  qrcode.generate(url, { small: true }, (code: string) => {
    process.stderr.write(code + "\n");
    if (exitAfter) process.exit(0);
  });
}

function checkSessions(): Promise<number> {
  return new Promise((resolve) => {
    if (!token) { resolve(0); return; }
    const ws = new WebSocket(wsUrl(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const timeout = setTimeout(() => { ws.close(); resolve(0); }, 3000);
    ws.on("open", () => {
      send(ws, { type: "list_sessions", payload: {} });
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "session_list") {
        clearTimeout(timeout);
        ws.close();
        resolve((msg.payload.sessions as unknown[]).length);
      }
    });
    ws.on("error", () => { clearTimeout(timeout); resolve(0); });
  });
}

async function cmdConnect(): Promise<void> {
  await checkForUpdate();
  if (!(await ensureServer())) die("Cannot reach server");

  const sessionCount = await checkSessions();
  if (sessionCount === 0) {
    die("No shared sessions. Run 'terminalsync share' in a terminal first.");
  }

  const sessionId = process.env.TERMINALSYNC_SESSION;
  const health = await fetchHealth();

  if (health?.tunnelUrl) {
    const url = buildWebUrl({ sessionId, tunnelUrl: health.tunnelUrl });
    printQr(url, true);
  } else {
    const url = buildWebUrl({ sessionId, lanHost: getLanIp() });
    printQr(url, true);
  }
}

// --- Kill command ---

async function cmdKill(): Promise<void> {
  const { execSync } = await import("child_process");
  const myPid = process.pid;
  let killed = 0;

  const tryKill = (p: number, label: string) => {
    if (p === myPid) return;
    try {
      process.kill(p, "SIGTERM");
      console.log(`Killed ${label} (PID ${p})`);
      killed++;
    } catch {
      // already dead
    }
  };

  // 1. Kill the server by finding what's listening on our port
  try {
    const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, { encoding: "utf-8" }).trim();
    for (const line of out.split("\n")) {
      const p = parseInt(line, 10);
      if (p) tryKill(p, "server");
    }
  } catch {
    // nothing listening
  }

  // 2. Kill client processes (share/attach) by exact command patterns
  try {
    const out = execSync("ps ax -o pid,command", { encoding: "utf-8" });
    for (const line of out.split("\n")) {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match) continue;
      const p = parseInt(match[1], 10);
      const cmd = match[2];
      if (
        cmd.includes("connect.js share") ||
        cmd.includes("connect.js attach")
      ) {
        tryKill(p, cmd.includes("share") ? "share client" : "attach client");
      }
    }
  } catch {
    // ps failed
  }

  if (killed === 0) {
    console.log("No terminalsync processes found.");
  } else {
    console.log(`Done — killed ${killed} process(es).`);
  }
}

// --- Uninstall command ---

async function cmdUninstall(): Promise<void> {
  const { execSync } = await import("child_process");
  const installDir = join(homedir(), ".terminalsync");

  // Kill running processes first
  await cmdKill();

  // Remove PATH entries from shell rc files
  const rcFiles = [join(homedir(), ".zshrc"), join(homedir(), ".bashrc")];
  for (const rc of rcFiles) {
    if (!existsSync(rc)) continue;
    const contents = readFileSync(rc, "utf-8");
    const filtered = contents
      .split("\n")
      .filter((line) => !line.includes(".terminalsync/bin"))
      .join("\n");
    if (filtered !== contents) {
      writeFileSync(rc, filtered);
      console.log(`Removed PATH entry from ${rc}`);
    }
  }

  // Remove npm global link if present
  try {
    const globalBin = execSync("npm bin -g", { encoding: "utf-8" }).trim();
    const globalLink = join(globalBin, "terminalsync");
    if (existsSync(globalLink)) {
      execSync("npm uninstall -g terminalsync", { stdio: "inherit" });
      console.log("Removed global npm link");
    }
  } catch {
    // npm global check failed, skip
  }

  // Remove install directory
  if (existsSync(installDir)) {
    try {
      execSync(`rm -rf ${JSON.stringify(installDir)}`, { stdio: "inherit" });
      console.log(`Removed ${installDir}`);
    } catch {
      console.error(`Failed to remove ${installDir} — remove it manually.`);
    }
  }

  console.log("\nTerminalSync uninstalled. Open a new terminal for PATH changes to take effect.");
}

// --- Update check ---

async function checkForUpdate(): Promise<void> {
  try {
    const repoDir = join(homedir(), ".terminalsync", "repo");
    if (!existsSync(join(repoDir, ".git"))) return;

    const localPkgPath = join(repoDir, "cli", "package.json");
    if (!existsSync(localPkgPath)) return;
    const localVersion = JSON.parse(readFileSync(localPkgPath, "utf-8")).version;

    // Fetch latest version from GitHub (non-blocking, with timeout)
    const remoteVersion = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 3000);
      const req = https.get(
        "https://raw.githubusercontent.com/aleqsio/terminalsync/main/cli/package.json",
        (res) => {
          let body = "";
          res.on("data", (chunk: string) => { body += chunk; });
          res.on("end", () => {
            clearTimeout(timeout);
            try { resolve(JSON.parse(body).version); } catch { resolve(null); }
          });
        },
      );
      req.on("error", () => { clearTimeout(timeout); resolve(null); });
    });

    if (!remoteVersion || remoteVersion === localVersion) return;

    // Compare semver: remote > local?
    const parse = (v: string) => v.split(".").map(Number);
    const [lM, lm, lp] = parse(localVersion);
    const [rM, rm, rp] = parse(remoteVersion);
    const isNewer = rM > lM || (rM === lM && rm > lm) || (rM === lM && rm === lm && rp > lp);

    if (isNewer) {
      process.stderr.write(
        `\x1b[33m[terminalsync] Update available: ${localVersion} → ${remoteVersion}\x1b[0m\n` +
        `\x1b[33m[terminalsync] Run: terminalsync update\x1b[0m\n`,
      );
    }
  } catch {
    // Silently ignore update check failures
  }
}

// --- Update command ---

async function cmdUpdate(): Promise<void> {
  const { execSync } = await import("child_process");
  const repoDir = join(homedir(), ".terminalsync", "repo");

  if (!existsSync(join(repoDir, ".git"))) {
    die("Not installed via git. Run the install script instead:\n  curl -fsSL https://aleqsio.com/terminalsync/install.sh | bash");
  }

  console.log("Updating TerminalSync...");
  try {
    execSync("git pull --ff-only", { cwd: repoDir, stdio: "inherit" });
    execSync("npm install --omit=dev", { cwd: join(repoDir, "cli"), stdio: "inherit" });
    console.log("\nUpdated successfully!");
  } catch {
    die("Update failed. Try running the install script manually:\n  curl -fsSL https://aleqsio.com/terminalsync/install.sh | bash");
  }
}

// --- Main ---

function printHelp(): void {
  const text = `terminalsync — share your terminal with any device

Usage: terminalsync <command>

Commands:
  share            Share current terminal on a secure tunnel URL
  connect          Show QR code to connect from any device
  config           Configure tunnel and port
  list             List active sessions
  attach <id>      Attach to an existing session
  kill             Kill all shared terminals and stop the server
  update           Update to the latest version
  uninstall        Remove TerminalSync from this machine
  help             Show this help message

Run 'terminalsync config' to enable tunnel mode for sharing outside your local network.`;
  console.log(text);
}

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case "list":
    cmdList();
    break;
  case "attach":
    if (!args[1]) die("Usage: terminalsync attach <session-id>");
    cmdAttach(args[1]);
    break;
  case "connect":
    cmdConnect();
    break;
  case "config":
    cmdConfig();
    break;
  case "share":
    cmdShare();
    break;
  case "kill":
    cmdKill();
    break;
  case "update":
    cmdUpdate();
    break;
  case "uninstall":
    cmdUninstall();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;
  default:
    die(`Unknown command: ${cmd}\nRun 'terminalsync help' for usage.`);
}
