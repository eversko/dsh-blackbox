import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { apply } from "../src/plugin.mjs";

test("the live plugin writes one immutable privacy-safe snapshot per flushed seq", async () => {
  const root = await mkdtemp(join(tmpdir(), "eversko-dsh-blackbox-test-"));
  try {
    const listeners = new Map();
    const ctx = {
      on(name, callback) {
        listeners.set(name, callback);
        return () => listeners.delete(name);
      },
    };
    apply(ctx, { outputRoot: root, runtimeVersion: "0.1.1-rc.2", failClosed: true });
    const secret = "DO NOT EXPORT THIS CONTENT 4981";
    const session = {
      id: "private-session-id",
      header: {
        version: 0,
        id: "private-session-id",
        cwd: "C:/private/workspace",
        createdAt: 1_000,
        agentPreset: "skocase",
      },
      events: [
        { type: "turn/start", seq: 0, time: 1_000, data: { turn: 1 } },
        {
          type: "user/message",
          seq: 1,
          time: 1_010,
          data: { role: "user", content: [{ type: "text", text: secret }] },
        },
        {
          type: "turn/end",
          seq: 2,
          time: 1_020,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      ],
    };
    const flush = listeners.get("session/flush");
    const disposed = listeners.get("session/disposed");
    assert.equal(typeof flush, "function");
    assert.equal(typeof disposed, "function");
    await flush(session);
    await flush(session);
    disposed(session);

    const files = await readdir(root);
    assert.equal(files.length, 1);
    assert.match(files[0], /^[a-f0-9]{24}--2\.dshpack\.json$/u);
    const content = await readFile(join(root, files[0]), "utf8");
    assert.equal(content.includes(secret), false);
    assert.equal(content.includes("private-session-id"), false);
    assert.equal(content.includes("C:/private/workspace"), false);
    const pack = JSON.parse(content);
    assert.equal(pack.report.status, "healthy");
    assert.equal(pack.source.runtimeVersion, "0.1.1-rc.2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the plugin refuses implicit or relative output locations", () => {
  const ctx = { on() {} };
  assert.throws(() => apply(ctx, {}), /explicit outputRoot/u);
  assert.throws(() => apply(ctx, { outputRoot: "relative" }), /must be absolute/u);
});

test("the plugin synchronously preserves a disposal-only failed turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "eversko-dsh-blackbox-disposal-test-"));
  try {
    const listeners = new Map();
    apply(
      {
        on(name, callback) {
          listeners.set(name, callback);
          return () => listeners.delete(name);
        },
      },
      { outputRoot: root, runtimeVersion: "0.1.1-rc.2", failClosed: true },
    );
    const secret = "PRIVATE FAILED TURN 9753";
    listeners.get("session/disposed")({
      id: "failed-session",
      header: {
        version: 0,
        id: "failed-session",
        cwd: "C:/private/failed-workspace",
        createdAt: 2_000,
      },
      events: [
        {
          type: "user/message",
          seq: 0,
          time: 2_000,
          data: { role: "user", content: [{ type: "text", text: secret }] },
        },
      ],
    });

    const files = await readdir(root);
    assert.equal(files.length, 1);
    const content = await readFile(join(root, files[0]), "utf8");
    assert.equal(content.includes(secret), false);
    assert.equal(content.includes("failed-session"), false);
    assert.equal(content.includes("C:/private/failed-workspace"), false);
    assert.equal(JSON.parse(content).report.summary.eventCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
