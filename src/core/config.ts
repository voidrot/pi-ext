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

export interface PiExtConfig {
  enabled: boolean;
  debug: boolean;
  modules: {
    dcp: DcpModuleConfig;
    dashboard: DashboardModuleConfig;
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

function portOr(value: unknown, fallback: number | "auto"): number | "auto" {
  return value === "auto" || (typeof value === "number" && Number.isInteger(value)) ? value : fallback;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
