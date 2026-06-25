import { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { createDashboardStatus, renderDashboardHtml, type DashboardStatusPayload } from "./render";
import { createDashboardMemoriesPayload, selectDashboardMemoryScope, type DashboardMemoriesPayload, type DashboardMemoryScope } from "./memories";
import { renderDashboardMemoriesHtml } from "./memory-render";
import type { DashboardModuleConfig } from "../../core/config";

export type DashboardServerConfig = DashboardModuleConfig["server"];

export interface DashboardServerSnapshot {
  cwd: string;
  projectTrusted: boolean;
  sessionFile?: string;
  debug: boolean;
  enabled: boolean;
  modules: {
    dcp: boolean;
    dashboard: boolean;
  };
  globalDatabasePath: string;
  projectDatabasePath?: string;
}

export interface DashboardServerState {
  instanceId: string;
  startedAt: Date;
  host: string;
  port: number;
  url: string;
}

export interface DashboardAppOptions {
  getStatus: () => DashboardStatusPayload;
  getMemories?: (scope: DashboardMemoryScope) => Promise<DashboardMemoriesPayload>;
}

export interface DashboardServerOptions {
  getMemories?: (scope: DashboardMemoryScope) => Promise<DashboardMemoriesPayload>;
}

const statusBeforeStartupMessage = "Dashboard server status requested before startup";

export function createDashboardApp(options: DashboardAppOptions): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/api/status", (c) => {
    const status = getStatusOrStartup(options.getStatus);
    if (!status) {
      return c.body(JSON.stringify({ status: "starting" }), 503, { "content-type": "application/json; charset=utf-8" });
    }
    return c.body(JSON.stringify(status), 200, { "content-type": "application/json; charset=utf-8" });
  });

  app.get("/api/memories", async (c) => {
    const memories = await getMemories(options, "combined");
    return c.body(JSON.stringify(memories), 200, { "content-type": "application/json; charset=utf-8" });
  });

  app.get("/api/memories/:scope", async (c) => {
    const memories = await getMemories(options, selectDashboardMemoryScope(c.req.param("scope")));
    return c.body(JSON.stringify(memories), 200, { "content-type": "application/json; charset=utf-8" });
  });

  app.get("/memories", async (c) => c.html(renderDashboardMemoriesHtml(await getMemories(options, "combined"))));

  app.get("/memories/:scope", async (c) => {
    const memories = await getMemories(options, selectDashboardMemoryScope(c.req.param("scope")));
    return c.html(renderDashboardMemoriesHtml(memories));
  });

  app.get("/", (c) => {
    const status = getStatusOrStartup(options.getStatus);
    if (!status) return c.html("<!doctype html><title>Pi Ext Dashboard</title><h1>Dashboard starting</h1>", 503);
    return c.html(renderDashboardHtml(status));
  });

  app.notFound((c) => c.text("not found", 404));

  return app;
}

async function getMemories(options: DashboardAppOptions, scope: DashboardMemoryScope): Promise<DashboardMemoriesPayload> {
  if (options.getMemories) return options.getMemories(scope);
  return createDashboardMemoriesPayload({
    selectedScope: scope,
    memories: { global: [], project: [], session: [] },
  });
}

function getStatusOrStartup(getStatus: () => DashboardStatusPayload): DashboardStatusPayload | undefined {
  try {
    return getStatus();
  } catch (error) {
    if (error instanceof Error && error.message === statusBeforeStartupMessage) return undefined;
    throw error;
  }
}

export class DashboardServer {
  private server: Server | undefined;
  private state: DashboardServerState | undefined;
  private snapshot: DashboardServerSnapshot | undefined;

  constructor(private readonly config: DashboardServerConfig, private readonly options: DashboardServerOptions = {}) {}

  async start(snapshot: DashboardServerSnapshot): Promise<DashboardServerState> {
    this.snapshot = snapshot;
    if (this.server && this.state) return this.state;

    const ports = this.config.port === "auto" ? getPortRange(this.config.portRange.start, this.config.portRange.end) : [this.config.port];
    const errors: unknown[] = [];

    for (const port of ports) {
      try {
        const app = createDashboardApp({ getStatus: () => this.createStatus(), getMemories: this.options.getMemories });
        const server = createAdaptorServer({ fetch: app.fetch }) as Server;
        await listen(server, this.config.host, port);
        const address = server.address();
        if (!address || typeof address !== "object") throw new Error("Dashboard server did not bind to a TCP port");

        const state: DashboardServerState = {
          instanceId: randomUUID(),
          startedAt: new Date(),
          host: this.config.host,
          port: address.port,
          url: `http://${this.config.host}:${address.port}/`,
        };
        this.server = server;
        this.state = state;
        return state;
      } catch (error) {
        errors.push(error);
        if (this.config.port !== "auto") break;
      }
    }

    throw new Error(`Unable to start dashboard server on ${this.config.host}: ${formatPortConfig(this.config)}`, {
      cause: errors.at(-1),
    });
  }

  updateSnapshot(snapshot: DashboardServerSnapshot): void {
    this.snapshot = snapshot;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.state = undefined;
    this.snapshot = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  getState(): DashboardServerState | undefined {
    return this.state;
  }

  private createStatus(): DashboardStatusPayload {
    if (!this.state || !this.snapshot) {
      throw new Error(statusBeforeStartupMessage);
    }

    return createDashboardStatus({
      instanceId: this.state.instanceId,
      startedAt: this.state.startedAt,
      url: this.state.url,
      host: this.state.host,
      port: this.state.port,
      cwd: this.snapshot.cwd,
      projectTrusted: this.snapshot.projectTrusted,
      sessionFile: this.snapshot.sessionFile,
      debug: this.snapshot.debug,
      enabled: this.snapshot.enabled,
      modules: this.snapshot.modules,
      globalDatabasePath: this.snapshot.globalDatabasePath,
      projectDatabasePath: this.snapshot.projectDatabasePath,
    });
  }
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function getPortRange(start: number, end: number): number[] {
  const first = Math.min(start, end);
  const last = Math.max(start, end);
  const ports: number[] = [];
  for (let port = first; port <= last; port++) ports.push(port);
  return ports;
}

function formatPortConfig(config: DashboardServerConfig): string {
  return config.port === "auto" ? `${config.portRange.start}-${config.portRange.end}` : String(config.port);
}

