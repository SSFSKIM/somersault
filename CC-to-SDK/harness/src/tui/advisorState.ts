// tui/src/advisorState.ts — bl7 T-ADVISOR Task 2 (spec §3.3): canon's `eGt`/`uur`/`tGt` (research-advisor.md
// §A2(a), offsets 163035026-163035350), ported as a pure lookups pass over RETAINED assistant messages. An
// `advisor_tool_result` block resolves its matching `server_tool_use` by `tool_use_id`, and marks it
// ERRORED when the result is an `advisor_tool_result_error` or a decline (`content.stop_reason ===
// "refusal"`, canon `sle`). Any `server_tool_use`/`mcp_tool_use` id still unresolved in a NON-LATEST
// assistant message is force-resolved as errored, so an abandoned consult goes red rather than spinning
// forever — canon's own `tGt(e, t.at(-1), F, U)` invocation from the lookups builder `Kzn` (163033217).
//
// D17 (plan review M7): "latest" derives from the ACTUAL RETAINED TAIL — `tail?.type === "assistant" ?
// tail.message.id : undefined` — never a filtered "last assistant message". A trailing USER frame (an
// interrupt, or a fresh prompt sent before any reply) yields `undefined`, which no real message id ever
// equals, so EVERY assistant message's unresolved consults are forced red in that case — canon reads the
// array's true last element, not a filtered one, and this module must too.
//
// Must NOT mint a `ToolEvent`: `extractCalls` (transcriptModel.ts) keeps its `tool_use`-only gate, so an
// advisor consult never gets a tool row. This module never touches the retained `TranscriptDocument` — it is
// a parallel map the projection computes where it already walks entries (`buildAnchoredEntries`,
// toolRenderer.tsx), pure and side-effect-free.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export type AdvisorResolution = { resolved: ReadonlySet<string>; errored: ReadonlySet<string> };

/** One retained SDK entry, structurally — the shape `SdkEntry`/`TranscriptEntry` already have (`{message}`
 *  plus whatever else), without importing toolRenderer.tsx: this module stays a leaf (no React/Ink, no
 *  transcript-model dependency), and toolRenderer.tsx is the one production caller. `message.type` is the
 *  outer envelope's own type ("assistant"/"user"/…); `message.message.content` is the SDK block array
 *  (canon's `d.message.content`) — the same nesting `transcriptModel.ts`'s `contentBlocks` reads. */
export type AdvisorEntry = { message: Record<string, unknown> };

function contentOf(message: Record<string, unknown>): readonly Record<string, unknown>[] {
  const inner = message.message;
  const content = isRecord(inner) ? inner.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}
function innerMessageId(message: Record<string, unknown>): string | undefined {
  const inner = message.message;
  return isRecord(inner) && typeof inner.id === "string" ? inner.id : undefined;
}
/** `sle`/`Que` (research-advisor.md A3, 159209622/159209386): declined = `content.stop_reason ===
 *  "refusal"`. Read defensively off whatever `content` a block carries — the only caller passes an
 *  `advisor_tool_result` block's own `content` field (`BetaAdvisorToolResultBlock.content`).
 *  EXPORTED (bl7 T-ADVISOR Task 3): render.ts's collapsed/expanded row text AND toolRenderer.tsx's §3.4
 *  clickability predicate both need "is this declined" — sharing the one canon predicate here is what keeps
 *  the render decision and the click decision from drifting apart. */
export function isDeclined(content: unknown): boolean {
  return isRecord(content) && content.stop_reason === "refusal";
}
/** `V9e` (159209664): the declined REASON, read only off an `advisor_result` shape's own `text` field, and
 *  only when non-empty — a declined `advisor_redacted_result` (no `text` field at all) never has one.
 *  EXPORTED for the identical reason `isDeclined` is: `toolRenderer.tsx`'s clickable gate
 *  (`!declined || reason !== undefined`) must agree with what render.ts actually shows on expand. */
export function advisorDeclineReason(content: unknown): string | undefined {
  if (!isDeclined(content)) return undefined;
  return isRecord(content) && content.type === "advisor_result" && typeof content.text === "string" && content.text.length > 0 ? content.text : undefined;
}
function isResultError(content: unknown): boolean {
  return isRecord(content) && content.type === "advisor_tool_result_error";
}

export function advisorResolution(entries: readonly AdvisorEntry[]): AdvisorResolution {
  const resolved = new Set<string>();
  const errored = new Set<string>();
  const assistants = entries.filter((e) => isRecord(e.message) && e.message.type === "assistant");

  // Pass 1 — canon `eGt`: walk every assistant message's content, in document order. A block carrying a
  // string `tool_use_id` (an `advisor_tool_result`) resolves the matching `server_tool_use`'s id; that same
  // block additionally errors it when its own result is an error or a decline.
  for (const entry of assistants) {
    for (const block of contentOf(entry.message)) {
      if (typeof block.tool_use_id !== "string") continue;
      resolved.add(block.tool_use_id);
      if (block.type === "advisor_tool_result" && (isResultError(block.content) || isDeclined(block.content))) errored.add(block.tool_use_id);
    }
  }

  // Pass 2 — canon `tGt`: force-resolve any `server_tool_use`/`mcp_tool_use` id still unresolved, in every
  // assistant message that is NOT the actual retained tail (D17 — never a filtered "last assistant").
  const tail = entries.length > 0 ? entries[entries.length - 1] : undefined;
  const tailId = tail !== undefined && isRecord(tail.message) && tail.message.type === "assistant" ? innerMessageId(tail.message) : undefined;
  for (const entry of assistants) {
    if (innerMessageId(entry.message) === tailId) continue; // this IS the latest assistant message — leave it spinning
    for (const block of contentOf(entry.message)) {
      if ((block.type === "server_tool_use" || block.type === "mcp_tool_use") && typeof block.id === "string" && !resolved.has(block.id)) {
        resolved.add(block.id);
        errored.add(block.id);
      }
    }
  }

  return { resolved, errored };
}
