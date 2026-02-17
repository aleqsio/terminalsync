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

describe("getAttachedClients and detachClient round-trips", () => {
  it("attach and detach single client round-trip", () => {
    const s = createSession();
    expect(s.getAttachedClients()).toEqual([]);

    s.attachClient("client-1");
    expect(s.getAttachedClients()).toEqual(["client-1"]);
    expect(s.getAttachedClientCount()).toBe(1);

    s.detachClient("client-1");
    expect(s.getAttachedClients()).toEqual([]);
    expect(s.getAttachedClientCount()).toBe(0);
  });

  it("attach multiple clients then detach one by one", () => {
    const s = createSession();
    s.attachClient("c1");
    s.attachClient("c2");
    s.attachClient("c3");
    expect(s.getAttachedClients()).toHaveLength(3);

    s.detachClient("c2");
    expect(s.getAttachedClients()).toHaveLength(2);
    expect(s.getAttachedClients()).not.toContain("c2");
    expect(s.getAttachedClients()).toContain("c1");
    expect(s.getAttachedClients()).toContain("c3");

    s.detachClient("c1");
    expect(s.getAttachedClients()).toHaveLength(1);
    expect(s.getAttachedClients()).toContain("c3");

    s.detachClient("c3");
    expect(s.getAttachedClients()).toEqual([]);
    expect(s.getAttachedClientCount()).toBe(0);
  });

  it("re-attaching same client id is idempotent (Set semantics)", () => {
    const s = createSession();
    s.attachClient("c1");
    s.attachClient("c1");
    expect(s.getAttachedClientCount()).toBe(1);
    expect(s.getAttachedClients()).toEqual(["c1"]);
  });

  it("detachClient on empty set is a no-op", () => {
    const s = createSession();
    expect(() => s.detachClient("nonexistent")).not.toThrow();
    expect(s.getAttachedClientCount()).toBe(0);
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

  it("ignores resize when cols <= 0", () => {
    const s = createSession(80, 24);
    s.resize(0, 30);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);

    s.resize(-5, 30);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
  });

  it("ignores resize when rows <= 0", () => {
    const s = createSession(80, 24);
    s.resize(100, 0);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);

    s.resize(100, -1);
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
  });

  it("same cols and rows is a no-op (does not change dimensions or emit)", async () => {
    const s = createSession(80, 24);

    let resizeCount = 0;
    s.on("resize", () => resizeCount++);

    s.resize(80, 24);
    s.resize(80, 24);
    await new Promise((r) => setTimeout(r, 50));

    expect(s.cols).toBe(80);
    expect(s.rows).toBe(24);
    expect(resizeCount).toBe(0);
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

describe("OSC title extraction", () => {
  it("extracts title from OSC 0 sequence with BEL terminator", () => {
    const s = createSession() as any;
    expect(s.extractTitle("\x1b]0;My Title\x07")).toBe("My Title");
  });

  it("extracts title from OSC 2 sequence with BEL terminator", () => {
    const s = createSession() as any;
    expect(s.extractTitle("\x1b]2;My Title\x07")).toBe("My Title");
  });

  it("extracts title from OSC 0 with ST terminator (ESC \\)", () => {
    const s = createSession() as any;
    expect(s.extractTitle("\x1b]0;ST Title\x1b\\")).toBe("ST Title");
  });

  it("extracts title from OSC 2 with ST terminator (ESC \\)", () => {
    const s = createSession() as any;
    expect(s.extractTitle("\x1b]2;ST Title\x1b\\")).toBe("ST Title");
  });

  it("returns null when no OSC title sequence is present", () => {
    const s = createSession() as any;
    expect(s.extractTitle("plain output text")).toBeNull();
  });

  it("returns null for unsupported OSC codes (not 0 or 2)", () => {
    const s = createSession() as any;
    expect(s.extractTitle("\x1b]1;Ignored\x07")).toBeNull();
    expect(s.extractTitle("\x1b]9;Ignored\x07")).toBeNull();
  });

  it("returns null for empty string", () => {
    const s = createSession() as any;
    expect(s.extractTitle("")).toBeNull();
  });

  it("emits title event when PTY outputs OSC sequence", async () => {
    const s = createSession();
    const titlePromise = new Promise<string>((resolve) => {
      s.on("title", resolve);
    });

    // Write an OSC title sequence directly to the PTY output via printf
    s.write('printf "\\033]0;TerminalTitle\\007"\n');

    const title = await titlePromise;
    expect(title).toBe("TerminalTitle");
  });
});

describe("ring buffer byte limit", () => {
  it("retains data when under the limit", () => {
    const s = new ManagedSession({
      name: "test",
      shell: process.env.SHELL ?? "/bin/sh",
      cols: 80,
      rows: 24,
      bufferSize: 200,
    });
    sessions.push(s);
    const sAny = s as any;

    const chunk = "A".repeat(50);
    sAny.pushToBuffer(chunk);

    expect(s.getBufferedOutput()).toContain(chunk);
    expect(sAny.ringBufferBytes).toBeLessThanOrEqual(200);
  });

  it("evicts oldest chunk when byte limit is exceeded", () => {
    const s = new ManagedSession({
      name: "test",
      shell: process.env.SHELL ?? "/bin/sh",
      cols: 80,
      rows: 24,
      bufferSize: 100,
    });
    sessions.push(s);
    const sAny = s as any;

    const firstChunk = "A".repeat(60);
    const secondChunk = "B".repeat(60);

    sAny.pushToBuffer(firstChunk);
    sAny.pushToBuffer(secondChunk);

    const output = s.getBufferedOutput();
    // The first chunk (60 "A"s) should have been evicted
    expect(output).not.toMatch(/A{60}/);
    // The second chunk should remain
    expect(output).toContain(secondChunk);
  });

  it("retains at least the most recent chunk even if it alone exceeds the limit", () => {
    const s = new ManagedSession({
      name: "test",
      shell: process.env.SHELL ?? "/bin/sh",
      cols: 80,
      rows: 24,
      bufferSize: 10, // tiny buffer
    });
    sessions.push(s);
    const sAny = s as any;

    const bigChunk = "X".repeat(100);
    sAny.pushToBuffer(bigChunk);

    // Even though the chunk exceeds the buffer, at least one chunk must be retained
    expect(s.getBufferedOutput()).toBe(bigChunk);
    expect(sAny.ringBuffer.length).toBe(1);
  });

  it("evicts multiple old chunks to stay within the 200KB default limit", () => {
    const s = createSession();
    const sAny = s as any;

    const chunkSize = 30 * 1024; // 30KB per chunk
    const firstChunk = "F".repeat(chunkSize);

    // Push the first (distinctive) chunk
    sAny.pushToBuffer(firstChunk);

    // Push enough additional chunks to exceed 200KB (7 more × 30KB = 210KB additional)
    for (let i = 0; i < 7; i++) {
      sAny.pushToBuffer("X".repeat(chunkSize));
    }

    // Total pushed: 8 × 30KB = 240KB > 200KB, so the first chunk must be gone
    const output = s.getBufferedOutput();
    expect(output).not.toMatch(/F{1000}/); // first chunk evicted
    // Buffer bytes should be within one chunk of the limit
    expect(sAny.ringBufferBytes).toBeLessThanOrEqual(200 * 1024 + chunkSize);
  });

  it("ring buffer correctly tracks byte count after eviction", () => {
    const s = new ManagedSession({
      name: "test",
      shell: process.env.SHELL ?? "/bin/sh",
      cols: 80,
      rows: 24,
      bufferSize: 100,
    });
    sessions.push(s);
    const sAny = s as any;

    sAny.pushToBuffer("A".repeat(60));
    sAny.pushToBuffer("B".repeat(60));

    // After eviction: only "B"*60 remains → 60 bytes
    expect(sAny.ringBufferBytes).toBe(60);
    expect(sAny.ringBuffer.length).toBe(1);
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
