import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openUrlInBrowser, type BrowserOpener } from "../../core/browser";
import type { DashboardModuleConfig } from "../../core/config";
import type { ModuleApi, PiExtModule } from "../../core/modules";
import { DashboardServer, type DashboardServerConfig, type DashboardServerSnapshot, type DashboardServerState } from "./server";

interface DashboardServerLike {
  start(snapshot: DashboardServerSnapshot): Promise<DashboardServerState>;
  updateSnapshot(snapshot: DashboardServerSnapshot): void;
  stop(): Promise<void>;
  getState(): DashboardServerState | undefined;
}

export interface DashboardModuleOptions {
  createServer?: (config: DashboardServerConfig) => DashboardServerLike;
  openBrowser?: BrowserOpener;
}

export const dashboardModule = createDashboardModule();

export function createDashboardModule(options: DashboardModuleOptions = {}): PiExtModule {
  return {
    id: "dashboard",
    label: "Pi Ext Dashboard",
    register(api) {
      registerDashboard(api, options);
    },
  };
}

function registerDashboard(api: ModuleApi, options: DashboardModuleOptions): void {
  const createServer = options.createServer ?? ((config: DashboardServerConfig) => new DashboardServer(config));
  const openBrowser = options.openBrowser ?? openUrlInBrowser;
  let server: DashboardServerLike | undefined;
  let serverConfigKey: string | undefined;

  const stopServer = async (): Promise<void> => {
    const current = server;
    server = undefined;
    serverConfigKey = undefined;
    await current?.stop();
  };

  const ensureServer = async (ctx: ExtensionContext, openReason: "start" | "session-change" | "manual" | "none") => {
    const runtime = api.getRuntime(ctx);
    const config = runtime.config.modules.dashboard;
    if (!runtime.config.enabled || !config.enabled || !api.isEnabled(ctx, "dashboard")) {
      await stopServer();
      return;
    }

    const nextServerConfigKey = JSON.stringify(config.server);
    if (server && serverConfigKey !== nextServerConfigKey) {
      await stopServer();
    }

    const snapshot = await createSnapshot(api, ctx);
    let state = server?.getState();

    if (!server) {
      server = createServer(config.server);
      serverConfigKey = nextServerConfigKey;
      state = await server.start(snapshot);
    } else {
      server.updateSnapshot(snapshot);
      state = server.getState();
    }

    if (!state) return;

    const shouldOpen = shouldOpenBrowser(config, openReason);
    if (!shouldOpen) return;

    try {
      await openBrowser(state.url);
    } catch (error) {
      runtime.logger.warn("Dashboard server started, but opening the browser failed", { error: String(error) });
    }
  };

  const runDashboardAction = async (
    ctx: ExtensionContext,
    openReason: "start" | "session-change" | "manual" | "none",
  ): Promise<void> => {
    try {
      await ensureServer(ctx, openReason);
    } catch (error) {
      api.getRuntime(ctx).logger.warn("Dashboard server failed to start or update", { error: String(error) });
    }
  };

  api.pi.on("session_start", async (_event, ctx) => {
    await runDashboardAction(ctx, "start");
  });

  api.pi.on("session_tree", async (_event, ctx) => {
    await runDashboardAction(ctx, "session-change");
  });

  api.pi.on("session_shutdown", async () => {
    await stopServer();
  });

  api.onRuntimeReload((_runtime, ctx) => {
    void runDashboardAction(ctx, "none");
  });

  api.pi.registerCommand("dashboard", {
    description: "Open the local Pi Ext dashboard",
    handler: async (_args, ctx) => {
      await runDashboardAction(ctx, "manual");
    },
  });
}

async function createSnapshot(api: ModuleApi, ctx: ExtensionContext): Promise<DashboardServerSnapshot> {
  const runtime = api.getRuntime(ctx);
  const databases = await api.getDatabases(ctx);
  const projectTrusted = typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;

  return {
    cwd: ctx.cwd,
    projectTrusted,
    sessionFile: runtime.sessionFile ?? ctx.sessionManager.getSessionFile?.(),
    debug: runtime.config.debug,
    enabled: runtime.config.enabled,
    modules: {
      dcp: runtime.config.modules.dcp.enabled,
      dashboard: runtime.config.modules.dashboard.enabled,
    },
    globalDatabasePath: databases.global.path,
    projectDatabasePath: databases.project?.path,
  };
}

function shouldOpenBrowser(config: DashboardModuleConfig, reason: "start" | "session-change" | "manual" | "none"): boolean {
  if (reason === "manual") return true;
  if (reason === "start") return config.browser.openOnStart;
  if (reason === "session-change") return config.browser.reopenOnSessionChange;
  return false;
}
