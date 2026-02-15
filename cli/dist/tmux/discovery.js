import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function runTmux(args) {
    const { stdout } = await execFileAsync("tmux", args, {
        timeout: 5000,
    });
    return stdout.trim();
}
function parseSessions(raw) {
    const sessions = new Map();
    if (!raw)
        return sessions;
    for (const line of raw.split("\n")) {
        const [name, id, created, attached] = line.split("\t");
        if (!name)
            continue;
        sessions.set(name, {
            sessionName: name,
            sessionId: id,
            sessionCreated: parseInt(created, 10),
            sessionAttached: parseInt(attached, 10),
            windows: [],
        });
    }
    return sessions;
}
function parseWindows(raw) {
    const windowsBySession = new Map();
    if (!raw)
        return windowsBySession;
    for (const line of raw.split("\n")) {
        const [sessionName, wId, wIndex, wName, wActive] = line.split("\t");
        if (!sessionName)
            continue;
        const windows = windowsBySession.get(sessionName) ?? [];
        windows.push({
            windowId: wId,
            windowIndex: parseInt(wIndex, 10),
            windowName: wName,
            windowActive: wActive === "1",
            panes: [],
        });
        windowsBySession.set(sessionName, windows);
    }
    return windowsBySession;
}
function parsePanes(raw) {
    const panesByWindow = new Map();
    if (!raw)
        return panesByWindow;
    for (const line of raw.split("\n")) {
        const [wId, pId, pIndex, pTitle, pWidth, pHeight, pPid, pCmd, pActive] = line.split("\t");
        if (!wId)
            continue;
        const panes = panesByWindow.get(wId) ?? [];
        panes.push({
            paneId: pId,
            paneIndex: parseInt(pIndex, 10),
            paneTitle: pTitle,
            paneWidth: parseInt(pWidth, 10),
            paneHeight: parseInt(pHeight, 10),
            panePid: parseInt(pPid, 10),
            paneCurrentCommand: pCmd,
            paneActive: pActive === "1",
        });
        panesByWindow.set(wId, panes);
    }
    return panesByWindow;
}
export async function listSessions() {
    let sessionsRaw;
    try {
        sessionsRaw = await runTmux([
            "list-sessions",
            "-F",
            "#{session_name}\t#{session_id}\t#{session_created}\t#{session_attached}",
        ]);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("no server running") || message.includes("no sessions")) {
            return [];
        }
        throw err;
    }
    const sessions = parseSessions(sessionsRaw);
    const windowsRaw = await runTmux([
        "list-windows",
        "-a",
        "-F",
        "#{session_name}\t#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}",
    ]);
    const windowsBySession = parseWindows(windowsRaw);
    const panesRaw = await runTmux([
        "list-panes",
        "-a",
        "-F",
        "#{window_id}\t#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_width}\t#{pane_height}\t#{pane_pid}\t#{pane_current_command}\t#{pane_active}",
    ]);
    const panesByWindow = parsePanes(panesRaw);
    for (const [sessionName, session] of sessions) {
        session.windows = windowsBySession.get(sessionName) ?? [];
        for (const window of session.windows) {
            window.panes = panesByWindow.get(window.windowId) ?? [];
        }
    }
    return Array.from(sessions.values());
}
//# sourceMappingURL=discovery.js.map