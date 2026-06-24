import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export class Logger {
  private readonly path: string;

  constructor(
    private readonly enabled: boolean,
    logPath?: string,
  ) {
    this.path =
      logPath ??
      join(
        process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
        "pi-dcp",
        "logs",
        "pi-dcp.log",
      );
  }

  debug(message: string, details?: unknown): void {
    this.write("debug", message, details);
  }

  info(message: string, details?: unknown): void {
    this.write("info", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write("warn", message, details);
  }

  error(message: string, details?: unknown): void {
    this.write("error", message, details);
  }

  private write(level: string, message: string, details?: unknown): void {
    if (!this.enabled) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        details,
      }) + "\n";
    appendFileSync(this.path, line, "utf8");
  }
}
