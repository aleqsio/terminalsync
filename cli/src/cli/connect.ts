#!/usr/bin/env node
import { hostname, homedir, networkInterfaces } from "os";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, openSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, execFileSync } from "child_process";
import http from "http";
import WebSocket from "ws";
import qrcode from "qrcode-terminal";

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

const fileConfig = loadConfigFile();
const host = process.env.TERMINALSYNC_HOST ?? fileConfig.TERMINALSYNC_HOST ?? "0.0.0.0";
const port = process.env.TERMINALSYNC_PORT ?? fileConfig.TERMINALSYNC_PORT ?? "8089";
const token = process.env.TERMINALSYNC_TOKEN ?? fileConfig.TERMINALSYNC_TOKEN;

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
  if (!(await ensureServer())) fallbackShell();
  const ws = openWs();
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const name = `${hostname()}-${randomBytes(3).toString("hex")}`;
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

async function cmdConnect(): Promise<void> {
  if (!(await ensureServer())) die("Cannot reach server");

  const lanHost = getLanIp();
  const sessionId = process.env.TERMINALSYNC_SESSION;
  let url: string;
  if (sessionId) {
    url = `terminalsync://terminal/${sessionId}?host=${encodeURIComponent(lanHost)}&port=${encodeURIComponent(port)}&token=${encodeURIComponent(token!)}`;
  } else {
    url = `terminalsync://?host=${encodeURIComponent(lanHost)}&port=${encodeURIComponent(port)}&token=${encodeURIComponent(token!)}`;
  }

  process.stderr.write(`${url}\n`);
  qrcode.generate(url, { small: true }, (code: string) => {
    process.stderr.write(code + "\n");
    process.exit(0);
  });
}

// --- Main ---

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
  case "share":
  case undefined:
    cmdShare();
    break;
  default:
    die(`Unknown command: ${cmd}\nUsage: terminalsync [share|connect|list|attach <id>]`);
}
