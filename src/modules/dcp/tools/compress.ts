import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  applyMessageCompression,
  applyRangeCompression,
} from "../compress/state";
import type { DcpConfig } from "../config";
import { createFramesFromMessages } from "../pi/branch";
import { appendStateEntry } from "../state/store";
import type { DcpState } from "../state/types";
import { notifyCompression, syncDcpWidget } from "../ui";

const rangeSchema = Type.Object({
  topic: Type.String({ description: "Short label for this compression batch" }),
  content: Type.Array(
    Type.Object({
      startId: Type.String({
        description: "Message or block ID where range starts, e.g. m0001 or b2",
      }),
      endId: Type.String({
        description: "Message or block ID where range ends, e.g. m0012 or b3",
      }),
      summary: Type.String({
        description: "High-fidelity technical summary for the selected range",
      }),
    }),
  ),
});

const messageSchema = Type.Object({
  topic: Type.String({ description: "Short label for this compression batch" }),
  content: Type.Array(
    Type.Object({
      messageId: Type.String({
        description: "Raw message ID to compress, e.g. m0001",
      }),
      topic: Type.String({
        description: "Short label for this message summary",
      }),
      summary: Type.String({
        description: "High-fidelity technical summary for the selected message",
      }),
    }),
  ),
});

export function registerCompressTool(
  pi: ExtensionAPI,
  getRuntime: (ctx: ExtensionContext) => { state: DcpState; config: DcpConfig },
): void {
  pi.registerTool({
    name: "compress",
    label: "Compress",
    description:
      "Replace stale Pi conversation context with high-fidelity technical summaries using visible dcp-message-id boundaries.",
    promptSnippet:
      "Compress stale closed conversation ranges into durable summaries.",
    promptGuidelines: [
      "Use compress when older Pi conversation content is closed and no longer needed verbatim.",
      "Do not compress old raw tool-call transcripts; DCP strips them after the stale-tool threshold.",
      "Older selections must use shorter summaries. If the tool rejects an over-budget summary, retry with only durable facts.",
    ],
    parameters: Type.Union([rangeSchema, messageSchema]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { state, config } = getRuntime(ctx);
      if (config.compress.permission === "deny") {
        throw new Error("Pi DCP compression is disabled by configuration");
      }
      const branch = ctx.sessionManager.getBranch();
      const sessionManager = ctx.sessionManager as any;
      const context =
        typeof sessionManager.buildSessionContext === "function"
          ? sessionManager.buildSessionContext()
          : undefined;
      const messages = Array.isArray(context?.messages)
        ? context.messages
        : branch
            .filter((entry: any) => entry.type === "message")
            .map((entry: any) => entry.message);
      const frames = createFramesFromMessages(messages, branch);
      const originEntryId = ctx.sessionManager.getLeafId?.() ?? "compress-tool";
      const input = params as any;
      const result =
        config.compress.mode === "message" || input.content?.[0]?.messageId
          ? applyMessageCompression(state, frames, originEntryId, input, config)
          : applyRangeCompression(state, frames, originEntryId, input, config);
      appendStateEntry(pi, state);
      syncDcpWidget(ctx, state, config.ui);
      notifyCompression(ctx, state, result, config);
      return {
        content: [
          {
            type: "text",
            text: `Compressed ${result.blockIds.length} block(s) into [Compressed conversation section].`,
          },
        ],
        details: result,
      };
    },
  });
}
