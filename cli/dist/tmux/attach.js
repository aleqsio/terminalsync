import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
const execFileAsync = promisify(execFile);
export async function captureScrollback(target, lines) {
    try {
        const { stdout } = await execFileAsync("tmux", ["capture-pane", "-t", target, "-p", "-S", `-${lines}`], { timeout: 5000 });
        return stdout;
    }
    catch {
        return "";
    }
}
export function spawnAttach(target, cols, rows) {
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
export function detachGracefully(ptyProcess) {
    // Send tmux prefix (Ctrl-B) + d to detach
    ptyProcess.write("\x02d");
}
//# sourceMappingURL=attach.js.map