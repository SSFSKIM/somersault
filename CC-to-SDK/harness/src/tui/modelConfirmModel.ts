// tui/src/modelConfirmModel.ts — the model-switch confirm's GATE and its copy (Wave S T12, EP-S8).
// React-free on purpose: the gate is the interesting half and it is pure, so it is testable without a
// terminal, and `ModelPicker` (which must run it BEFORE its prefs write) imports it without a cycle.
//
// The gate is upstream's `XMo` (L315221) and it is four conditions ANDed, none of which is "the models
// differ" on its own. What it protects is the prompt cache: a mid-conversation switch throws away the
// cached prefix and the next turn re-reads the whole history at full price. Before the model has emitted a
// token there is no cache worth warning about, which is why the denominator is CUMULATIVE OUTPUT tokens and
// not "are there messages" — a session where only user text was typed switches silently.
import { resolveModelAlias } from "../config/models.js";
import type { RenderLine } from "./render.js";

/** L447014-447039, verbatim. */
export const CONFIRM_TITLE = "Switch model?";
export const CONFIRM_SUBTITLE = "Your next response will be slower and use more tokens";
export const CONFIRM_CANCEL = "No, go back";
export const confirmAccept = (target: string) => `Yes, switch to ${target}`;

/** The body sentence. Segments rather than one `text` for the same reason `formatModelSet` is: the target's
 *  DISPLAY name is bold inside an otherwise plain run. */
export function confirmBody(target: string): RenderLine[] {
  return [{ text: "", segments: [
    { text: "This conversation is cached for the current model. Switching to " },
    { text: target, bold: true },
    { text: " means the full history gets re-read on your next message." },
  ] }];
}

/** Condition 4: `claude-fable-5[1m]` and `claude-fable-5` are ONE model at two context windows, and
 *  swapping the window does not invalidate the prompt cache. */
export function stripContextSuffix(id: string): string { return id.replace(/\[(1|2)m\]/gi, ""); }

/** Strip the window suffix, then resolve the tier alias — the picker's rows are aliases ("opus") while the
 *  session's model is a resolved id ("claude-opus-5"), so both sides have to land in the same vocabulary
 *  before they can be compared. NB `resolveModelAlias` passes an unknown string THROUGH unchanged (it
 *  returns `undefined` only for `undefined` input), so an id it has never heard of compares as itself. */
const norm = (id: string) => (resolveModelAlias(stripContextSuffix(id)) ?? stripContextSuffix(id)).trim().toLowerCase();

export function needsModelConfirm(a: {
  next: string;
  /** The catalog row that reads as the model in force. */
  current?: string;
  /** A session-only (`s`) override, which outranks `current`: it is what is actually running, and so it is
   *  what the cache belongs to. */
  sessionModel?: string;
  /** Session-CUMULATIVE output tokens (`totalOutputTokens(session.usage())`), not the per-turn count. */
  outputTokens: number;
  /** The output count at which this warning was last accepted. */
  ackedAt?: number;
}): boolean {
  // 1. Mid-conversation only.
  if (!(a.outputTokens > 0)) return false;
  // 2. Not already acknowledged at this output count — accepting stamps the count, and the user is not
  //    asked again until the model has produced more output (i.e. a new cache worth losing).
  if (a.ackedAt !== undefined && a.ackedAt >= a.outputTokens) return false;
  // 3/4. A model we cannot name is a model we cannot say differs. Staying silent is the conservative side
  //      here: a spurious confirm costs the user the switch they asked for if they decline it.
  const from = a.sessionModel ?? a.current;
  if (from === undefined) return false;
  return norm(a.next) !== norm(from);
}
