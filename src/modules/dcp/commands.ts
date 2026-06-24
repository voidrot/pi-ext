import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseBlockRef } from "./message-ids";
import { deactivateBlock, appendStateEntry } from "./state/store";
import type { DcpState } from "./state/types";

export type DcpCommand =
  | { action: "status"; args: string[] }
  | { action: "manual"; args: string[] }
  | { action: "decompress"; args: string[] }
  | { action: "recompress"; args: string[] }
  | { action: "stats"; args: string[] }
  | { action: "help"; args: string[] };

export function parseDcpCommand(args: string): DcpCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] ?? "status").toLowerCase();
  const rest = parts.slice(1);
  if (["manual", "decompress", "recompress", "stats"].includes(action))
    return { action: action as DcpCommand["action"], args: rest };
  if (action === "status" || action === "")
    return { action: "status", args: rest };
  return { action: "help", args: parts };
}

export function buildStatus(state: DcpState): string {
  const active = Array.from(state.activeBlockIds).length;
  return `Pi DCP: ${active} active block(s), ${state.totalCompressedTokens} estimated tokens compressed, manual mode ${state.manualMode ? "on" : "off"}.`;
}

export async function handleDcpCommand(
  pi: ExtensionAPI,
  rawArgs: string,
  ctx: any,
  state: DcpState,
): Promise<void> {
  const command = parseDcpCommand(rawArgs);
  if (command.action === "manual") {
    const enabled =
      command.args[0] === "on"
        ? true
        : command.args[0] === "off"
          ? false
          : !state.manualMode;
    state.manualMode = enabled;
    appendStateEntry(pi, state);
    if (ctx.hasUI)
      ctx.ui.notify(
        `Pi DCP manual mode ${enabled ? "enabled" : "disabled"}`,
        "info",
      );
    return;
  }
  if (command.action === "decompress" || command.action === "recompress") {
    const blockId = parseBlockRef(command.args[0] ?? "");
    if (!blockId || !deactivateBlock(state, blockId)) {
      if (ctx.hasUI)
        ctx.ui.notify(
          `Pi DCP block not found: ${command.args[0] ?? ""}`,
          "warning",
        );
      return;
    }
    appendStateEntry(pi, state);
    if (ctx.hasUI) ctx.ui.notify(`Pi DCP deactivated b${blockId}`, "info");
    if (command.action === "recompress") {
      sendCompressPrompt(pi, `replace b${blockId} with a better summary`, ctx);
    }
    return;
  }
  if (ctx.hasUI) ctx.ui.notify(buildStatus(state), "info");
}

export function sendCompressPrompt(
  pi: ExtensionAPI,
  focus: string | undefined,
  ctx?: any,
): void {
  const message = `Run one DCP compression pass now. Focus: ${focus?.trim() || "stale closed context"}. Use the visible <dcp-message-id> refs and call the compress tool exactly once if there is suitable stale context.`;
  const options =
    ctx && !ctx.isIdle?.() ? { deliverAs: "followUp" as const } : undefined;
  pi.sendUserMessage(message, options);
}
