export interface Config {
    port: number;
    host: string;
    authToken: string;
    maxClients: number;
    defaultScrollbackLines: number;
    defaultShell: string;
}
export declare function loadConfig(): Config;
