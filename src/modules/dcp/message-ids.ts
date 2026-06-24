const MESSAGE_REF_REGEX = /^m(\d{4})$/i;
const BLOCK_REF_REGEX = /^b([1-9]\d*)$/i;
const MESSAGE_REF_WIDTH = 4;
const MESSAGE_REF_MIN_INDEX = 1;
export const MESSAGE_REF_MAX_INDEX = 9999;

export type ParsedBoundaryId =
  | { kind: "message"; ref: string; index: number }
  | { kind: "compressed-block"; ref: string; blockId: number };

export function formatMessageRef(index: number): string {
  if (
    !Number.isInteger(index) ||
    index < MESSAGE_REF_MIN_INDEX ||
    index > MESSAGE_REF_MAX_INDEX
  ) {
    throw new Error(`Message ref index out of bounds: ${index}`);
  }
  return `m${index.toString().padStart(MESSAGE_REF_WIDTH, "0")}`;
}

export function parseMessageRef(ref: string): number | null {
  const match = ref.trim().match(MESSAGE_REF_REGEX);
  if (!match) return null;
  const index = Number.parseInt(match[1]!, 10);
  return Number.isInteger(index) &&
    index >= MESSAGE_REF_MIN_INDEX &&
    index <= MESSAGE_REF_MAX_INDEX
    ? index
    : null;
}

export function formatBlockRef(blockId: number): string {
  if (!Number.isInteger(blockId) || blockId < 1)
    throw new Error(`Invalid block id: ${blockId}`);
  return `b${blockId}`;
}

export function parseBlockRef(ref: string): number | null {
  const match = ref.trim().match(BLOCK_REF_REGEX);
  if (!match) return null;
  const id = Number.parseInt(match[1]!, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseBoundaryId(id: string): ParsedBoundaryId | null {
  const messageIndex = parseMessageRef(id);
  if (messageIndex !== null)
    return {
      kind: "message",
      ref: formatMessageRef(messageIndex),
      index: messageIndex,
    };
  const blockId = parseBlockRef(id);
  if (blockId !== null)
    return { kind: "compressed-block", ref: formatBlockRef(blockId), blockId };
  return null;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatMessageIdTag(
  ref: string,
  attributes: Record<string, string | undefined> = {},
): string {
  const attrs = Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      if (!name.trim() || typeof value !== "string" || value.length === 0)
        return "";
      return ` ${name}="${escapeXmlAttribute(value)}"`;
    })
    .join("");
  return `\n<dcp-message-id${attrs}>${ref}</dcp-message-id>`;
}
