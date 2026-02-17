import { loadSharedConfig } from "./shared-config.js";

export interface Config {
  port: number;
  host: string;
  authToken: string;
  maxClients: number;
  defaultScrollbackLines: number;
  defaultShell: string;
  tunnel: boolean;
}

export function loadConfig(): Config {
  const config = loadSharedConfig();

  if (!config.authToken) {
    console.error("TERMINALSYNC_TOKEN environment variable is required");
    process.exit(1);
  }

  return config;
}
