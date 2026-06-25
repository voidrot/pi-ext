import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { parse } from "jsonc-parser";

export interface ToolToggleConfig {
  enabled: boolean;
}

export interface DcpModuleConfig {
  enabled: boolean;
  tools: {
    compress: ToolToggleConfig;
  };
  config: Record<string, unknown>;
}

export interface DashboardModuleConfig {
  enabled: boolean;
  server: {
    host: string;
    port: number | "auto";
    portRange: {
      start: number;
      end: number;
    };
  };
  browser: {
    openOnStart: boolean;
    reopenOnSessionChange: boolean;
  };
}

export type AgentsChildExtensionMode = "inherit-safe" | "none";

export interface AgentsModuleConfig {
  enabled: boolean;
  orchestrator: {
    enabled: boolean;
  };
  tools: {
    runSubagent: ToolToggleConfig;
    getSubagentResult: ToolToggleConfig;
    steerSubagent: ToolToggleConfig;
  };
  maxParallel: number;
  defaultBackground: boolean;
  childExtensions: {
    mode: AgentsChildExtensionMode;
    recursiveToolDenylist: string[];
  };
  transcripts: {
    persist: boolean;
  };
  stall: {
    enabled: boolean;
    timeoutMs: number;
    notify: boolean;
    abortAfterMs?: number;
  };
}

export interface MemoryModuleConfig {
  enabled: boolean;
  prompt: {
    enabled: boolean;
    maxMemoriesPerScope: number;
    maxContentChars: number;
  };
  tools: {
    createGlobalMemory: ToolToggleConfig;
    createProjectMemory: ToolToggleConfig;
    createSessionMemory: ToolToggleConfig;
    searchMemories: ToolToggleConfig;
  };
  vector: {
    enabled: boolean;
    provider: "local" | "ollama";
    dimensions: 256;
    searchLimit: number;
    background: {
      enabled: boolean;
      batchSize: number;
    };
    ollama: {
      endpoint: string;
      model: string;
      timeoutMs: number;
      keepAlive?: string;
    };
  };
}

export interface PiExtConfig {
  enabled: boolean;
  debug: boolean;
  modules: {
    dcp: DcpModuleConfig;
    dashboard: DashboardModuleConfig;
    agents: AgentsModuleConfig;
    memory: MemoryModuleConfig;
  };
}

export interface LoadPiExtConfigOptions {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}

export interface EnsureGlobalPiExtConfigResult {
  created: boolean;
  path: string;
}

export const PI_EXT_SCHEMA_URL = "https://raw.githubusercontent.com/voidrot/pi-ext/main/schema/pi-ext.schema.json";

export const defaultPiExtConfig: PiExtConfig = {
  enabled: true,
  debug: false,
  modules: {
    dcp: {
      enabled: true,
      tools: {
        compress: { enabled: true },
      },
      config: {},
    },
    dashboard: {
      enabled: true,
      server: {
        host: "127.0.0.1",
        port: "auto",
        portRange: {
          start: 17380,
          end: 17480,
        },
      },
      browser: {
        openOnStart: true,
        reopenOnSessionChange: false,
      },
    },
    agents: {
      enabled: true,
      orchestrator: { enabled: true },
      tools: {
        runSubagent: { enabled: true },
        getSubagentResult: { enabled: true },
        steerSubagent: { enabled: true },
      },
      maxParallel: 4,
      defaultBackground: false,
      childExtensions: {
        mode: "inherit-safe",
        recursiveToolDenylist: ["run_subagent", "get_subagent_result", "steer_subagent"],
      },
      transcripts: { persist: true },
      stall: {
        enabled: true,
        timeoutMs: 120_000,
        notify: true,
      },
    },
    memory: {
      enabled: true,
      prompt: {
        enabled: true,
        maxMemoriesPerScope: 12,
        maxContentChars: 500,
      },
      tools: {
        createGlobalMemory: { enabled: true },
        createProjectMemory: { enabled: true },
        createSessionMemory: { enabled: true },
        searchMemories: { enabled: true },
      },
      vector: {
        enabled: true,
        provider: "local",
        dimensions: 256,
        searchLimit: 8,
        background: {
          enabled: true,
          batchSize: 10,
        },
        ollama: {
          endpoint: "http://127.0.0.1:11434",
          model: "nomic-embed-text",
          timeoutMs: 30_000,
        },
      },
    },
  },
};

export function ensureGlobalPiExtConfig(agentDir: string): EnsureGlobalPiExtConfigResult {
  const jsonPath = join(agentDir, "pi-ext.json");
  if (existsSync(jsonPath)) return { created: false, path: jsonPath };

  const jsoncPath = join(agentDir, "pi-ext.jsonc");
  if (existsSync(jsoncPath)) return { created: false, path: jsoncPath };

  mkdirSync(agentDir, { recursive: true });
  writeFileSync(jsoncPath, `{\n  "$schema": "${PI_EXT_SCHEMA_URL}"\n}\n`, "utf8");
  return { created: true, path: jsoncPath };
}

export function loadPiExtConfig(options: LoadPiExtConfigOptions): PiExtConfig {
  let config = clone(defaultPiExtConfig);

  for (const path of getPiExtConfigPaths(options)) {
    if (!existsSync(path)) continue;
    const parsed = parse(readFileSync(path, "utf8"));
    if (!isPlainObject(parsed)) continue;
    config = mergePiExtConfig(config, parsed);
  }

  return config;
}

export function getPiExtConfigPaths(options: LoadPiExtConfigOptions): string[] {
  const paths = [join(options.agentDir, "pi-ext.json"), join(options.agentDir, "pi-ext.jsonc")];

  if (options.projectTrusted) {
    paths.push(
      join(options.cwd, CONFIG_DIR_NAME, "pi-ext.json"),
      join(options.cwd, CONFIG_DIR_NAME, "pi-ext.jsonc"),
    );
  }

  return paths;
}

export function mergePiExtConfig(base: PiExtConfig, override: unknown): PiExtConfig {
  const expandedOverride = expandDcpConfigShorthand(override);
  const merged = deepMerge(base, expandedOverride);
  return normalizeConfig(merged);
}

function expandDcpConfigShorthand(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  if (!isPlainObject(value.dcp)) return value;

  const expanded = clone(value);
  const modules = isPlainObject(expanded.modules) ? expanded.modules : {};
  const dcpModule = isPlainObject(modules.dcp) ? modules.dcp : {};
  const dcpConfig = isPlainObject(dcpModule.config) ? dcpModule.config : {};

  expanded.modules = {
    ...modules,
    dcp: {
      ...dcpModule,
      config: deepMerge(expanded.dcp, dcpConfig),
    },
  };
  delete expanded.dcp;

  return expanded;
}

function normalizeConfig(value: unknown): PiExtConfig {
  const source = deepMerge(defaultPiExtConfig, isPlainObject(value) ? value : {});
  const dcp: Record<string, any> = isPlainObject(source.modules?.dcp) ? source.modules.dcp : {};
  const dcpTools: Record<string, any> = isPlainObject(dcp.tools) ? dcp.tools : {};
  const compressTool: Record<string, any> = isPlainObject(dcpTools.compress) ? dcpTools.compress : {};
  const moduleDcpConfig: Record<string, any> = isPlainObject(dcp.config) ? dcp.config : {};
  const dashboard: Record<string, any> = isPlainObject(source.modules?.dashboard) ? source.modules.dashboard : {};
  const dashboardServer: Record<string, any> = isPlainObject(dashboard.server) ? dashboard.server : {};
  const dashboardPortRange: Record<string, any> = isPlainObject(dashboardServer.portRange) ? dashboardServer.portRange : {};
  const dashboardBrowser: Record<string, any> = isPlainObject(dashboard.browser) ? dashboard.browser : {};
  const agents: Record<string, any> = isPlainObject(source.modules?.agents) ? source.modules.agents : {};
  const agentsOrchestrator: Record<string, any> = isPlainObject(agents.orchestrator) ? agents.orchestrator : {};
  const agentsTools: Record<string, any> = isPlainObject(agents.tools) ? agents.tools : {};
  const agentsRunSubagentTool: Record<string, any> = isPlainObject(agentsTools.runSubagent) ? agentsTools.runSubagent : {};
  const agentsGetResultTool: Record<string, any> = isPlainObject(agentsTools.getSubagentResult) ? agentsTools.getSubagentResult : {};
  const agentsSteerTool: Record<string, any> = isPlainObject(agentsTools.steerSubagent) ? agentsTools.steerSubagent : {};
  const childExtensions: Record<string, any> = isPlainObject(agents.childExtensions) ? agents.childExtensions : {};
  const transcripts: Record<string, any> = isPlainObject(agents.transcripts) ? agents.transcripts : {};
  const stall: Record<string, any> = isPlainObject(agents.stall) ? agents.stall : {};
  const memory: Record<string, any> = isPlainObject(source.modules?.memory) ? source.modules.memory : {};
  const memoryPrompt: Record<string, any> = isPlainObject(memory.prompt) ? memory.prompt : {};
  const memoryTools: Record<string, any> = isPlainObject(memory.tools) ? memory.tools : {};
  const createGlobalMemoryTool: Record<string, any> = isPlainObject(memoryTools.createGlobalMemory) ? memoryTools.createGlobalMemory : {};
  const createProjectMemoryTool: Record<string, any> = isPlainObject(memoryTools.createProjectMemory) ? memoryTools.createProjectMemory : {};
  const createSessionMemoryTool: Record<string, any> = isPlainObject(memoryTools.createSessionMemory) ? memoryTools.createSessionMemory : {};
  const searchMemoriesTool: Record<string, any> = isPlainObject(memoryTools.searchMemories) ? memoryTools.searchMemories : {};
  const memoryVector: Record<string, any> = isPlainObject(memory.vector) ? memory.vector : {};
  const memoryVectorBackground: Record<string, any> = isPlainObject(memoryVector.background) ? memoryVector.background : {};
  const memoryVectorOllama: Record<string, any> = isPlainObject(memoryVector.ollama) ? memoryVector.ollama : {};

  return {
    enabled: boolOr(source.enabled, defaultPiExtConfig.enabled),
    debug: boolOr(source.debug, defaultPiExtConfig.debug),
    modules: {
      dcp: {
        enabled: boolOr(dcp.enabled, defaultPiExtConfig.modules.dcp.enabled),
        tools: {
          compress: {
            enabled: boolOr(compressTool.enabled, defaultPiExtConfig.modules.dcp.tools.compress.enabled),
          },
        },
        config: clone(moduleDcpConfig),
      },
      dashboard: {
        enabled: boolOr(dashboard.enabled, defaultPiExtConfig.modules.dashboard.enabled),
        server: {
          host: stringOr(dashboardServer.host, defaultPiExtConfig.modules.dashboard.server.host),
          port: portOr(dashboardServer.port, defaultPiExtConfig.modules.dashboard.server.port),
          portRange: {
            start: numberOr(dashboardPortRange.start, defaultPiExtConfig.modules.dashboard.server.portRange.start),
            end: numberOr(dashboardPortRange.end, defaultPiExtConfig.modules.dashboard.server.portRange.end),
          },
        },
        browser: {
          openOnStart: boolOr(dashboardBrowser.openOnStart, defaultPiExtConfig.modules.dashboard.browser.openOnStart),
          reopenOnSessionChange: boolOr(
            dashboardBrowser.reopenOnSessionChange,
            defaultPiExtConfig.modules.dashboard.browser.reopenOnSessionChange,
          ),
        },
      },
      agents: {
        enabled: boolOr(agents.enabled, defaultPiExtConfig.modules.agents.enabled),
        orchestrator: {
          enabled: boolOr(agentsOrchestrator.enabled, defaultPiExtConfig.modules.agents.orchestrator.enabled),
        },
        tools: {
          runSubagent: {
            enabled: boolOr(agentsRunSubagentTool.enabled, defaultPiExtConfig.modules.agents.tools.runSubagent.enabled),
          },
          getSubagentResult: {
            enabled: boolOr(agentsGetResultTool.enabled, defaultPiExtConfig.modules.agents.tools.getSubagentResult.enabled),
          },
          steerSubagent: {
            enabled: boolOr(agentsSteerTool.enabled, defaultPiExtConfig.modules.agents.tools.steerSubagent.enabled),
          },
        },
        maxParallel: positiveIntOr(agents.maxParallel, defaultPiExtConfig.modules.agents.maxParallel),
        defaultBackground: boolOr(agents.defaultBackground, defaultPiExtConfig.modules.agents.defaultBackground),
        childExtensions: {
          mode: childExtensionModeOr(childExtensions.mode, defaultPiExtConfig.modules.agents.childExtensions.mode),
          recursiveToolDenylist: stringArrayOr(
            childExtensions.recursiveToolDenylist,
            defaultPiExtConfig.modules.agents.childExtensions.recursiveToolDenylist,
          ),
        },
        transcripts: {
          persist: boolOr(transcripts.persist, defaultPiExtConfig.modules.agents.transcripts.persist),
        },
        stall: {
          enabled: boolOr(stall.enabled, defaultPiExtConfig.modules.agents.stall.enabled),
          timeoutMs: positiveIntOr(stall.timeoutMs, defaultPiExtConfig.modules.agents.stall.timeoutMs),
          notify: boolOr(stall.notify, defaultPiExtConfig.modules.agents.stall.notify),
          abortAfterMs: optionalPositiveInt(stall.abortAfterMs, defaultPiExtConfig.modules.agents.stall.abortAfterMs),
        },
      },
      memory: {
        enabled: boolOr(memory.enabled, defaultPiExtConfig.modules.memory.enabled),
        prompt: {
          enabled: boolOr(memoryPrompt.enabled, defaultPiExtConfig.modules.memory.prompt.enabled),
          maxMemoriesPerScope: positiveIntOr(
            memoryPrompt.maxMemoriesPerScope,
            defaultPiExtConfig.modules.memory.prompt.maxMemoriesPerScope,
          ),
          maxContentChars: positiveIntOr(memoryPrompt.maxContentChars, defaultPiExtConfig.modules.memory.prompt.maxContentChars),
        },
        tools: {
          createGlobalMemory: {
            enabled: boolOr(createGlobalMemoryTool.enabled, defaultPiExtConfig.modules.memory.tools.createGlobalMemory.enabled),
          },
          createProjectMemory: {
            enabled: boolOr(createProjectMemoryTool.enabled, defaultPiExtConfig.modules.memory.tools.createProjectMemory.enabled),
          },
          createSessionMemory: {
            enabled: boolOr(createSessionMemoryTool.enabled, defaultPiExtConfig.modules.memory.tools.createSessionMemory.enabled),
          },
          searchMemories: {
            enabled: boolOr(searchMemoriesTool.enabled, defaultPiExtConfig.modules.memory.tools.searchMemories.enabled),
          },
        },
        vector: {
          enabled: boolOr(memoryVector.enabled, defaultPiExtConfig.modules.memory.vector.enabled),
          provider: memoryVectorProviderOr(memoryVector.provider, defaultPiExtConfig.modules.memory.vector.provider),
          dimensions: 256,
          searchLimit: positiveIntOr(memoryVector.searchLimit, defaultPiExtConfig.modules.memory.vector.searchLimit),
          background: {
            enabled: boolOr(memoryVectorBackground.enabled, defaultPiExtConfig.modules.memory.vector.background.enabled),
            batchSize: positiveIntOr(memoryVectorBackground.batchSize, defaultPiExtConfig.modules.memory.vector.background.batchSize),
          },
          ollama: {
            endpoint: stringOr(memoryVectorOllama.endpoint, defaultPiExtConfig.modules.memory.vector.ollama.endpoint),
            model: stringOr(memoryVectorOllama.model, defaultPiExtConfig.modules.memory.vector.ollama.model),
            timeoutMs: positiveIntOr(memoryVectorOllama.timeoutMs, defaultPiExtConfig.modules.memory.vector.ollama.timeoutMs),
            keepAlive: optionalString(memoryVectorOllama.keepAlive, defaultPiExtConfig.modules.memory.vector.ollama.keepAlive),
          },
        },
      },
    },
  };
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return clone(override as T);
  }

  const output: Record<string, unknown> = clone(base);
  for (const [key, value] of Object.entries(override)) {
    output[key] = isPlainObject(value) && isPlainObject(output[key]) ? deepMerge(output[key], value) : clone(value);
  }
  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function positiveIntOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalPositiveInt(value: unknown, fallback: number | undefined): number | undefined {
  return value === undefined ? fallback : typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function childExtensionModeOr(value: unknown, fallback: AgentsChildExtensionMode): AgentsChildExtensionMode {
  return value === "inherit-safe" || value === "none" ? value : fallback;
}

function memoryVectorProviderOr(value: unknown, fallback: "local" | "ollama"): "local" | "ollama" {
  return value === "local" || value === "ollama" ? value : fallback;
}

function optionalString(value: unknown, fallback: string | undefined): string | undefined {
  return value === undefined ? fallback : typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringArrayOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const next = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return next.length > 0 ? next : [...fallback];
}

function portOr(value: unknown, fallback: number | "auto"): number | "auto" {
  return value === "auto" || (typeof value === "number" && Number.isInteger(value)) ? value : fallback;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
