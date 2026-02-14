export interface TmuxPane {
  paneId: string;
  paneIndex: number;
  paneTitle: string;
  paneWidth: number;
  paneHeight: number;
  panePid: number;
  paneCurrentCommand: string;
  paneActive: boolean;
}

export interface TmuxWindow {
  windowId: string;
  windowIndex: number;
  windowName: string;
  windowActive: boolean;
  panes: TmuxPane[];
}

export interface TmuxSession {
  sessionName: string;
  sessionId: string;
  sessionCreated: number;
  sessionAttached: number;
  windows: TmuxWindow[];
}
