import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RuntimeManager } from "./runtime";

export type PiExtCommandAction = "status" | "config" | "reload" | "help";

export function parsePiExtCommand(args: string): PiExtCommandAction {
  const first = args.trim().split(/\s+/)[0] || "status";
  if (first === "status" || first === "config" || first === "reload") return first;
  return "help";
}

export function registerPiExtCommands(pi: ExtensionAPI, runtime: RuntimeManager): void {
  pi.registerCommand("pi-ext", {
    description: "Show and reload @voidrot/pi-ext configuration",
    handler: async (args, ctx) => {
      const action = parsePiExtCommand(args);

      if (action === "reload") {
        const current = runtime.reload(ctx);
        ctx.ui.notify(`pi-ext config reloaded. enabled=${current.config.enabled}`, "info");
        return;
      }

      const current = runtime.load(ctx);

      if (action === "config") {
        ctx.ui.notify(JSON.stringify(current.config, null, 2), "info");
        return;
      }

      if (action === "status") {
        const dcp = current.config.modules.dcp;
        ctx.ui.notify(
          `pi-ext enabled=${current.config.enabled}; dcp=${dcp.enabled}; compress=${dcp.tools.compress.enabled}`,
          "info",
        );
        return;
      }

      ctx.ui.notify("Usage: /pi-ext [status|config|reload]", "warning");
    },
  });
}
