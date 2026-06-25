import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentsChildExtensionMode } from "../../core/config";
import type { AgentDefinition, AgentThinkingLevel } from "./definitions";
import { deriveSubagentSessionDir } from "./session-dir";

export interface ResourceLoaderLike {
  reload(): Promise<void>;
}

export interface SessionManagerLike {
  newSession(opts?: { parentSession?: string }): void;
  getSessionFile(): string | undefined;
  getSessionId(): string;
}

export interface CreateSubagentSessionParams {
  cwd: string;
  agent: AgentDefinition;
  parentSessionFile?: string;
  parentSessionId?: string;
  parentModel: unknown;
  modelRegistry: { find(provider: string, modelId: string): unknown } | undefined;
  extensionMode: AgentsChildExtensionMode;
  recursiveToolDenylist: string[];
}

export interface CreatedSubagentSession {
  session: AgentSession;
  sessionId: string;
  sessionDir: string;
  transcriptPath?: string;
}

export interface SubagentSessionFactoryDeps {
  agentDir: string;
  createResourceLoader?: (opts: any) => ResourceLoaderLike;
  createSessionManager?: (cwd: string, sessionDir: string) => SessionManagerLike;
  createSettingsManager?: (cwd: string, agentDir: string) => unknown;
  createSession?: (opts: any) => Promise<{ session: AgentSession }>;
}

export interface SubagentSessionFactory {
  create(params: CreateSubagentSessionParams): Promise<CreatedSubagentSession>;
}

export function createSubagentSessionFactory(deps: SubagentSessionFactoryDeps): SubagentSessionFactory {
  return {
    async create(params) {
      const sessionDir = deriveSubagentSessionDir(params.parentSessionFile, params.cwd);
      const loader = (deps.createResourceLoader ?? createDefaultResourceLoader)({
        cwd: params.cwd,
        agentDir: deps.agentDir,
        noExtensions: params.extensionMode === "none",
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPromptOverride: () => params.agent.systemPrompt,
        appendSystemPromptOverride: () => [],
      });
      await loader.reload();

      const sessionManager = (deps.createSessionManager ?? createDefaultSessionManager)(params.cwd, sessionDir);
      sessionManager.newSession({ parentSession: params.parentSessionId });
      const toolNames = filterDeniedTools(params.agent.tools, params.recursiveToolDenylist);
      const model = resolveModel(params.agent.model, params.modelRegistry) ?? params.parentModel;

      const { session } = await (deps.createSession ?? createAgentSession)({
        cwd: params.cwd,
        agentDir: deps.agentDir,
        sessionManager,
        settingsManager: (deps.createSettingsManager ?? createDefaultSettingsManager)(params.cwd, deps.agentDir),
        modelRegistry: params.modelRegistry,
        model,
        tools: toolNames,
        resourceLoader: loader,
        thinkingLevel: params.agent.thinking as AgentThinkingLevel | undefined,
      });

      if (params.extensionMode === "inherit-safe") {
        await session.bindExtensions({});
      }
      applyRecursionGuard(session, params.recursiveToolDenylist);

      return {
        session,
        sessionId: sessionManager.getSessionId(),
        sessionDir,
        transcriptPath: sessionManager.getSessionFile(),
      };
    },
  };
}

export function applyRecursionGuard(session: Pick<AgentSession, "getActiveToolNames" | "setActiveToolsByName">, denylist: string[]): void {
  const denied = new Set(denylist);
  session.setActiveToolsByName(session.getActiveToolNames().filter((tool) => !denied.has(tool)));
}

export function filterDeniedTools(tools: string[], denylist: string[]): string[] {
  const denied = new Set(denylist);
  return tools.filter((tool) => !denied.has(tool));
}

function createDefaultResourceLoader(opts: any): ResourceLoaderLike {
  return new DefaultResourceLoader(opts);
}

function createDefaultSessionManager(cwd: string, sessionDir: string): SessionManagerLike {
  return SessionManager.create(cwd, sessionDir);
}

function createDefaultSettingsManager(cwd: string, agentDir: string): unknown {
  return SettingsManager.create(cwd, agentDir);
}

function resolveModel(modelRef: string | undefined, registry: { find(provider: string, modelId: string): unknown } | undefined): unknown {
  if (!modelRef || !registry) return undefined;
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) return undefined;
  return registry.find(modelRef.slice(0, slash), modelRef.slice(slash + 1));
}
