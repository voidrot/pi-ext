export type Permission = "ask" | "allow" | "deny";
export type CompressMode = "range" | "message";
export type LimitValue = number | `${number}%`;

export interface CompressionSummaryTier {
  minTurns: number;
  maxSummaryRatio: number;
}

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
    summaryTiers: CompressionSummaryTier[];
  };
  ui: {
    compressedBlocksWidget: boolean;
    compressionNotifications: boolean;
  };
  strategies: {
    deduplication: { enabled: boolean; protectedTools: string[] };
    purgeErrors: { enabled: boolean; turns: number; protectedTools: string[] };
    staleToolCalls: { enabled: boolean; turns: number; protectedTools: string[] };
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
    summaryTiers: [
      { minTurns: 0, maxSummaryRatio: 0.4 },
      { minTurns: 5, maxSummaryRatio: 0.25 },
      { minTurns: 15, maxSummaryRatio: 0.12 },
    ],
  },
  ui: {
    compressedBlocksWidget: true,
    compressionNotifications: true,
  },
  strategies: {
    deduplication: { enabled: true, protectedTools: [] },
    purgeErrors: { enabled: true, turns: 4, protectedTools: [] },
    staleToolCalls: { enabled: true, turns: 5, protectedTools: [] },
  },
};

export function mergeDcpConfig(overrides: Record<string, unknown>): DcpConfig {
  return mergeConfig(cloneConfig(defaultConfig), overrides as any);
}

export function resolveLimit(value: LimitValue, contextWindow: number | undefined): number {
  if (typeof value === "number") return value;
  const pct = Number.parseFloat(value.slice(0, -1));
  if (!Number.isFinite(pct) || !contextWindow) return 0;
  return Math.floor((contextWindow * pct) / 100);
}

function mergeConfig(base: DcpConfig, override: any): DcpConfig {
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
      summaryTiers: normalizeSummaryTiers(override.compress?.summaryTiers, base.compress.summaryTiers),
    },
    ui: {
      compressedBlocksWidget: override.ui?.compressedBlocksWidget ?? base.ui.compressedBlocksWidget,
      compressionNotifications: override.ui?.compressionNotifications ?? base.ui.compressionNotifications,
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
      staleToolCalls: {
        enabled: override.strategies?.staleToolCalls?.enabled ?? base.strategies.staleToolCalls.enabled,
        turns: Math.max(1, override.strategies?.staleToolCalls?.turns ?? base.strategies.staleToolCalls.turns),
        protectedTools: unique([
          ...(override.strategies?.staleToolCalls?.protectedTools ?? base.strategies.staleToolCalls.protectedTools),
        ]),
      },
    },
  };
}

function normalizeSummaryTiers(input: unknown, fallback: CompressionSummaryTier[]): CompressionSummaryTier[] {
  if (!Array.isArray(input)) return fallback;
  const tiers = input
    .map((item) => {
      const raw = item as Partial<CompressionSummaryTier>;
      if (typeof raw.minTurns !== "number" || typeof raw.maxSummaryRatio !== "number") return undefined;
      return {
        minTurns: Math.max(0, Math.floor(raw.minTurns)),
        maxSummaryRatio: Math.min(1, Math.max(0.01, raw.maxSummaryRatio)),
      };
    })
    .filter((item): item is CompressionSummaryTier => !!item)
    .sort((a, b) => a.minTurns - b.minTurns);
  return tiers.length > 0 && tiers[0]!.minTurns === 0 ? tiers : fallback;
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
