export interface Config {
    port: number;
    host: string;
    authToken: string;
    maxClients: number;
    defaultScrollbackLines: number;
    defaultShell: string;
    tunnel: boolean;
}
export declare function loadConfig(): Config;
