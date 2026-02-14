import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listSessions } from "./discovery.js";
import type { SessionInfo } from "../protocol/messages.js";

const execFileAsync = promisify(execFile);

export class TmuxProvider {
  private available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    try {
      await execFileAsync("tmux", ["-V"], { timeout: 3000 });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!(await this.isAvailable())) return [];

    try {
      const tmuxSessions = await listSessions();
      return tmuxSessions.map((s) => ({
        id: `tmux:${s.sessionName}`,
        name: s.sessionName,
        status: "running" as const,
        attachedClients: s.sessionAttached,
        source: "tmux" as const,
      }));
    } catch {
      return [];
    }
  }
}
