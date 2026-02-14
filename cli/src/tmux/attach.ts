import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";

const execFileAsync = promisify(execFile);

export interface TmuxAttachment {
  pty: pty.IPty;
  scrollback: string;
}

export async function captureScrollback(
  target: string,
  lines: number,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["capture-pane", "-t", target, "-p", "-S", `-${lines}`],
      { timeout: 5000 },
    );
    return stdout;
  } catch {
    return "";
  }
}

export function spawnAttach(
  target: string,
  cols: number,
  rows: number,
): pty.IPty {
  const ptyProcess = pty.spawn("tmux", ["attach-session", "-t", target], {
    name: "xterm-256color",
    cols,
    rows,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });

  return ptyProcess;
}

export function detachGracefully(ptyProcess: pty.IPty): void {
  // Send tmux prefix (Ctrl-B) + d to detach
  ptyProcess.write("\x02d");
}
