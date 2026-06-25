import type { CompressionApplyResult } from "./compress/state";
import type { CompressionBlock, DcpState } from "./state/types";

export const DCP_COMPRESSED_BLOCKS_WIDGET_ID = "voidrot.dcp.compressed-blocks";

interface DcpUiContext {
  hasUI: boolean;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setWidget(key: string, content: unknown, options?: unknown): void;
  };
}

interface DcpStatsOverlayContext {
  hasUI: boolean;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    custom?<T>(
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: T) => void,
      ) => DcpOverlayComponent,
      options?: unknown,
    ): Promise<T>;
  };
}

interface DcpOverlayComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}

interface DcpWidgetConfig {
  compressedBlocksWidget: boolean;
}

interface DcpNotificationConfig {
  compress: { showCompression: boolean };
  ui: { compressionNotifications: boolean };
}

export function formatCompressedBlocksWidget(state: DcpState): string[] | undefined {
  const blocks = getActiveBlocks(state);
  if (blocks.length === 0) return undefined;

  const compressedTokens = blocks.reduce((sum, block) => sum + block.compressedTokens, 0);
  const summaryTokens = blocks.reduce((sum, block) => sum + block.summaryTokens, 0);
  const lines = [
    `▣ DCP compressed context · ${blocks.length} active · -${formatTokenCount(compressedTokens)} / +${formatTokenCount(summaryTokens)}`,
  ];

  for (const block of blocks.slice(0, 5)) {
    lines.push(formatWidgetBlockLine(block));
  }

  if (blocks.length > 5) {
    lines.push(`  … ${blocks.length - 5} more compressed block(s)`);
  }

  return lines;
}

export function syncDcpWidget(
  ctx: DcpUiContext,
  state: DcpState,
  config: DcpWidgetConfig,
): void {
  if (!ctx.hasUI) return;
  if (!config.compressedBlocksWidget) {
    clearDcpWidget(ctx);
    return;
  }

  ctx.ui.setWidget(DCP_COMPRESSED_BLOCKS_WIDGET_ID, formatCompressedBlocksWidget(state));
}

export function clearDcpWidget(ctx: DcpUiContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(DCP_COMPRESSED_BLOCKS_WIDGET_ID, undefined);
}

export function notifyCompression(
  ctx: DcpUiContext,
  state: DcpState,
  result: CompressionApplyResult,
  config: DcpNotificationConfig,
): void {
  if (!ctx.hasUI || !config.ui.compressionNotifications) return;
  ctx.ui.notify(formatCompressionNotification(state, result, config.compress.showCompression), "info");
}

export function formatCompressionNotification(
  state: DcpState,
  result: CompressionApplyResult,
  showSummary: boolean,
): string {
  const blocks = result.blockIds
    .map((blockId) => state.blocks.get(blockId))
    .filter((block): block is CompressionBlock => Boolean(block));
  const topics = unique(blocks.map((block) => block.topic)).slice(0, 3);
  const topicText = topics.length > 0 ? ` · ${topics.join(", ")}` : "";
  const blockLabel = result.blockIds.length === 1 ? "block" : "blocks";
  let message = `▣ DCP compressed ${result.blockIds.length} ${blockLabel} · -${formatTokenCount(result.compressedTokens)} removed, +${formatTokenCount(result.summaryTokens)} summary${topicText}`;

  if (showSummary && blocks.length > 0) {
    message += ` · ${truncate(blocks.map((block) => block.summary).join(" "), 180)}`;
  }

  return message;
}

export function buildDcpStatsLines(state: DcpState, now = Date.now()): string[] {
  const blocks = Array.from(state.blocks.values()).sort((a, b) => a.blockId - b.blockId);
  const activeBlocks = getActiveBlocks(state);
  const inactiveBlocks = blocks.filter((block) => !block.active);
  const activeCompressedTokens = sum(activeBlocks, (block) => block.compressedTokens);
  const activeSummaryTokens = sum(activeBlocks, (block) => block.summaryTokens);
  const totalSummaryTokens = sum(blocks, (block) => block.summaryTokens);
  const directEntries = sum(activeBlocks, (block) => block.directEntryIds.length);
  const effectiveEntries = sum(activeBlocks, (block) => block.effectiveEntryIds.length);
  const directToolCalls = sum(activeBlocks, (block) => block.directToolCallIds.length);
  const effectiveToolCalls = sum(activeBlocks, (block) => block.effectiveToolCallIds.length);
  const totalConsumedBlocks = sum(activeBlocks, (block) => block.consumedBlockIds.length);
  const netHistoricalTokens = Math.max(0, state.totalCompressedTokens - totalSummaryTokens);
  const lines = [
    "Pi DCP high-definition stats",
    "",
    `Manual mode: ${state.manualMode ? "on" : "off"}`,
    `Turns observed: ${state.turnCounter}`,
    `Runs created: ${Math.max(0, state.nextRunId - 1)}`,
    `Blocks: ${blocks.length} total, ${activeBlocks.length} active, ${inactiveBlocks.length} inactive`,
    `Tokens: -${formatTokenCount(state.totalCompressedTokens)} total compressed, +${formatTokenCount(totalSummaryTokens)} total summaries`,
    `Active tokens: -${formatTokenCount(activeCompressedTokens)} raw, +${formatTokenCount(activeSummaryTokens)} summaries`,
    `Estimated historical net: -${formatTokenCount(netHistoricalTokens)}`,
    `Active refs: ${directEntries} direct / ${effectiveEntries} effective entries, ${directToolCalls} direct / ${effectiveToolCalls} effective tool calls`,
    `Consumed prior blocks inside active summaries: ${totalConsumedBlocks}`,
    `Next ids: b${state.nextBlockId}, run #${state.nextRunId}`,
    "",
  ];

  if (activeBlocks.length === 0) {
    lines.push("No active compressed blocks.");
    return lines;
  }

  lines.push("Active blocks");
  for (const block of activeBlocks.slice(0, 10)) {
    lines.push(
      `b${block.blockId} | run #${block.runId} | ${block.topic}`,
      `  refs ${block.startRef} -> ${block.endRef} | ${block.mode} | created ${formatAge(block.createdAt, now)}`,
      `  entries ${block.directEntryIds.length} direct / ${block.effectiveEntryIds.length} effective | tools ${block.directToolCallIds.length} direct / ${block.effectiveToolCallIds.length} effective`,
      `  tokens -${formatTokenCount(block.compressedTokens)} raw / +${formatTokenCount(block.summaryTokens)} summary`,
      `  summary: ${truncate(block.summary, 160)}`,
    );
  }

  if (activeBlocks.length > 10) {
    lines.push(`... ${activeBlocks.length - 10} more active block(s) not shown`);
  }

  return lines;
}

export async function showDcpStatsOverlay(ctx: DcpStatsOverlayContext, state: DcpState): Promise<void> {
  if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
    ctx.ui.notify(buildDcpStatsLines(state).join("\n"), "info");
    return;
  }

  await ctx.ui.custom<void>(
    (_tui, _theme, _keybindings, done) => new DcpStatsOverlay(state, () => done(undefined)),
    {
      overlay: true,
      overlayOptions: {
        width: "74%",
        minWidth: 60,
        maxHeight: "80%",
        anchor: "center",
        margin: 2,
      },
    },
  );
}

class DcpStatsOverlay implements DcpOverlayComponent {
  private readonly state: DcpState;
  private readonly onClose: () => void;

  constructor(state: DcpState, onClose: () => void) {
    this.state = state;
    this.onClose = onClose;
  }

  render(width: number): string[] {
    if (width < 12) return buildDcpStatsLines(this.state).map((line) => truncate(line, width));

    const maxContentLines = 42;
    const innerWidth = Math.max(1, width - 4);
    const rawLines = buildDcpStatsLines(this.state);
    const clipped = rawLines.length > maxContentLines
      ? [...rawLines.slice(0, maxContentLines - 1), `... ${rawLines.length - maxContentLines + 1} more line(s) not shown`]
      : rawLines;
    const body = clipped.map((line) => frameLine(line, innerWidth));

    return [
      `┌${"─".repeat(width - 2)}┐`,
      ...body,
      frameLine("", innerWidth),
      frameLine("esc / q closes", innerWidth),
      `└${"─".repeat(width - 2)}┘`,
    ];
  }

  handleInput(data: string): void {
    if (isDcpStatsOverlayCloseInput(data)) {
      this.onClose();
    }
  }

  invalidate(): void {}
}

export function isDcpStatsOverlayCloseInput(data: string): boolean {
  return data === "q" || data === "Q" || isEscapeInput(data) || isCtrlCInput(data);
}

function isEscapeInput(data: string): boolean {
  return data === "\x1b"
    || data === "escape"
    || data === "esc"
    || /^\x1b\[27(?::\d*)?(?::\d+)?(?:;1)?(?::\d+)?u$/.test(data)
    || data === "\x1b[27;1;27~";
}

function isCtrlCInput(data: string): boolean {
  return data === "\x03"
    || data === "ctrl+c"
    || /^\x1b\[(?:99|67)(?::\d*)?(?::\d+)?;5(?::\d+)?u$/.test(data)
    || data === "\x1b[27;5;99~"
    || data === "\x1b[27;5;67~";
}

function frameLine(text: string, innerWidth: number): string {
  const value = truncate(text, innerWidth);
  return `│ ${value.padEnd(innerWidth, " ")} │`;
}

function formatWidgetBlockLine(block: CompressionBlock): string {
  const items = block.directEntryIds.length;
  const itemLabel = items === 1 ? "item" : "items";
  return [
    `  b${block.blockId}`,
    `run #${block.runId}`,
    block.topic,
    `${block.startRef} → ${block.endRef}`,
    `${items} ${itemLabel}`,
    `-${formatTokenCount(block.compressedTokens)}`,
    `+${formatTokenCount(block.summaryTokens)}`,
  ].join(" · ");
}

function getActiveBlocks(state: DcpState): CompressionBlock[] {
  return Array.from(state.activeBlockIds)
    .map((blockId) => state.blocks.get(blockId))
    .filter((block): block is CompressionBlock => Boolean(block?.active))
    .sort((a, b) => a.blockId - b.blockId);
}

function formatTokenCount(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) return String(value);
  if (abs < 1_000_000) return `${trimDecimal(value / 1000)}k`;
  return `${trimDecimal(value / 1_000_000)}m`;
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatAge(timestamp: number, now: number): string {
  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sum<T>(values: T[], fn: (value: T) => number): number {
  return values.reduce((total, value) => total + fn(value), 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
