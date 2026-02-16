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
            return tmuxSessions.map((s) => {
                // Find the active pane's title from the active window
                const activeWindow = s.windows.find(w => w.windowActive) ?? s.windows[0];
                const activePane = activeWindow?.panes.find(p => p.paneActive) ?? activeWindow?.panes[0];
                const title = activePane?.paneTitle || activeWindow?.windowName || s.sessionName;
                return {
                    id: `tmux:${s.sessionName}`,
                    name: title,
                    status: "running",
                    attachedClients: s.sessionAttached,
                    source: "tmux",
                };
            });
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=tmux-provider.js.map