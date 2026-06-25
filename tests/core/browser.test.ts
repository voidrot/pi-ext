import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSystemBrowserOpener } from "../../src/core/browser";

interface SpawnCall {
  command: string;
  args: string[];
  options?: { detached?: boolean; stdio?: string };
}

function createSpawnStub(error?: Error) {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: string[], options?: SpawnCall["options"]) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => {};
    queueMicrotask(() => {
      if (error) child.emit("error", error);
      else child.emit("spawn");
    });
    return child;
  };
  return { calls, spawn };
}

test("opens URLs with xdg-open on Linux", async () => {
  const stub = createSpawnStub();
  const open = createSystemBrowserOpener({ platform: "linux", spawn: stub.spawn as never });

  await open("http://127.0.0.1:17380/");

  assert.deepEqual(stub.calls, [
    {
      command: "xdg-open",
      args: ["http://127.0.0.1:17380/"],
      options: { detached: true, stdio: "ignore" },
    },
  ]);
});

test("opens URLs with open on macOS", async () => {
  const stub = createSpawnStub();
  const open = createSystemBrowserOpener({ platform: "darwin", spawn: stub.spawn as never });

  await open("http://127.0.0.1:17380/");

  assert.equal(stub.calls[0].command, "open");
  assert.deepEqual(stub.calls[0].args, ["http://127.0.0.1:17380/"]);
});

test("opens URLs with cmd start on Windows", async () => {
  const stub = createSpawnStub();
  const open = createSystemBrowserOpener({ platform: "win32", spawn: stub.spawn as never });

  await open("http://127.0.0.1:17380/");

  assert.equal(stub.calls[0].command, "cmd");
  assert.deepEqual(stub.calls[0].args, ["/c", "start", "", "http://127.0.0.1:17380/"]);
});

test("rejects when the opener process cannot spawn", async () => {
  const spawnError = new Error("missing opener");
  const stub = createSpawnStub(spawnError);
  const open = createSystemBrowserOpener({ platform: "linux", spawn: stub.spawn as never });

  await assert.rejects(() => open("http://127.0.0.1:17380/"), /missing opener/);
});
