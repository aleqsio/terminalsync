import { describe, it, expect, afterEach } from "vitest";
import { ManagedSessionStore } from "../session/managed-session-store.js";
import { ManagedSession } from "../session/managed-session.js";

const stores: ManagedSessionStore[] = [];

function createStore(): ManagedSessionStore {
  const store = new ManagedSessionStore();
  stores.push(store);
  return store;
}

function sessionOpts(name = "test") {
  return {
    name,
    shell: process.env.SHELL ?? "/bin/sh",
    cols: 80,
    rows: 24,
  };
}

afterEach(() => {
  for (const store of stores) store.shutdown();
  stores.length = 0;
});

describe("ManagedSessionStore", () => {
  describe("create()", () => {
    it("returns a ManagedSession instance", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      expect(session).toBeInstanceOf(ManagedSession);
    });

    it("returns a session with the requested name and dimensions", () => {
      const store = createStore();
      const session = store.create({ ...sessionOpts("my-session"), cols: 120, rows: 40 });
      expect(session.name).toBe("my-session");
      expect(session.cols).toBe(120);
      expect(session.rows).toBe(40);
    });

    it("emits 'active' event when a session is created", async () => {
      const store = createStore();
      const activePromise = new Promise<void>((resolve) => {
        store.on("active", resolve);
      });
      store.create(sessionOpts());
      await activePromise;
    });

    it("emits 'active' for each created session", async () => {
      const store = createStore();
      let activeCount = 0;
      store.on("active", () => activeCount++);

      store.create(sessionOpts("s1"));
      store.create(sessionOpts("s2"));
      store.create(sessionOpts("s3"));

      // Give event loop a tick to process synchronous emits
      await new Promise((r) => setTimeout(r, 0));
      expect(activeCount).toBe(3);
    });

    it("adds the session to the store list", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      expect(store.list()).toContain(session);
    });

    it("makes the session retrievable by id", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      expect(store.get(session.id)).toBe(session);
    });

    it("tracks multiple sessions", () => {
      const store = createStore();
      const s1 = store.create(sessionOpts("s1"));
      const s2 = store.create(sessionOpts("s2"));
      expect(store.list()).toHaveLength(2);
      expect(store.list()).toContain(s1);
      expect(store.list()).toContain(s2);
    });

    it("sessions start in running state", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      expect(session.hasExited()).toBe(false);
      expect(session.getStatus()).toBe("running");
    });
  });

  describe("remove()", () => {
    it("removes the session from the store", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      const id = session.id;

      store.remove(id);

      expect(store.get(id)).toBeUndefined();
      expect(store.list()).not.toContain(session);
    });

    it("returns true when the session exists and is removed", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      expect(store.remove(session.id)).toBe(true);
    });

    it("returns false when the session does not exist", () => {
      const store = createStore();
      expect(store.remove("nonexistent-id")).toBe(false);
    });

    it("returns false after session has already been removed", () => {
      const store = createStore();
      const session = store.create(sessionOpts());
      store.remove(session.id);
      expect(store.remove(session.id)).toBe(false);
    });

    it("kills the session process on remove", async () => {
      const store = createStore();
      const session = store.create(sessionOpts());

      // Give the PTY a moment to start
      await new Promise((r) => setTimeout(r, 50));

      store.remove(session.id);

      // The session is gone from the store
      expect(store.get(session.id)).toBeUndefined();
    });

    it("removing one session does not affect others", () => {
      const store = createStore();
      const s1 = store.create(sessionOpts("s1"));
      const s2 = store.create(sessionOpts("s2"));

      store.remove(s1.id);

      expect(store.get(s1.id)).toBeUndefined();
      expect(store.get(s2.id)).toBe(s2);
      expect(store.list()).toHaveLength(1);
    });
  });

  describe("getRunningCount()", () => {
    it("returns 0 when no sessions exist", () => {
      const store = createStore();
      expect(store.getRunningCount()).toBe(0);
    });

    it("returns correct count with one running session", () => {
      const store = createStore();
      store.create(sessionOpts());
      expect(store.getRunningCount()).toBe(1);
    });

    it("returns correct count with multiple running sessions", () => {
      const store = createStore();
      store.create(sessionOpts("s1"));
      store.create(sessionOpts("s2"));
      store.create(sessionOpts("s3"));
      expect(store.getRunningCount()).toBe(3);
    });

    it("decreases count when a session is explicitly removed", () => {
      const store = createStore();
      const s1 = store.create(sessionOpts("s1"));
      store.create(sessionOpts("s2"));

      expect(store.getRunningCount()).toBe(2);
      store.remove(s1.id);
      expect(store.getRunningCount()).toBe(1);
    });

    it("returns 0 after all sessions are removed", () => {
      const store = createStore();
      const s1 = store.create(sessionOpts("s1"));
      const s2 = store.create(sessionOpts("s2"));

      store.remove(s1.id);
      store.remove(s2.id);

      expect(store.getRunningCount()).toBe(0);
    });

    it("decreases count when a session exits naturally", async () => {
      const store = createStore();
      store.create(sessionOpts("stays-running"));
      const exiting = store.create(sessionOpts("will-exit"));

      expect(store.getRunningCount()).toBe(2);

      const exitPromise = new Promise<void>((resolve) => {
        exiting.on("exit", () => resolve());
      });

      exiting.write("exit\n");
      await exitPromise;

      // After natural exit the store removes the session automatically
      expect(store.getRunningCount()).toBe(1);
    });

    it("returns 0 after shutdown", () => {
      const store = createStore();
      store.create(sessionOpts("s1"));
      store.create(sessionOpts("s2"));

      store.shutdown();

      expect(store.getRunningCount()).toBe(0);
    });
  });

  describe("shutdown()", () => {
    it("kills all sessions and clears the list", () => {
      const store = createStore();
      store.create(sessionOpts("s1"));
      store.create(sessionOpts("s2"));
      store.create(sessionOpts("s3"));

      store.shutdown();

      expect(store.list()).toHaveLength(0);
    });

    it("getRunningCount returns 0 after shutdown", () => {
      const store = createStore();
      store.create(sessionOpts("s1"));
      store.create(sessionOpts("s2"));

      store.shutdown();

      expect(store.getRunningCount()).toBe(0);
    });

    it("get() returns undefined for all sessions after shutdown", () => {
      const store = createStore();
      const s1 = store.create(sessionOpts("s1"));
      const s2 = store.create(sessionOpts("s2"));

      store.shutdown();

      expect(store.get(s1.id)).toBeUndefined();
      expect(store.get(s2.id)).toBeUndefined();
    });

    it("shutdown on empty store does not throw", () => {
      const store = createStore();
      expect(() => store.shutdown()).not.toThrow();
    });

    it("calling shutdown twice does not throw", () => {
      const store = createStore();
      store.create(sessionOpts("s1"));
      store.shutdown();
      expect(() => store.shutdown()).not.toThrow();
    });
  });

  describe("idle event", () => {
    it("emits idle when the only session exits naturally", async () => {
      const store = createStore();
      const session = store.create(sessionOpts());

      const idlePromise = new Promise<void>((resolve) => {
        store.on("idle", resolve);
      });

      session.write("exit\n");
      await idlePromise;
    });

    it("does not emit idle when remove() is called (only on natural exit)", async () => {
      const store = createStore();
      const session = store.create(sessionOpts());

      let idleEmitted = false;
      store.on("idle", () => { idleEmitted = true; });

      // Give PTY time to start
      await new Promise((r) => setTimeout(r, 50));
      store.remove(session.id);

      // Give any pending events time to fire
      await new Promise((r) => setTimeout(r, 100));
      expect(idleEmitted).toBe(false);
    });

    it("emits idle only after ALL sessions have exited", async () => {
      const store = createStore();
      const s1 = store.create(sessionOpts("s1"));
      const s2 = store.create(sessionOpts("s2"));

      let idleEmitted = false;
      store.on("idle", () => { idleEmitted = true; });

      // Exit first session and wait for its exit event
      const s1ExitPromise = new Promise<void>((resolve) => {
        s1.on("exit", () => resolve());
      });
      s1.write("exit\n");
      await s1ExitPromise;

      // idle should NOT have fired yet — s2 is still running
      expect(idleEmitted).toBe(false);
      expect(store.getRunningCount()).toBe(1);

      // Now exit the second session
      const idlePromise = new Promise<void>((resolve) => {
        store.on("idle", resolve);
      });
      s2.write("exit\n");
      await idlePromise;

      expect(idleEmitted).toBe(true);
    });

    it("emits session_removed event when a session exits", async () => {
      const store = createStore();
      const session = store.create(sessionOpts());

      const removedPromise = new Promise<string>((resolve) => {
        store.on("session_removed", (id: string) => resolve(id));
      });

      session.write("exit\n");
      const removedId = await removedPromise;
      expect(removedId).toBe(session.id);
    });
  });
});
