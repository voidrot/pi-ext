export class Logger {
  constructor(private readonly enabled: boolean) {}

  debug(message: string, data?: unknown): void {
    if (!this.enabled) return;
    this.write("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    if (!this.enabled) return;
    this.write("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.write("error", message, data);
  }

  private write(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
    const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
    console.error(`[pi-ext:${level}] ${message}${suffix}`);
  }
}
