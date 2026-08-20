// tui/src/desktopNotify.ts — F8 Task 10: OS-level notifications, per emulator.
//
// A SEPARATE PATH FROM `notifications.ts`, deliberately. That module is the in-terminal ephemeral hint
// queue with its own preemption, folding and pinning; this one hands a string to the terminal emulator
// and forgets it. Canon keeps them apart too (`lH`, L505865, touches no notification store).
//
// IT DOES NOT USE `resolveTerminalName`. That resolver reads TERM_PROGRAM before its TMUX fallback, and
// tmux >= 3.2 stamps `TERM_PROGRAM=tmux` over whatever the outer terminal set — a fact `renderer.ts`
// already records, in the note explaining why its own tmux heuristic is dead there. Reusing it would
// resolve `auto` to `none` in every tmux pane, so this wave's one new capability would ship dead in the
// environment the whole acceptance rig runs in. Inside a multiplexer we read the markers a terminal
// exports into the environment its shells inherit; outside one, TERM/TERM_PROGRAM are trustworthy.
//
// MEASURED (Task 10 Step 1, tmux 3.7b, before this file was written): a pane inherits the tmux SERVER's
// environment, not the client's. A marker set in the shell that creates the session survives into the
// pane only when the server itself is fresh; on a pre-existing server — the ordinary case for a
// long-running server, one started from a launch agent, or one started from a bare shell — none of
// LC_TERMINAL / KITTY_WINDOW_ID / GHOSTTY_RESOURCES_DIR reach the pane even though the invoking shell had
// them set. So the marker sniff can legitimately find nothing. That case must NOT resolve to `none`:
// silence is the one outcome the user cannot distinguish from a broken feature. It resolves to
// `terminal_bell` instead — one byte an unconfigured terminal ignores, the same argument already
// recorded for the Apple Terminal arm (spec D-F8-11), applied to the same problem.
//
// Canon: channels `Mie` (L45315), default `"auto"` (L100411), auto-resolution `u9T` (L505906), the four
// emitters in `are()` (L202527-202566), copy at L678604 / L686789.
import { BELL, OSC_GHOSTTY, OSC_ITERM2, OSC_KITTY, notifyTerminator, osc, passthrough, sanitizeNotificationText } from "./terminalEscapes.js";

/** `Mie` (L45315), verbatim. */
export type NotifChannel = "auto" | "iterm2" | "terminal_bell" | "iterm2_with_bell" | "kitty" | "ghostty" | "notifications_disabled";
/** The reachable subset of canon's `Yxu` — the events ccx can actually observe. */
export type NotifEvent = "permission_prompt" | "idle_prompt" | "agent_needs_input" | "agent_completed";
export type ResolvedChannel = "iterm2" | "iterm2_with_bell" | "kitty" | "ghostty" | "terminal_bell" | "none";

/** Every legal channel, for validating a hand-edited preference. */
export const NOTIF_CHANNELS: readonly NotifChannel[] = ["auto", "iterm2", "terminal_bell", "iterm2_with_bell", "kitty", "ghostty", "notifications_disabled"];
export const NOTIF_EVENTS: readonly NotifEvent[] = ["permission_prompt", "idle_prompt", "agent_needs_input", "agent_completed"];

/** DIVERGENCE FROM CANON (spec D-F8-5): canon's default fires every event; ccx defaults to the two that
 *  mean "ccx is blocked on you". Both others ship and are settable. */
export const NOTIF_DEFAULT_EVENTS: readonly NotifEvent[] = ["permission_prompt", "idle_prompt"];

/** ccx's identity, standing in for canon's `sJm = "Claude Code"` (L505957) — the terminal title's rule
 *  (spec D-C9): shape fidelity, not impersonation. */
export const NOTIF_TITLE = "ccx";

export interface NotifSettings { preferredNotifChannel: NotifChannel; enabledEvents: readonly NotifEvent[] }

/** The emulator underneath, multiplexer-aware. Marker order is set by Task 10 Step 1's measurement. */
function underlyingTerminal(env: NodeJS.ProcessEnv): string | undefined {
  const muxed = env.TMUX !== undefined || env.STY !== undefined || env.TERM_PROGRAM === "tmux" || env.TERM_PROGRAM === "screen";
  if (!muxed) {
    if (env.TERM === "xterm-ghostty" || env.GHOSTTY_RESOURCES_DIR !== undefined) return "ghostty";
    if (env.TERM?.includes("kitty") === true || env.KITTY_WINDOW_ID !== undefined) return "kitty";
    return env.TERM_PROGRAM;
  }
  // Inside a multiplexer TERM and TERM_PROGRAM belong to the multiplexer, not the emulator. These are
  // the variables a terminal exports into the environment its shells inherit, which tmux captures at
  // session creation. KNOWN LIMIT, accepted: a server started from terminal A and attached from B keeps
  // A's markers. The wrong emulator's escape is ignored by the right one, and `preferredNotifChannel`
  // overrides the sniff entirely — which is the escape hatch this limit is why we keep.
  if (env.GHOSTTY_RESOURCES_DIR !== undefined) return "ghostty";
  if (env.KITTY_WINDOW_ID !== undefined || env.KITTY_PID !== undefined) return "kitty";
  if (env.LC_TERMINAL === "iTerm2") return "iTerm.app";
  // Measured (Step 1): a pane inherits the SERVER's environment, so when the server predates the
  // terminal these markers are absent entirely — not stale, absent. `MUXED_UNKNOWN` keeps that case
  // distinguishable from "no multiplexer and no idea", so `resolveChannel` can ring the bell rather
  // than go silent.
  return MUXED_UNKNOWN;
}
const MUXED_UNKNOWN = "\0muxed-unknown";

/** canon's `u9T` (L505906), over the resolver above.
 *
 *  RECORDED DIVERGENCE (spec D-F8-11): canon's Apple Terminal arm is asynchronous — `await p9T()`
 *  inspects the active Terminal profile and returns `no_method_available` when it says no. ccx resolves
 *  synchronously and always chooses the bell: one byte an unconfigured terminal ignores, versus a
 *  notification that silently never arrives. */
export function resolveChannel(configured: NotifChannel, env: NodeJS.ProcessEnv = process.env): ResolvedChannel {
  if (configured === "notifications_disabled") return "none";
  if (configured !== "auto") return configured;
  switch (underlyingTerminal(env)) {
    case "iTerm.app": return "iterm2";
    case "kitty": return "kitty";
    case "ghostty": return "ghostty";
    case "Apple_Terminal": return "terminal_bell";
    // Inside a multiplexer we could not identify the emulator — measured to be the ORDINARY case on any
    // pre-existing tmux server. Ring the bell rather than go silent: silence is the one outcome a user
    // cannot tell apart from a broken feature, and a bell is one byte an unconfigured terminal ignores.
    // `preferredNotifChannel` remains the way to name the emulator outright.
    case MUXED_UNKNOWN: return "terminal_bell";
    default: return "none";
  }
}

export interface DesktopNotifierDeps {
  /** Direct stdout, bypassing Ink — `terminalTitle`'s arrangement, for the same reason. */
  write(s: string): void;
  /** Read at CALL time, never captured: a `/config` change must take effect on the next event. */
  settings: () => NotifSettings;
  env?: NodeJS.ProcessEnv;
}

export interface DesktopNotifier { notify(event: NotifEvent, message: string, title?: string): void }

export function createDesktopNotifier(deps: DesktopNotifierDeps): DesktopNotifier {
  const env = deps.env ?? process.env;
  let seq = 0;
  return {
    notify(event, message, title = NOTIF_TITLE): void {
      const settings = deps.settings();
      if (!settings.enabledEvents.includes(event)) return;
      const channel = resolveChannel(settings.preferredNotifChannel, env);
      if (channel === "none") return;
      const t = sanitizeNotificationText(title), body = sanitizeNotificationText(message);
      const term = notifyTerminator(env);
      // COMPOSITION IS PER CHANNEL. The bell is a BARE byte: not an escape sequence, so there is nothing
      // for a multiplexer to pass through — and canon does not wrap it either, including the BEL half of
      // `iterm2_with_bell`.
      switch (channel) {
        case "iterm2": deps.write(passthrough(osc(term, OSC_ITERM2, `${t}: ${body}`), env)); return;
        case "iterm2_with_bell": deps.write(passthrough(osc(term, OSC_ITERM2, `${t}: ${body}`), env)); deps.write(BELL); return;
        case "kitty": {
          const id = `ccx-${seq++}`;
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:d=0:p=title`, t), env));
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:p=body`, body), env));
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:d=1:a=focus`, ""), env));
          return;
        }
        case "ghostty": deps.write(passthrough(osc(term, OSC_GHOSTTY, "notify", t, body), env)); return;
        case "terminal_bell": deps.write(BELL); return;
      }
    },
  };
}
