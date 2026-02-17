/**
 * shared-config.ts
 *
 * Shared config loader used by both the server (index.ts via config.ts)
 * and the CLI client (connect.ts via cli/config-file.ts).
 *
 * Precedence: env vars > ~/.terminalsync/config file > built-in defaults
 *
 * Does NOT crash if TERMINALSYNC_TOKEN is absent — callers decide whether
 * the token is mandatory.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Config } from "./config.js";

/** Parse a key=value config file, ignoring blank lines and # comments. */
export function parseConfigFile(contents: string): Record<string, string> {
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

/** Read ~/.terminalsync/config and return its key=value pairs, or {} if absent. */
export function readConfigFile(configPath?: string): Record<string, string> {
  const path = configPath ?? join(homedir(), ".terminalsync", "config");
  if (!existsSync(path)) return {};
  try {
    return parseConfigFile(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Load config by merging file values with env vars (env wins).
 * The `authToken` field will be an empty string when no token is found —
 * callers are responsible for validating it.
 */
export function loadSharedConfig(configPath?: string): Config {
  const file = readConfigFile(configPath);

  const get = (key: string, fallback?: string): string =>
    process.env[key] ?? file[key] ?? fallback ?? "";

  return {
    port: parseInt(get("TERMINALSYNC_PORT", "8089"), 10),
    host: get("TERMINALSYNC_HOST", "0.0.0.0"),
    authToken: get("TERMINALSYNC_TOKEN"),
    maxClients: parseInt(get("TERMINALSYNC_MAX_CLIENTS", "10"), 10),
    defaultScrollbackLines: parseInt(get("TERMINALSYNC_SCROLLBACK", "1000"), 10),
    defaultShell: get("TERMINALSYNC_SHELL", process.env.SHELL ?? "/bin/sh"),
    tunnel: get("TERMINALSYNC_TUNNEL", "false") === "true",
  };
}
