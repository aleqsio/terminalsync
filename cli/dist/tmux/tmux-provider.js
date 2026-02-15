import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listSessions } from "./discovery.js";
const execFileAsync = promisify(execFile);
export class TmuxProvider {
    available = null;
    async isAvailable() {
        if (this.available !== null)
            return this.available;
        try {
            await execFileAsync("tmux", ["-V"], { timeout: 3000 });
            this.available = true;
        }
        catch {
            this.available = false;
        }
        return this.available;
    }
    async listSessions() {
        if (!(await this.isAvailable()))
            return [];
        try {
            const tmuxSessions = await listSessions();
            return tmuxSessions.map((s) => ({
                id: `tmux:${s.sessionName}`,
                name: s.sessionName,
                status: "running",
                attachedClients: s.sessionAttached,
                source: "tmux",
            }));
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=tmux-provider.js.map