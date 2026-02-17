import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function ensureConfigFile(): string {
  const tsDir = join(homedir(), ".terminalsync");
  const configPath = join(tsDir, "config");
  if (!existsSync(configPath)) {
    mkdirSync(tsDir, { recursive: true });
    const genToken = randomBytes(32).toString("hex");
    writeFileSync(
      configPath,
      `TERMINALSYNC_TOKEN=${genToken}\nTERMINALSYNC_HOST=0.0.0.0\nTERMINALSYNC_PORT=8089\nTERMINALSYNC_TUNNEL=true\n`
    );
  }
  return configPath;
}

export function loadConfigFile(): Record<string, string> {
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

export function setConfigValue(key: string, value: string): void {
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
