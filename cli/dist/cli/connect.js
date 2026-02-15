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
import * as p from "@clack/prompts";
import { tunnel as cloudflaredTunnel } from "cloudflared";
// --- Config (env vars with config-file fallback) ---
function ensureConfigFile() {
    const tsDir = join(homedir(), ".terminalsync");
    const configPath = join(tsDir, "config");
    if (!existsSync(configPath)) {
        mkdirSync(tsDir, { recursive: true });
        const genToken = randomBytes(32).toString("hex");
        writeFileSync(configPath, `TERMINALSYNC_TOKEN=${genToken}\nTERMINALSYNC_HOST=0.0.0.0\nTERMINALSYNC_PORT=8089\n`);
    }
    return configPath;
}
function loadConfigFile() {
    const configPath = ensureConfigFile();
    const contents = readFileSync(configPath, "utf-8");
    const vars = {};
    for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1)
            continue;
        vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return vars;
}
function setConfigValue(key, value) {
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
        }
        else {
            updated.push(`${key}=${value}`);
        }
    }
    writeFileSync(configPath, updated.join("\n"));
}
const fileConfig = loadConfigFile();
const host = process.env.TERMINALSYNC_HOST ?? fileConfig.TERMINALSYNC_HOST ?? "0.0.0.0";
const port = process.env.TERMINALSYNC_PORT ?? fileConfig.TERMINALSYNC_PORT ?? "8089";
const token = process.env.TERMINALSYNC_TOKEN ?? fileConfig.TERMINALSYNC_TOKEN;
const tunnelEnabled = (process.env.TERMINALSYNC_TUNNEL ?? fileConfig.TERMINALSYNC_TUNNEL ?? "false") === "true";
// Dead feature flag — when enabled, cmdConnect() would use buildDeepLink() for native app URLs
const _appDeeplinkEnabled = (process.env.TERMINALSYNC_APP_DEEPLINK ?? fileConfig.TERMINALSYNC_APP_DEEPLINK ?? "false") === "true";
function wsUrl() {
    return `ws://${host}:${port}`;
}
// --- Helpers ---
let seq = 0;
function send(ws, msg) {
    ws.send(JSON.stringify({ ...msg, seq: ++seq }));
}
function die(msg) {
    process.stderr.write(msg + "\n");
    process.exit(1);
}
function openWs() {
    if (!token)
        die("TERMINALSYNC_TOKEN is required");
    const ws = new WebSocket(wsUrl(), {
        headers: { Authorization: `Bearer ${token}` },
    });
    return ws;
}
// --- Auto-start server ---
function checkHealth() {
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function warn(msg) {
    process.stderr.write(`\x1b[33m[terminalsync] ${msg}\x1b[0m\n`);
}
function fallbackShell() {
    const shell = process.env.SHELL || "/bin/sh";
    warn(`Falling back to ${shell}`);
    try {
        execFileSync(shell, { stdio: "inherit" });
    }
    catch {
        // shell exited
    }
    process.exit(0);
}
async function ensureServer() {
    if (await checkHealth())
        return true;
    // Server not running — spawn it
    const cliDir = dirname(fileURLToPath(import.meta.url)); // dist/cli/
    const distDir = dirname(cliDir); // dist/
    const serverEntry = join(distDir, "index.js");
    const tsDir = join(homedir(), ".terminalsync");
    const logPath = join(tsDir, "server.log");
    if (!existsSync(serverEntry)) {
        warn(`Server entry not found: ${serverEntry}`);
        return false;
    }
    let logFd;
    try {
        logFd = openSync(logPath, "a");
    }
    catch {
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
    }
    catch {
        warn("Failed to spawn server process");
        return false;
    }
    // Poll for readiness
    for (let i = 0; i < 20; i++) {
        await sleep(200);
        if (await checkHealth())
            return true;
    }
    warn("Server failed to start within 4s. Check ~/.terminalsync/server.log");
    return false;
}
// --- Subcommands ---
async function cmdList() {
    if (!(await ensureServer()))
        die("Cannot reach server");
    const ws = openWs();
    ws.on("open", () => {
        send(ws, { type: "list_sessions", payload: {} });
    });
    ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "session_list") {
            const sessions = msg.payload.sessions;
            if (sessions.length === 0) {
                console.log("No sessions.");
            }
            else {
                for (const s of sessions) {
                    console.log(`${s.id}  ${s.name}  ${s.status}  clients=${s.attachedClients}  source=${s.source}`);
                }
            }
            ws.close();
        }
        else if (msg.type === "error") {
            die(`Error: ${msg.payload.message}`);
        }
    });
    ws.on("error", (err) => die(`WebSocket error: ${err.message}`));
    await new Promise((resolve) => ws.on("close", resolve));
}
async function cmdAttach(targetId) {
    if (!(await ensureServer()))
        die("Cannot reach server");
    const ws = openWs();
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const pendingOutput = [];
    let attached = false;
    ws.on("open", () => {
        send(ws, { type: "attach", payload: { target: targetId, cols, rows } });
    });
    ws.on("message", (raw, isBinary) => {
        if (isBinary) {
            if (!attached) {
                pendingOutput.push(raw);
            }
            else {
                process.stdout.write(raw);
            }
            return;
        }
        const msg = JSON.parse(raw.toString());
        if (msg.type === "attached") {
            attached = true;
            enterRawProxy(ws);
            for (const buf of pendingOutput)
                process.stdout.write(buf);
            pendingOutput.length = 0;
        }
        else if (msg.type === "detached") {
            cleanup();
            process.exit(0);
        }
        else if (msg.type === "error") {
            die(`Error: ${msg.payload.message}`);
        }
    });
    ws.on("error", (err) => die(`WebSocket error: ${err.message}`));
    ws.on("close", () => {
        cleanup();
        process.exit(0);
    });
}
async function cmdShare() {
    if (process.env.TERMINALSYNC_SESSION)
        return;
    if (!(await ensureServer()))
        fallbackShell();
    const ws = openWs();
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const name = `${hostname()}-${randomBytes(3).toString("hex")}`;
    const pendingOutput = [];
    let attached = false;
    let sessionId = null;
    ws.on("open", () => {
        send(ws, { type: "create_session", payload: { name, cols, rows } });
    });
    ws.on("message", (raw, isBinary) => {
        if (isBinary) {
            if (!attached) {
                pendingOutput.push(raw);
            }
            else {
                process.stdout.write(raw);
            }
            return;
        }
        const msg = JSON.parse(raw.toString());
        if (msg.type === "session_created") {
            sessionId = msg.payload.id;
            send(ws, { type: "attach", payload: { target: sessionId, cols, rows } });
        }
        else if (msg.type === "attached") {
            attached = true;
            enterRawProxy(ws);
            for (const buf of pendingOutput)
                process.stdout.write(buf);
            pendingOutput.length = 0;
        }
        else if (msg.type === "detached") {
            cleanup();
            process.exit(0);
        }
        else if (msg.type === "error") {
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
function sendResize(ws) {
    send(ws, {
        type: "resize",
        payload: {
            cols: process.stdout.columns || 80,
            rows: process.stdout.rows || 24,
        },
    });
}
function enterRawProxy(ws) {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        rawMode = true;
    }
    process.stdin.resume();
    // Sync terminal size now — it may differ from what create_session used
    // (e.g. terminal emulator finished resizing, or another client resized the PTY)
    sendResize(ws);
    process.stdin.on("data", (chunk) => {
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
function cleanup() {
    if (rawMode && process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        rawMode = false;
    }
    process.stdin.pause();
}
// --- Config command ---
async function cmdConfig() {
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
function getLanIp() {
    for (const ifaces of Object.values(networkInterfaces())) {
        if (!ifaces)
            continue;
        for (const iface of ifaces) {
            if (iface.family === "IPv4" && !iface.internal)
                return iface.address;
        }
    }
    return host; // fall back to configured host
}
function buildDeepLink(opts) {
    const sessionPath = opts.sessionId ? `/terminal/${opts.sessionId}` : "";
    const params = new URLSearchParams();
    if (opts.tunnelUrl) {
        params.set("url", opts.tunnelUrl);
    }
    else if (opts.lanHost) {
        params.set("host", opts.lanHost);
        params.set("port", port);
    }
    params.set("token", token);
    return `terminalsync:/${sessionPath}?${params.toString()}`;
}
function buildWebUrl(opts) {
    const hash = opts.sessionId ? `${token}/${opts.sessionId}` : token;
    if (opts.tunnelUrl) {
        return `${opts.tunnelUrl}/#${hash}`;
    }
    return `http://${opts.lanHost}:${port}/#${hash}`;
}
function printQr(url, exitAfter) {
    process.stderr.write(`${url}\n`);
    qrcode.generate(url, { small: true }, (code) => {
        process.stderr.write(code + "\n");
        if (exitAfter)
            process.exit(0);
    });
}
async function cmdConnect() {
    if (!(await ensureServer()))
        die("Cannot reach server");
    const sessionId = process.env.TERMINALSYNC_SESSION;
    if (!tunnelEnabled) {
        const url = buildWebUrl({ sessionId, lanHost: getLanIp() });
        printQr(url, true);
        return;
    }
    // Tunnel mode
    const localUrl = `http://localhost:${port}`;
    process.stderr.write(`Starting tunnel to ${localUrl}...\n`);
    const { url: tunnelUrl, child: tunnelChild, stop } = cloudflaredTunnel({
        "--url": localUrl,
    });
    const publicUrl = await tunnelUrl;
    const webUrl = buildWebUrl({ sessionId, tunnelUrl: publicUrl });
    printQr(webUrl, false);
    process.stderr.write(`Tunnel active: ${publicUrl}\nPress Ctrl+C to stop.\n`);
    const shutdown = () => {
        stop();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // Keep alive until tunnel child exits or signal
    await new Promise((resolve) => {
        tunnelChild.on("exit", resolve);
    });
}
// --- Main ---
function printHelp() {
    const text = `terminalsync — share your terminal with any device

Usage: terminalsync <command>

Commands:
  share            Start a new terminal session
  connect          Show QR code to connect from mobile
  config           Configure tunnel, host, and port
  list             List active sessions
  attach <id>      Attach to an existing session
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
        if (!args[1])
            die("Usage: terminalsync attach <session-id>");
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
    case "help":
    case "--help":
    case "-h":
    case undefined:
        printHelp();
        break;
    default:
        die(`Unknown command: ${cmd}\nRun 'terminalsync help' for usage.`);
}
//# sourceMappingURL=connect.js.map