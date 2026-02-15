import type { Config } from "../config.js";
export declare function createWSServer(config: Config): Promise<{
    start: () => void;
    shutdown: () => void;
}>;
