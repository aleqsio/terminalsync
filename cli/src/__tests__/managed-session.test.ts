import { describe, it, expect, afterEach } from "vitest";
import { ManagedSession } from "../session/managed-session.js";

const sessions: ManagedSession[] = [];

function createSession(
  cols = 80,
  rows = 24,
  name = "test",
): ManagedSession {
  const s = new ManagedSession({
    name,
    shell: process.env.SHELL ?? "/bin/sh",
    cols,
    rows,
  });
  sessions.push(s);
  return s;
}

afterEach(() => {
  for (const s of sessions) s.kill();
  sessions.length = 0;
});

describe("ManagedSession creation", () => {
  it("starts with the requested dimensions", () => {
    const s = createSession(120, 40);
    expect(s.cols).toBe(120);
    expect(s.rows).toBe(40);
  });

  it("generates a unique id", () => {
    const a = createSession();
    const b = createSession();
    expect(a.id).not.toBe(b.id);
  });

  it("starts with status running", () => {
    const s = createSession();
    expect(s.getStatus()).toBe("running");
    expect(s.hasExited()).toBe(false);
  });

  it("starts with zero attached clients", () => {
    const s = createSession();
    expect(s.getAttachedClientCount()).toBe(0);
    expect(s.getAttachedClients()).toEqual([]);
  });
});

describe("client attach / detach", () => {
  it("tracks attached clients", () => {
    const s = createSession(80, 24);
    s.attachClient("c1");
    expect(s.getAttachedClientCount()).toBe(1);
    expect(s.getAttachedClients()).toContain("c1");

    s.attachClient("c2");
    expect(s.getAttachedClientCount()).toBe(2);
  });

  it("removes clients on detach", () => {
    const s = createSession(80, 24);
    s.attachClient("c1");
    s.attachClient("c2");
    s.detachClient("c1");
    expect(s.getAttachedClientCount()).toBe(1);
    expect(s.getAttachedClients()).not.toContain("c1");
    expect(s.getAttachedClients()).toContain("c2");
  });

  it("ignores detach of unknown client", () => {
    const s = createSession(80, 24);
    s.attachClient("c1");
    s.detachClient("unknown");
    expect(s.getAttachedClientCount()).toBe(1);
  });
});

describe("resize", () => {
  it("resizes PTY directly", () => {
    const s = createSession(80, 24);
    s.resize(120, 40);
    expect(s.cols).toBe(120);
    expect(s.rows).toBe(40);
  });

  it("emits resize event", async () => {
    const s = createSession(80, 24);

    const resizePromise = new Promise<{ cols: number; rows: number }>(
      (resolve) => {
        s.on("resize", (cols, rows) => resolve({ cols, rows }));
      },
    );

    s.resize(100, 50);
    const result = await resizePromise;
    expect(result.cols).toBe(100);
    expect(result.rows).toBe(50);
  });

  it("does not emit resize when size unchanged", async () => {
    const s = createSession(80, 24);

    let resizeCount = 0;
    s.on("resize", () => resizeCount++);

    s.resize(80, 24);
    await new Promise((r) => setTimeout(r, 50));
    expect(resizeCount).toBe(0);
  });

  it("ignores zero or negative dimensions", () => {
    const s = createSession(80, 24);
    s.resize(0, 0);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);

    s.resize(-1, 50);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
  });

  it("resize does not affect attach/detach", () => {
    const s = createSession(80, 24);
    s.attachClient("c1");
    s.resize(120, 40);
    expect(s.cols).toBe(120);
    expect(s.getAttachedClientCount()).toBe(1);

    s.detachClient("c1");
    expect(s.cols).toBe(120);
    expect(s.getAttachedClientCount()).toBe(0);
  });
});

describe("session exit", () => {
  it("emits exit event when PTY process exits", async () => {
    const s = createSession(80, 24);
    const exitPromise = new Promise<number>((resolve) => {
      s.on("exit", resolve);
    });

    s.write("exit\n");
    const code = await exitPromise;
    expect(typeof code).toBe("number");
    expect(s.hasExited()).toBe(true);
    expect(s.getStatus()).toBe("exited");
  });

  it("does not crash on write after exit", async () => {
    const s = createSession(80, 24);
    const exitPromise = new Promise<void>((resolve) => {
      s.on("exit", () => resolve());
    });

    s.write("exit\n");
    await exitPromise;

    // Should not throw
    s.write("hello");
  });

  it("does not crash on resize after exit", async () => {
    const s = createSession(80, 24);
    const exitPromise = new Promise<void>((resolve) => {
      s.on("exit", () => resolve());
    });

    s.write("exit\n");
    await exitPromise;

    // Should not throw
    s.resize(120, 40);
  });
});

describe("buffer", () => {
  it("captures PTY output in buffer", async () => {
    const s = createSession(80, 24);

    const dataPromise = new Promise<void>((resolve) => {
      s.on("data", () => resolve());
    });

    s.write("echo hello-test-marker\n");
    await dataPromise;

    await new Promise((r) => setTimeout(r, 200));
    const buf = s.getBufferedOutput();
    expect(buf).toContain("hello-test-marker");
  });
});
