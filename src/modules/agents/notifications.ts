import type { SubagentRunRecord } from "./records";

export interface SubagentNotificationMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: unknown;
}

export type SubagentNotificationSender = (
  message: SubagentNotificationMessage,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

export interface NotificationBridge {
  notify(record: SubagentRunRecord): void;
}

export function createNotificationBridge(send: SubagentNotificationSender, previewLength = 1200): NotificationBridge {
  return {
    notify(record) {
      send(
        {
          customType: "pi-ext-agents-notification",
          content: formatSubagentNotification(record, previewLength),
          display: true,
          details: buildNotificationDetails(record, previewLength),
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  };
}

export function formatSubagentNotification(record: SubagentRunRecord, previewLength: number): string {
  const result = record.error ?? record.output ?? "";
  const preview = result.length > previewLength ? `${result.slice(0, previewLength)}\n...(truncated, use get_subagent_result for full output)` : result;
  const elapsed = record.completedAt ? Math.max(0, record.completedAt - record.createdAt) : Math.max(0, record.updatedAt - record.createdAt);

  return [
    "<subagent-notification>",
    `  <task-id>${escapeXml(record.id)}</task-id>`,
    `  <agent>${escapeXml(record.agent)}</agent>`,
    `  <status>${escapeXml(record.status)}</status>`,
    `  <summary>${escapeXml(`Subagent ${record.agent} ${record.status}`)}</summary>`,
    `  <result>${escapeXml(preview || "No output.")}</result>`,
    record.transcriptPath ? `  <transcript>${escapeXml(record.transcriptPath)}</transcript>` : null,
    `  <usage><turns>${record.turnCount}</turns><tool_uses>${record.toolUseCount}</tool_uses><duration_ms>${elapsed}</duration_ms></usage>`,
    "</subagent-notification>",
  ].filter(Boolean).join("\n");
}

function buildNotificationDetails(record: SubagentRunRecord, previewLength: number): Record<string, unknown> {
  const text = record.error ?? record.output ?? "";
  return {
    id: record.id,
    agent: record.agent,
    status: record.status,
    turnCount: record.turnCount,
    toolUseCount: record.toolUseCount,
    transcriptPath: record.transcriptPath,
    preview: text.length > previewLength ? `${text.slice(0, previewLength)}…` : text,
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
