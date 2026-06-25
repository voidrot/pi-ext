import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModuleApi, PiExtModule } from "../../core/modules";
import { registerMemoryDatabaseMigrations, type MemoryMigrationRegistry } from "./models";
import { formatMemoryPrompt } from "./prompt";
import { listMemoriesForPrompt as defaultListMemoriesForPrompt } from "./repository";
import { registerMemoryTools } from "./tools";
import { createEmbeddingProvider } from "./vector";
import { MemoryVectorBackgroundWorker } from "./vector-worker";

export interface MemoryModuleOptions {
  listMemoriesForPrompt?: typeof defaultListMemoriesForPrompt;
}

export const memoryModule = createMemoryModule();

export function createMemoryModule(options: MemoryModuleOptions = {}): PiExtModule {
  return {
    id: "memory",
    label: "Memory",
    register(api) {
      registerMemory(api, options);
    },
  };
}

function registerMemory(api: ModuleApi, options: MemoryModuleOptions): void {
  const listMemoriesForPrompt = options.listMemoriesForPrompt ?? defaultListMemoriesForPrompt;
  const registry: MemoryMigrationRegistry = {
    register(scope, moduleId, migrations) {
      api.registerDatabaseMigrations(scope, moduleId as "memory", migrations);
    },
  };

  registerMemoryDatabaseMigrations(registry);

  const vectorWorker = new MemoryVectorBackgroundWorker({
    getProvider: (ctx: ExtensionContext) => createEmbeddingProvider(api.getRuntime(ctx).config.modules.memory.vector),
    getBatchSize: (ctx: ExtensionContext) => api.getRuntime(ctx).config.modules.memory.vector.background.batchSize,
  });

  registerMemoryTools(api.pi, {
    isEnabled: (ctx: ExtensionContext) => api.isEnabled(ctx, "memory"),
    getDatabases: (ctx: ExtensionContext) => api.getDatabases(ctx),
    getVectorSearchLimit: (ctx: ExtensionContext) => api.getRuntime(ctx).config.modules.memory.vector.searchLimit,
    enqueueVectorWork: (ctx, handles) => {
      const config = api.getRuntime(ctx).config.modules.memory.vector;
      if (config.enabled && config.background.enabled) vectorWorker.enqueue(ctx, handles);
    },
    embedText: (ctx, text, signal) => vectorWorker.embedText(ctx, text, signal),
  });

  api.pi.on("before_agent_start", async (event, ctx) => {
    const runtime = api.getRuntime(ctx);
    const config = runtime.config.modules.memory;
    if (!runtime.config.enabled || !config.enabled || !config.prompt.enabled || !api.isEnabled(ctx, "memory")) return;

    const handles = await api.getDatabases(ctx);
    const memories = await listMemoriesForPrompt(handles, {
      sessionId: ctx.sessionManager.getSessionId(),
      limitPerScope: config.prompt.maxMemoriesPerScope,
    });
    const prompt = formatMemoryPrompt(memories, { maxContentChars: config.prompt.maxContentChars });
    if (!prompt) return;

    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });
}
