import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerPiExtCommands } from "./core/commands";
import { ensureGlobalPiExtConfig } from "./core/config";
import type { ModuleId } from "./core/modules";
import { createRuntimeManager } from "./core/runtime";
import { dcpModule } from "./modules/dcp";

export default function piExt(pi: ExtensionAPI): void {
  ensureGlobalPiExtConfig(getAgentDir());

  const runtime = createRuntimeManager(pi);

  const moduleApi = {
    pi,
    getRuntime: runtime.load,
    isEnabled(ctx: ExtensionContext, moduleId: ModuleId): boolean {
      const config = runtime.load(ctx).config;
      return config.enabled && config.modules[moduleId].enabled;
    },
  };

  registerPiExtCommands(pi, runtime);
  dcpModule.register(moduleApi);

  pi.on("session_start", async (_event, ctx) => {
    runtime.reload(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    runtime.reload(ctx);
  });
}

export type PiExtExtensionContext = ExtensionContext;
