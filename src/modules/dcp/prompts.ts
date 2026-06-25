export const SYSTEM_PROMPT = `You operate in a context-constrained Pi coding session. Manage context continuously to avoid buildup and preserve retrieval quality.

The context-management tool is \`compress\`. It replaces older visible conversation content with dense technical summaries that you write.

DCP automatically strips old tool-call/tool-result transcripts after the configured stale-tool threshold (default 5 turns). Do not spend compression budget summarizing old raw tool outputs unless their conclusions are required for future work.

When compressing, use stricter summaries for older content:
- fresh stale work: preserve exact technical details, but avoid transcripts;
- warm work (5+ turns old): keep decisions, file paths, commands, failures, and next actions only;
- cold work (15+ turns old): keep only durable facts that affect future edits.
`;

export const TURN_NUDGE = ``;

export const ITERATION_NUDGE = ``;

export const CONTEXT_LIMIT_NUDGE = `

<dcp-system-reminder>Context is high. If there is stale closed work in visible history, call compress with precise message IDs before continuing.</dcp-system-reminder>`;
