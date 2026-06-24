export type Permission = "ask" | "allow" | "deny";
export type CompressMode = "range" | "message";
export type LimitValue = number | `${number}%`;

export interface DcpConfig {
  enabled: boolean;
  debug: boolean;
  commands: { enabled: boolean; protectedTools: string[] };
  manualMode: { enabled: boolean; automaticStrategies: boolean };
  protectedFilePatterns: string[];
  compress: {
    mode: CompressMode;
    permission: Permission;
    showCompression: boolean;
    summaryBuffer: boolean;
    maxContextLimit: LimitValue;
    minContextLimit: LimitValue;
    modelMaxLimits?: Record<string, LimitValue>;
    modelMinLimits?: Record<string, LimitValue>;
    nudgeFrequency: number;
    iterationNudgeThreshold: number;
    nudgeForce: "strong" | "soft";
    protectedTools: string[];
    protectUserMessages: boolean;
  };
  strategies: {
    deduplication: { enabled: boolean; protectedTools: string[] };
    purgeErrors: { enabled: boolean; turns: number; protectedTools: string[] };
  };
}

export const defaultConfig: DcpConfig = {
  enabled: true,
  debug: false,
  commands: { enabled: true, protectedTools: [] },
  manualMode: { enabled: false, automaticStrategies: true },
  protectedFilePatterns: [],
  compress: {
    mode: "range",
    permission: "allow",
    showCompression: false,
    summaryBuffer: true,
    maxContextLimit: 100000,
    minContextLimit: 50000,
    modelMaxLimits: undefined,
    modelMinLimits: undefined,
    nudgeFrequency: 5,
    iterationNudgeThreshold: 15,
    nudgeForce: "soft",
    protectedTools: ["read", "write", "edit", "bash", "task", "skill"],
    protectUserMessages: false,
  },
  strategies: {
    deduplication: { enabled: true, protectedTools: [] },
    purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
  },
};

export function mergeDcpConfig(overrides: Record<string, unknown>): DcpConfig {
  return mergeConfig(cloneConfig(defaultConfig), overrides as Partial<DcpConfig>);
}

export function resolveLimit(value: LimitValue, contextWindow: number | undefined): number {
  if (typeof value === "number") return value;
  const pct = Number.parseFloat(value.slice(0, -1));
  if (!Number.isFinite(pct) || !contextWindow) return 0;
  return Math.floor((contextWindow * pct) / 100);
}

function mergeConfig(base: DcpConfig, override: Partial<DcpConfig>): DcpConfig {
  return {
    enabled: override.enabled ?? base.enabled,
    debug: override.debug ?? base.debug,
    commands: {
      enabled: override.commands?.enabled ?? base.commands.enabled,
      protectedTools: unique([...(base.commands.protectedTools ?? []), ...(override.commands?.protectedTools ?? [])]),
    },
    manualMode: {
      enabled: override.manualMode?.enabled ?? base.manualMode.enabled,
      automaticStrategies: override.manualMode?.automaticStrategies ?? base.manualMode.automaticStrategies,
    },
    protectedFilePatterns: unique([...(base.protectedFilePatterns ?? []), ...(override.protectedFilePatterns ?? [])]),
    compress: {
      ...base.compress,
      ...override.compress,
      nudgeFrequency: Math.max(1, override.compress?.nudgeFrequency ?? base.compress.nudgeFrequency),
      iterationNudgeThreshold: Math.max(
        1,
        override.compress?.iterationNudgeThreshold ?? base.compress.iterationNudgeThreshold,
      ),
      protectedTools: unique([...(base.compress.protectedTools ?? []), ...(override.compress?.protectedTools ?? [])]),
    },
    strategies: {
      deduplication: {
        enabled: override.strategies?.deduplication?.enabled ?? base.strategies.deduplication.enabled,
        protectedTools: unique([
          ...(base.strategies.deduplication.protectedTools ?? []),
          ...(override.strategies?.deduplication?.protectedTools ?? []),
        ]),
      },
      purgeErrors: {
        enabled: override.strategies?.purgeErrors?.enabled ?? base.strategies.purgeErrors.enabled,
        turns: Math.max(1, override.strategies?.purgeErrors?.turns ?? base.strategies.purgeErrors.turns),
        protectedTools: unique([
          ...(base.strategies.purgeErrors.protectedTools ?? []),
          ...(override.strategies?.purgeErrors?.protectedTools ?? []),
        ]),
      },
    },
  };
}

function cloneConfig(config: DcpConfig): DcpConfig {
  return JSON.parse(JSON.stringify(config)) as DcpConfig;
}

function unique(values: string[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
}
