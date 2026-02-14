import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
import { createWSServer } from "./server/ws-server.js";

const config = loadConfig();
const server = await createWSServer(config);

const pidFile = join(homedir(), ".terminalsync", "server.pid");

function cleanupPidFile(): void {
  try {
    unlinkSync(pidFile);
  } catch {
    // ignore if already removed
  }
}

server.start();

try {
  writeFileSync(pidFile, String(process.pid), "utf-8");
} catch {
  // non-fatal: ~/.terminalsync may not exist in dev mode
}

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.shutdown();
  cleanupPidFile();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.shutdown();
  cleanupPidFile();
  process.exit(0);
});

process.on("exit", () => {
  cleanupPidFile();
});
