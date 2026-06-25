import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultPiExtConfig } from "../../core/config";
import type { ModuleApi, PiExtModule } from "../../core/modules";
import { discoverAgentDefinitions } from "./definitions";
import { createAgentsLifecyclePublisher } from "./lifecycle";
import { createNotificationBridge } from "./notifications";
import { createSubagentRunManager } from "./run-manager";
import { createSubagentSessionFactory } from "./session-factory";
import { registerAgentTools } from "./tools";

export interface AgentsModuleOptions {
  agentDir?: string;
}

const ORCHESTRATOR_PROMPT = `You are the orchestrator for this Pi session. When work can be split into independent investigation, planning, review, or implementation subtasks, delegate those subtasks with run_subagent and synthesize the results for the user. Keep the main session focused on coordination, decisions, and final answers. Background subagents will notify you with task ids when they complete, fail, abort, or stall; use get_subagent_result for full output and steer_subagent to redirect live tasks.`;

export const agentsModule = createAgentsModule();

export function createAgentsModule(options: AgentsModuleOptions = {}): PiExtModule {
  return {
    id: "agents",
    label: "In-Process Subagents",
    register(api) {
      registerAgents(api, options);
    },
  };
}

function registerAgents(api: ModuleApi, options: AgentsModuleOptions): void {
  const agentDir = options.agentDir ?? getAgentDir();
  const childSessionIds = new Set<string>();
  const lifecycle = createAgentsLifecyclePublisher((channel, data) => {
    const event = data as { sessionId?: string };
    if (channel === "pi-ext:agents:child:session-created" && event.sessionId) childSessionIds.add(event.sessionId);
    if (channel === "pi-ext:agents:child:disposed" && event.sessionId) childSessionIds.delete(event.sessionId);
    api.pi.events.emit(channel, data);
  });
  const sessionFactory = createSubagentSessionFactory({ agentDir });
  const notificationBridge = createNotificationBridge((message, sendOptions) => api.pi.sendMessage(message, sendOptions));
  const managerConfig = structuredClone(defaultPiExtConfig.modules.agents);
  const syncManagerConfig = (ctx: ExtensionContext) => {
    const next = api.getRuntime(ctx).config.modules.agents;
    managerConfig.maxParallel = next.maxParallel;
    managerConfig.childExtensions = next.childExtensions;
    managerConfig.stall = next.stall;
  };
  const manager = createSubagentRunManager({
    config: managerConfig,
    resolveAgent: (name) => discoverAgentDefinitions(agentDir).agents.find((agent) => agent.name === name),
    sessionFactory,
    lifecycle,
    notify: (record) => notificationBridge.notify(record),
  });

  api.pi.on("before_agent_start", async (event, ctx) => {
    const runtime = api.getRuntime(ctx);
    const config = runtime.config.modules.agents;
    const sessionId = ctx.sessionManager.getSessionId?.();
    if (sessionId && childSessionIds.has(sessionId)) return;
    if (!runtime.config.enabled || !config.enabled || !config.orchestrator.enabled) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${ORCHESTRATOR_PROMPT}` };
  });

  registerAgentTools(api.pi, {
    isEnabled: (ctx: ExtensionContext) => api.isEnabled(ctx, "agents"),
    discover: () => discoverAgentDefinitions(agentDir),
    getConfig: (ctx: ExtensionContext) => {
      syncManagerConfig(ctx);
      return api.getRuntime(ctx).config.modules.agents;
    },
    manager,
  });
}
