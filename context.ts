/**
 * Context assembler (spec §8).
 *
 * Decides what the drafter sees. Bounded and recency-weighted: the tail of the
 * transcript is the strongest grounding for a continuation, so we keep the last
 * N user-delimited turns and drop everything older. We do NOT feed the whole
 * session by default — more context here mostly adds cost and dilutes grounding.
 *
 * Pure and runtime-dependency-free so it can be unit tested against synthetic
 * session entries. The entry shapes mirror Pi's SessionEntry union loosely (the
 * fields we read: type, message.role, message.content, toolName, input, content).
 */

export interface AssembledContext {
  /** Flattened, human-readable transcript slice (may be empty for a fresh session). */
  transcriptText: string;
  /** Number of user-delimited turns actually included. */
  turnsIncluded: boolean;
}

/** Hard ceiling so a single huge tool result can't blow the drafter's context. */
const MAX_CHARS = 24000;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c?.text === "string" ? c.text : c?.type ?? ""))
      .join(" ");
  }
  return "";
}

function formatEntry(e: any): string | null {
  if (e?.type === "message" && e.message) {
    const role = e.message.role ?? "unknown";
    const text = messageText(e.message.content).trim();
    if (!text) return null;
    return `[${role}] ${text}`;
  }
  if (e?.type === "tool_call") {
    return `[tool_call] ${e.toolName}: ${JSON.stringify(e.input ?? {}).slice(0, 200)}`;
  }
  if (e?.type === "tool_result") {
    const content = typeof e.content === "string" ? e.content : JSON.stringify(e.content ?? "").slice(0, 200);
    return `[tool_result] ${e.toolName ?? "unknown"}: ${content}`;
  }
  return null;
}

/**
 * Build the transcript slice from session entries.
 *
 * Windowing: walk from the end, counting user messages as turn delimiters; keep
 * everything from the start of the `contextTurns`-th-most-recent user turn to the
 * end. Then truncate the *front* of that slice to MAX_CHARS (keep the recent end).
 */
export function assembleContext(entries: any[], contextTurns: number): AssembledContext {
  if (contextTurns <= 0 || entries.length === 0) {
    return { transcriptText: "", turnsIncluded: false };
  }

  // Find the index of the start of the window by counting user messages backwards.
  let userSeen = 0;
  let startIndex = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type === "message" && e.message?.role === "user") {
      userSeen++;
      if (userSeen >= contextTurns) {
        startIndex = i;
        break;
      }
    }
  }

  const lines: string[] = [];
  for (let i = startIndex; i < entries.length; i++) {
    const line = formatEntry(entries[i]);
    if (line) lines.push(line);
  }

  let text = lines.join("\n");
  if (text.length > MAX_CHARS) {
    text = "...(earlier context truncated)...\n" + text.slice(text.length - MAX_CHARS);
  }

  return { transcriptText: text, turnsIncluded: lines.length > 0 };
}
