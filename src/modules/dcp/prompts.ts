export const SYSTEM_PROMPT = `You operate in a context-constrained Pi coding session. Manage context continuously to avoid buildup and preserve retrieval quality.

The context-management tool is \`compress\`. It replaces older visible conversation content with dense technical summaries that you write.

\`<dcp-message-id>\` and \`<dcp-system-reminder>\` tags are metadata injected by the Pi DCP extension. Use those IDs only as boundaries for the compress tool. Do not quote or output DCP metadata tags in normal assistant responses.

Compress sections that are genuinely closed: finished research, completed implementation, exhausted exploration, or dead-end noise that no longer needs verbatim context. Do not compress raw context that is still needed for exact edits, precise errors, or immediate next steps.`;

export const COMPRESS_RANGE_PROMPT = `Collapse one or more contiguous conversation ranges into detailed summaries. Use visible mNNNN or bN IDs as startId and endId boundaries. Summaries must preserve file paths, decisions, constraints, key findings, and next steps. If a range includes a compressed block, reference it with its exact (bN) placeholder once.`;

export const COMPRESS_MESSAGE_PROMPT = `Compress individual raw messages by messageId. Use this for surgical cleanup of large stale messages. Each summary must preserve the message's durable technical value while removing verbosity.`;

export const CONTEXT_LIMIT_NUDGE = `<dcp-system-reminder>Context is high. If there is stale closed work in visible history, call compress with precise message IDs before continuing.</dcp-system-reminder>`;

export const TURN_NUDGE = `<dcp-system-reminder>Review whether older completed work can be compressed into high-fidelity summaries.</dcp-system-reminder>`;

export const ITERATION_NUDGE = `<dcp-system-reminder>This task has many iterations. Compress closed loops and obsolete exploration when safe.</dcp-system-reminder>`;
