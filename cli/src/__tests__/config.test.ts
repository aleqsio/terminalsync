import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConfigFile, readConfigFile, loadSharedConfig } from "../shared-config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ts-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, contents: string): string {
  const path = join(dir, "config");
  writeFileSync(path, contents, "utf-8");
  return path;
}

// ---------------------------------------------------------------------------
// parseConfigFile
// ---------------------------------------------------------------------------

describe("parseConfigFile", () => {
  it("parses simple key=value lines", () => {
    const result = parseConfigFile("FOO=bar\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores blank lines", () => {
    const result = parseConfigFile("\nFOO=bar\n\n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("ignores comment lines starting with #", () => {
    const result = parseConfigFile("# comment\nFOO=bar\n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("handles values that contain = signs", () => {
    const result = parseConfigFile("TOKEN=abc=def==\n");
    expect(result).toEqual({ TOKEN: "abc=def==" });
  });

  it("ignores lines without =", () => {
    const result = parseConfigFile("NOEQUALSSIGN\nFOO=bar\n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("returns empty object for empty input", () => {
    expect(parseConfigFile("")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// readConfigFile
// ---------------------------------------------------------------------------

describe("readConfigFile", () => {
  it("returns empty object when file does not exist", () => {
    const result = readConfigFile("/nonexistent/path/config");
    expect(result).toEqual({});
  });

  it("reads and parses an existing file", () => {
    const dir = makeTmpDir();
    writeConfig(dir, "TERMINALSYNC_TOKEN=abc123\nTERMINALSYNC_PORT=9090\n");
    const result = readConfigFile(join(dir, "config"));
    expect(result.TERMINALSYNC_TOKEN).toBe("abc123");
    expect(result.TERMINALSYNC_PORT).toBe("9090");
    rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// loadSharedConfig — precedence tests
// ---------------------------------------------------------------------------

describe("loadSharedConfig", () => {
  const originalEnv: Record<string, string | undefined> = {};

  const envKeys = [
    "TERMINALSYNC_TOKEN",
    "TERMINALSYNC_PORT",
    "TERMINALSYNC_HOST",
    "TERMINALSYNC_TUNNEL",
    "TERMINALSYNC_MAX_CLIENTS",
    "TERMINALSYNC_SCROLLBACK",
    "TERMINALSYNC_SHELL",
  ];

  beforeEach(() => {
    // Snapshot relevant env vars and clear them
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("returns defaults when no env vars and no file", () => {
    const config = loadSharedConfig("/nonexistent/path/config");
    expect(config.port).toBe(8089);
    expect(config.host).toBe("0.0.0.0");
    expect(config.authToken).toBe("");
    expect(config.maxClients).toBe(10);
    expect(config.defaultScrollbackLines).toBe(1000);
    expect(config.tunnel).toBe(false);
  });

  it("uses file value when env var is absent", () => {
    const dir = makeTmpDir();
    const configPath = writeConfig(dir, "TERMINALSYNC_TOKEN=file-token\nTERMINALSYNC_PORT=9090\n");

    const config = loadSharedConfig(configPath);
    expect(config.authToken).toBe("file-token");
    expect(config.port).toBe(9090);

    rmSync(dir, { recursive: true });
  });

  it("env var overrides file value", () => {
    const dir = makeTmpDir();
    const configPath = writeConfig(dir, "TERMINALSYNC_TOKEN=file-token\nTERMINALSYNC_PORT=9090\n");

    process.env.TERMINALSYNC_TOKEN = "env-token";
    process.env.TERMINALSYNC_PORT = "7777";

    const config = loadSharedConfig(configPath);
    expect(config.authToken).toBe("env-token");
    expect(config.port).toBe(7777);

    rmSync(dir, { recursive: true });
  });

  it("partial env override: only overridden keys change", () => {
    const dir = makeTmpDir();
    const configPath = writeConfig(
      dir,
      "TERMINALSYNC_TOKEN=file-token\nTERMINALSYNC_PORT=9090\nTERMINALSYNC_HOST=1.2.3.4\n"
    );

    process.env.TERMINALSYNC_TOKEN = "env-token"; // override only token

    const config = loadSharedConfig(configPath);
    expect(config.authToken).toBe("env-token");   // from env
    expect(config.port).toBe(9090);               // from file
    expect(config.host).toBe("1.2.3.4");          // from file

    rmSync(dir, { recursive: true });
  });

  it("tunnel=true is parsed correctly from file", () => {
    const dir = makeTmpDir();
    const configPath = writeConfig(dir, "TERMINALSYNC_TUNNEL=true\n");

    const config = loadSharedConfig(configPath);
    expect(config.tunnel).toBe(true);

    rmSync(dir, { recursive: true });
  });

  it("tunnel env var overrides file tunnel value", () => {
    const dir = makeTmpDir();
    const configPath = writeConfig(dir, "TERMINALSYNC_TUNNEL=true\n");

    process.env.TERMINALSYNC_TUNNEL = "false";

    const config = loadSharedConfig(configPath);
    expect(config.tunnel).toBe(false);

    rmSync(dir, { recursive: true });
  });

  it("authToken is empty string (not undefined) when missing", () => {
    const config = loadSharedConfig("/nonexistent/path/config");
    expect(config.authToken).toBe("");
  });
});
