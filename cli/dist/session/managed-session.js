import { EventEmitter } from "node:events";
import * as pty from "node-pty";
const DEFAULT_BUFFER_SIZE = 200 * 1024; // 200KB
export class ManagedSession extends EventEmitter {
    id;
    _name;
    source;
    get name() { return this._name; }
    ptyProcess;
    ringBuffer = [];
    ringBufferBytes = 0;
    maxBufferBytes;
    attachedClients = new Set();
    _cols;
    _rows;
    exited = false;
    exitCode = 0;
    constructor(opts) {
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
        this.ptyProcess.onData((data) => {
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
    extractTitle(data) {
        // Match OSC 0 or 2 title sequences: \x1b]N;title\x07 or \x1b]N;title\x1b\\
        const match = data.match(/\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/);
        return match ? match[1] : null;
    }
    pushToBuffer(data) {
        const byteLen = Buffer.byteLength(data);
        this.ringBuffer.push(data);
        this.ringBufferBytes += byteLen;
        while (this.ringBufferBytes > this.maxBufferBytes && this.ringBuffer.length > 1) {
            const removed = this.ringBuffer.shift();
            this.ringBufferBytes -= Buffer.byteLength(removed);
        }
    }
    getBufferedOutput() {
        return this.ringBuffer.join("");
    }
    write(data) {
        if (!this.exited) {
            this.ptyProcess.write(data);
        }
    }
    get cols() { return this._cols; }
    get rows() { return this._rows; }
    attachClient(clientId) {
        this.attachedClients.add(clientId);
    }
    detachClient(clientId) {
        this.attachedClients.delete(clientId);
    }
    resize(cols, rows) {
        if (cols <= 0 || rows <= 0)
            return;
        if (cols === this._cols && rows === this._rows)
            return;
        this._cols = cols;
        this._rows = rows;
        if (!this.exited) {
            this.ptyProcess.resize(cols, rows);
        }
        this.emit("resize", cols, rows);
    }
    getAttachedClients() {
        return Array.from(this.attachedClients);
    }
    getAttachedClientCount() {
        return this.attachedClients.size;
    }
    hasExited() {
        return this.exited;
    }
    getExitCode() {
        return this.exitCode;
    }
    getStatus() {
        return this.exited ? "exited" : "running";
    }
    kill() {
        if (!this.exited) {
            try {
                this.ptyProcess.kill();
            }
            catch {
                // already dead
            }
        }
    }
}
//# sourceMappingURL=managed-session.js.map