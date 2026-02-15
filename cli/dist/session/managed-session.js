import { EventEmitter } from "node:events";
import * as pty from "node-pty";
const DEFAULT_BUFFER_SIZE = 200 * 1024; // 200KB
export class ManagedSession extends EventEmitter {
    id;
    name;
    source;
    ptyProcess;
    ringBuffer = [];
    ringBufferBytes = 0;
    maxBufferBytes;
    attachedClients = new Set();
    ownerId = null;
    _cols;
    _rows;
    exited = false;
    exitCode = 0;
    constructor(opts) {
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
        this.ptyProcess.onData((data) => {
            this.pushToBuffer(data);
            this.emit("data", data);
        });
        this.ptyProcess.onExit(({ exitCode }) => {
            this.exited = true;
            this.exitCode = exitCode;
            this.emit("exit", exitCode);
        });
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
    resize(clientId, cols, rows) {
        if (this.exited || clientId !== this.ownerId)
            return;
        this._cols = cols;
        this._rows = rows;
        this.ptyProcess.resize(cols, rows);
    }
    attachClient(clientId) {
        if (this.attachedClients.size === 0) {
            this.ownerId = clientId;
        }
        this.attachedClients.add(clientId);
    }
    detachClient(clientId) {
        this.attachedClients.delete(clientId);
        if (clientId === this.ownerId) {
            this.ownerId = null;
            return true; // owner left
        }
        return false;
    }
    isOwner(clientId) {
        return clientId === this.ownerId;
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