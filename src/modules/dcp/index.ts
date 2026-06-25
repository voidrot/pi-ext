import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModuleApi, PiExtModule } from "../../core/modules";
import type { PiExtConfig } from "../../core/config";
import { handleDcpCommand, sendCompressPrompt } from "./commands";
import { mergeDcpConfig, type DcpConfig } from "./config";
import { transformMessagesForContext } from "./context/transform";
import { Logger } from "./logger";
import { createFramesFromMessages } from "./pi/branch";
import { SYSTEM_PROMPT } from "./prompts";
import { appendStateEntry, createInitialState, restoreStateFromBranch } from "./state/store";
import type { DcpState } from "./state/types";
import { registerCompressTool } from "./tools/compress";
import { clearDcpWidget, showDcpStatsOverlay, syncDcpWidget } from "./ui";

interface Runtime {
  config: DcpConfig;
  state: DcpState;
  logger: Logger;
  loadedForSessionFile?: string;
  coreConfig: PiExtConfig;
}

export const dcpModule: PiExtModule = {
  id: "dcp",
  label: "Dynamic Context Pruning",
  register(api) {
    registerDcp(api);
  },
};

function registerDcp(api: ModuleApi): void {
  const { pi } = api;
  let runtime: Runtime | undefined;

  const getRuntime = (ctx: ExtensionContext): Runtime => {
    const core = api.getRuntime(ctx);
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    if (!runtime || runtime.loadedForSessionFile !== sessionFile || runtime.coreConfig !== core.config) {
      const config = mergeDcpConfig(core.config.modules.dcp.config);
      config.enabled = core.config.enabled && core.config.modules.dcp.enabled;
      config.debug = config.debug || core.config.debug;
      if (!core.config.modules.dcp.tools.compress.enabled) {
        config.compress.permission = "deny";
      }

      const restoredState = restoreStateFromBranch(ctx.sessionManager.getBranch?.() ?? []) || createInitialState();
      if (restoredState.blocks.size === 0) restoredState.manualMode = config.manualMode.enabled;

      runtime = {
        config,
        state: restoredState,
        logger: new Logger(config.debug),
        loadedForSessionFile: sessionFile,
        coreConfig: core.config,
      };
      runtime.logger.info("Pi DCP runtime loaded", { sessionFile });
    }
    return runtime;
  };

  const refreshWidget = (ctx: ExtensionContext, current: Runtime): void => {
    if (!current.config.enabled) {
      clearDcpWidget(ctx);
      return;
    }
    syncDcpWidget(ctx, current.state, current.config.ui);
  };

  pi.on("session_start", async (_event, ctx) => {
    runtime = undefined;
    refreshWidget(ctx, getRuntime(ctx));
  });

  pi.on("session_tree", async (_event, ctx) => {
    runtime = undefined;
    refreshWidget(ctx, getRuntime(ctx));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearDcpWidget(ctx);
  });

  api.onRuntimeReload((_coreRuntime, ctx) => {
    runtime = undefined;
    refreshWidget(ctx, getRuntime(ctx));
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled || current.config.compress.permission === "deny") return;
    return { systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_PROMPT}` };
  });

  pi.on("context", async (event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    const branch = ctx.sessionManager.getBranch?.() ?? [];
    const frames = createFramesFromMessages(event.messages, branch);
    const usage = ctx.getContextUsage?.();
    const contextWindow = ctx.model?.contextWindow as number | undefined;
    return transformMessagesForContext({
      messages: event.messages,
      frames,
      state: current.state,
      usageTokens: typeof usage?.tokens === "number" ? usage.tokens : null,
      contextWindow,
      config: current.config,
    });
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    current.state.toolCalls.set(event.toolCallId, {
      id: event.toolCallId,
      toolName: event.toolName,
      turn: current.state.turnCounter,
      status: "running",
    });
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    const existing = current.state.toolCalls.get(event.toolCallId);
    current.state.toolCalls.set(event.toolCallId, {
      id: event.toolCallId,
      toolName: event.toolName,
      turn: existing?.turn ?? current.state.turnCounter,
      status: event.isError ? "error" : "completed",
    });
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!api.isEnabled(ctx, "dcp")) return;
    const current = getRuntime(ctx);
    if (!current.config.enabled) return;
    current.state.turnCounter += 1;
    appendStateEntry(pi, current.state);
    refreshWidget(ctx, current);
  });

  pi.registerCommand("dcp", {
    description: "Show or control Pi DCP status",
    handler: async (args, ctx) => {
      if (!api.isEnabled(ctx, "dcp")) return;
      const current = getRuntime(ctx);
      if (!current.config.enabled) return;
      await handleDcpCommand(pi, args, ctx, current.state);
    },
  });

  pi.registerCommand("dcp-stats", {
    description: "Open high-definition Pi DCP compression stats",
    handler: async (_args, ctx) => {
      if (!api.isEnabled(ctx, "dcp")) return;
      const current = getRuntime(ctx);
      if (!current.config.enabled) return;
      await showDcpStatsOverlay(ctx, current.state);
    },
  });

  pi.registerCommand("dcp-compress", {
    description: "Ask the model to run one Pi DCP compression pass",
    handler: async (args, ctx) => {
      if (!api.isEnabled(ctx, "dcp")) return;
      const current = getRuntime(ctx);
      if (!current.config.enabled || current.config.compress.permission === "deny") return;
      sendCompressPrompt(pi, args, ctx);
    },
  });

  registerCompressTool(pi, (ctx) => getRuntime(ctx));
}
