import { spawn as defaultSpawn } from "node:child_process";
import type { ChildProcess, spawn as SpawnFunction } from "node:child_process";

export interface BrowserOpenOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof SpawnFunction;
}

export type BrowserOpener = (url: string) => Promise<void>;

export function createSystemBrowserOpener(options: BrowserOpenOptions = {}): BrowserOpener {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? defaultSpawn;

  return (url: string) => {
    const { command, args } = getOpenCommand(platform, url);

    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore" }) as ChildProcess;
      let settled = false;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      child.once("error", (error) => settle(() => reject(error)));
      child.once("spawn", () => settle(resolve));
      child.unref();
    });
  };
}

export const openUrlInBrowser: BrowserOpener = createSystemBrowserOpener();

function getOpenCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}
