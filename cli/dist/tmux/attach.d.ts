import * as pty from "node-pty";
export interface TmuxAttachment {
    pty: pty.IPty;
    scrollback: string;
}
export declare function captureScrollback(target: string, lines: number): Promise<string>;
export declare function spawnAttach(target: string, cols: number, rows: number): pty.IPty;
export declare function detachGracefully(ptyProcess: pty.IPty): void;
