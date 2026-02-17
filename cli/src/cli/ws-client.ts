import WebSocket from "ws";

let seq = 0;

export function send(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify({ ...msg, seq: ++seq }));
}

export function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

export function openWs(url: string, token: string | undefined): WebSocket {
  if (!token) die("TERMINALSYNC_TOKEN is required");
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ws;
}
