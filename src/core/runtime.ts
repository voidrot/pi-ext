import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadPiExtConfig, type PiExtConfig } from "./config";
import { Logger } from "./logger";
import { reconcileActiveTools } from "./tools";

export interface PiExtRuntime {
  config: PiExtConfig;
  logger: Logger;
  sessionFile?: string;
}

export interface RuntimeManagerOptions {
  agentDir?: string;
}

export interface RuntimeManager {
  load(ctx: ExtensionContext): PiExtRuntime;
  reload(ctx: ExtensionContext): PiExtRuntime;
  syncTools(): void;
}

export function createRuntimeManager(pi: ExtensionAPI, options: RuntimeManagerOptions = {}): RuntimeManager {
  let runtime: PiExtRuntime | undefined;

  function load(ctx: ExtensionContext): PiExtRuntime {
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    if (runtime && runtime.sessionFile === sessionFile) return runtime;

    const next = buildRuntime(ctx, sessionFile);
    runtime = next;
    syncTools();
    return next;
  }

  function reload(ctx: ExtensionContext): PiExtRuntime {
    runtime = undefined;
    return load(ctx);
  }

  function syncTools(): void {
    if (!runtime) return;
    pi.setActiveTools(reconcileActiveTools(pi.getActiveTools(), runtime.config));
  }

  function buildRuntime(ctx: ExtensionContext, sessionFile: string | undefined): PiExtRuntime {
    const projectTrusted = typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
    const config = loadPiExtConfig({
      cwd: ctx.cwd,
      agentDir: options.agentDir ?? getAgentDir(),
      projectTrusted,
    });
    const logger = new Logger(config.debug);
    return { config, logger, sessionFile };
  }

  return { load, reload, syncTools };
}
