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
    title: (title: string) => void;
    exit: (exitCode: number) => void;
}
export declare class ManagedSession extends EventEmitter {
    readonly id: string;
    private _name;
    readonly source: "managed" | "tmux";
    get name(): string;
    private ptyProcess;
    private ringBuffer;
    private ringBufferBytes;
    private maxBufferBytes;
    private attachedClients;
    private _cols;
    private _rows;
    private exited;
    private exitCode;
    constructor(opts: ManagedSessionOptions);
    private extractTitle;
    private pushToBuffer;
    getBufferedOutput(): string;
    write(data: string): void;
    get cols(): number;
    get rows(): number;
    attachClient(clientId: string): void;
    detachClient(clientId: string): void;
    resize(cols: number, rows: number): void;
    getAttachedClients(): string[];
    getAttachedClientCount(): number;
    hasExited(): boolean;
    getExitCode(): number;
    getStatus(): "running" | "exited";
    kill(): void;
}
