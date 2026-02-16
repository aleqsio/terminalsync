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
  title: (title: string) => void;
  exit: (exitCode: number) => void;
}

export class ManagedSession extends EventEmitter {
  readonly id: string;
  private _name: string;
  readonly source: "managed" | "tmux";

  get name(): string { return this._name; }

  private ptyProcess: pty.IPty;
  private ringBuffer: string[] = [];
  private ringBufferBytes = 0;
  private maxBufferBytes: number;
  private attachedClients = new Set<string>();
  private _cols: number;
  private _rows: number;
  private exited = false;
  private exitCode = 0;

  constructor(opts: ManagedSessionOptions) {
    super();
    this.id = opts.id ?? crypto.randomUUID();
    this._name = opts.name;
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
      const title = this.extractTitle(data);
      if (title && title !== this._name) {
        this._name = title;
        this.emit("title", title);
      }
      this.emit("data", data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.exited = true;
      this.exitCode = exitCode;
      this.emit("exit", exitCode);
    });
  }

  private extractTitle(data: string): string | null {
    // Match OSC 0 or 2 title sequences: \x1b]N;title\x07 or \x1b]N;title\x1b\\
    const match = data.match(/\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/);
    return match ? match[1] : null;
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

  attachClient(clientId: string): void {
    this.attachedClients.add(clientId);
  }

  detachClient(clientId: string): void {
    this.attachedClients.delete(clientId);
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    if (!this.exited) {
      this.ptyProcess.resize(cols, rows);
    }
    this.emit("resize", cols, rows);
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
