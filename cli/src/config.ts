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
  const authToken = process.env.TERMINALSYNC_TOKEN;
  if (!authToken) {
    console.error("TERMINALSYNC_TOKEN environment variable is required");
    process.exit(1);
  }

  return {
    port: parseInt(process.env.TERMINALSYNC_PORT ?? "8089", 10),
    host: process.env.TERMINALSYNC_HOST ?? "0.0.0.0",
    authToken,
    maxClients: parseInt(process.env.TERMINALSYNC_MAX_CLIENTS ?? "10", 10),
    defaultScrollbackLines: parseInt(
      process.env.TERMINALSYNC_SCROLLBACK ?? "1000",
      10,
    ),
    defaultShell:
      process.env.TERMINALSYNC_SHELL ?? process.env.SHELL ?? "/bin/sh",
    tunnel:
      (process.env.TERMINALSYNC_TUNNEL ?? "false") === "true",
  };
}
