import { EventEmitter } from "node:events";
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
export declare class ManagedSession extends EventEmitter {
    readonly id: string;
    readonly name: string;
    readonly source: "managed" | "tmux";
    private ptyProcess;
    private ringBuffer;
    private ringBufferBytes;
    private maxBufferBytes;
    private attachedClients;
    private ownerId;
    private _cols;
    private _rows;
    private exited;
    private exitCode;
    constructor(opts: ManagedSessionOptions);
    private pushToBuffer;
    getBufferedOutput(): string;
    write(data: string): void;
    get cols(): number;
    get rows(): number;
    resize(clientId: string, cols: number, rows: number): void;
    attachClient(clientId: string): void;
    detachClient(clientId: string): boolean;
    isOwner(clientId: string): boolean;
    getAttachedClients(): string[];
    getAttachedClientCount(): number;
    hasExited(): boolean;
    getExitCode(): number;
    getStatus(): "running" | "exited";
    kill(): void;
}
