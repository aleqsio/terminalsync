import { EventEmitter } from "node:events";
import * as pty from "node-pty";

const DEFAULT_BUFFER_SIZE = 200 * 1024; // 200KB

export interface ManagedSessionOptions {
  id?: string;
  name: string;
  shell: string;
  cols: number;
  rows: number;
  bufferSize?: number;
  env?: Record<string, string>;
  source?: "managed" | "tmux";
}

export interface ManagedSessionEvents {
  data: (data: string) => void;
  exit: (exitCode: number) => void;
}

export class ManagedSession extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly source: "managed" | "tmux";

  private ptyProcess: pty.IPty;
  private ringBuffer: string[] = [];
  private ringBufferBytes = 0;
  private maxBufferBytes: number;
  private attachedClients = new Set<string>();
  private ownerId: string | null = null;
  private _cols: number;
  private _rows: number;
  private exited = false;
  private exitCode = 0;

  constructor(opts: ManagedSessionOptions) {
    super();
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.source = opts.source ?? "managed";
    this.maxBufferBytes = opts.bufferSize ?? DEFAULT_BUFFER_SIZE;

    this._cols = opts.cols;
    this._rows = opts.rows;

    this.ptyProcess = pty.spawn(opts.shell, [], {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      env: {
        ...process.env,
        ...opts.env,
        TERM: "xterm-256color",
        TERMINALSYNC_SESSION: this.id,
      },
    });

    this.ptyProcess.onData((data: string) => {
      this.pushToBuffer(data);
      this.emit("data", data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.exited = true;
      this.exitCode = exitCode;
      this.emit("exit", exitCode);
    });
  }

  private pushToBuffer(data: string): void {
    const byteLen = Buffer.byteLength(data);
    this.ringBuffer.push(data);
    this.ringBufferBytes += byteLen;

    while (this.ringBufferBytes > this.maxBufferBytes && this.ringBuffer.length > 1) {
      const removed = this.ringBuffer.shift()!;
      this.ringBufferBytes -= Buffer.byteLength(removed);
    }
  }

  getBufferedOutput(): string {
    return this.ringBuffer.join("");
  }

  write(data: string): void {
    if (!this.exited) {
      this.ptyProcess.write(data);
    }
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }

  resize(clientId: string, cols: number, rows: number): void {
    if (this.exited || clientId !== this.ownerId) return;
    this._cols = cols;
    this._rows = rows;
    this.ptyProcess.resize(cols, rows);
  }

  attachClient(clientId: string): void {
    if (this.attachedClients.size === 0) {
      this.ownerId = clientId;
    }
    this.attachedClients.add(clientId);
  }

  detachClient(clientId: string): boolean {
    this.attachedClients.delete(clientId);
    if (clientId === this.ownerId) {
      this.ownerId = null;
      return true; // owner left
    }
    return false;
  }

  isOwner(clientId: string): boolean {
    return clientId === this.ownerId;
  }

  getAttachedClients(): string[] {
    return Array.from(this.attachedClients);
  }

  getAttachedClientCount(): number {
    return this.attachedClients.size;
  }

  hasExited(): boolean {
    return this.exited;
  }

  getExitCode(): number {
    return this.exitCode;
  }

  getStatus(): "running" | "exited" {
    return this.exited ? "exited" : "running";
  }

  kill(): void {
    if (!this.exited) {
      try {
        this.ptyProcess.kill();
      } catch {
        // already dead
      }
    }
  }
}
