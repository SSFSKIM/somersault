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
// MEASURED (F8 review Finding A, tmux 3.7b, this machine's config): the sniff SUCCEEDING is the OTHER
// silent case. `allow-passthrough` defaults OFF as of tmux 3.3, this machine's ~/.tmux.conf does not set
// it, and a null config confirms the off default — so when the marker sniff finds a real emulator and
// `auto` resolves to `iterm2`/`kitty`/`ghostty`, the DCS-wrapped bytes below are exactly what tmux drops
// on the floor. The MUXED_UNKNOWN fallback above only rescues the sniff-FAILS half; `notify()` rescues
// the sniff-SUCCEEDS half by also ringing a bare BEL, which reaches tmux's own bell handling regardless
// of the passthrough setting.
//
// Canon: channels `Mie` (L45315), default `"auto"` (L100411), auto-resolution `u9T` (L505906), the four
// emitters in `are()` (L202527-202566), copy at L678604 / L686789.
import { BELL, OSC_GHOSTTY, OSC_ITERM2, OSC_KITTY, isMuxed, notifyTerminator, osc, passthrough, sanitizeNotificationText } from "./terminalEscapes.js";

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

const MUXED_UNKNOWN = "\0muxed-unknown";

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
  // DELIBERATE DIVERGENCE FROM CANON (noted per F8 review Finding H): canon assigns kitty notification
  // ids at random; this counter is monotonic per notifier instance. That is the better choice, not a
  // shortcut — it is trivially collision-free without a PRNG, and per kitty's spec a repeated id
  // REPLACES the prior notification, so uniqueness here is what keeps successive notifications distinct
  // rather than silently collapsing into one.
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
        case "iterm2": deps.write(passthrough(osc(term, OSC_ITERM2, `${t}: ${body}`), env)); break;
        case "iterm2_with_bell": deps.write(passthrough(osc(term, OSC_ITERM2, `${t}: ${body}`), env)); deps.write(BELL); return;
        case "kitty": {
          const id = `ccx-${seq++}`;
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:d=0:p=title`, t), env));
          // CANON-FAITHFUL, NOT PROTOCOL-CORRECT (F8 review Finding E): this chunk carries no `d` key.
          // Kitty's spec defaults `d` to 1, so the notification is already complete and DISPLAYED after
          // this chunk — the trailing `d=1:a=focus` chunk below is a separate command kitty discards.
          // Benign today. Do not add `d=0` here to "finish" the protocol correctly: that changes the
          // observed bytes this module's own test pins, and canon emits it exactly this way.
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:p=body`, body), env));
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:d=1:a=focus`, ""), env));
          break;
        }
        case "ghostty":
          // Ghostty's OSC 777 `notify` parser bounds the title on semicolons (F8 review Finding G): a
          // literal `;` in a caller-supplied title truncates it there. Latent while the title is the
          // constant NOTIF_TITLE, live once a caller passes its own. The body is not similarly stripped —
          // only the title sits in a bounded field before the parser's next delimiter.
          deps.write(passthrough(osc(term, OSC_GHOSTTY, "notify", t.replaceAll(";", ":"), body), env));
          break;
        case "terminal_bell": deps.write(BELL); return;
        default: {
          // EXHAUSTIVENESS GUARD (F8 review Finding D): `channel` is narrowed to `never` here as long as
          // every ResolvedChannel case above is handled — add a case above when the type grows, or this
          // line stops compiling. At RUNTIME this also catches a `preferredNotifChannel` that bypassed
          // the type system (e.g. a hand-edited config): `resolveChannel` returns any non-"auto" value
          // unchanged, so an invalid channel reaches here as a plain string. Ring the bell rather than
          // write nothing — silence is the one outcome this module exists to avoid.
          const _exhaustive: never = channel;
          deps.write(BELL);
          return void _exhaustive;
        }
      }
      // MEASURED (F8 review Finding A): inside a multiplexer, a wrapped sequence reaching this point may
      // have just been silently dropped by tmux's default-off `allow-passthrough` (see the header
      // comment). A bare BEL reaches tmux's own bell handling regardless of that setting, so: passthrough
      // on → rich notification plus a bell; passthrough off → at least a bell. `terminal_bell` and
      // `iterm2_with_bell` already `return` above before reaching here, so this never doubles their bell.
      //
      // NARROWED TO `auto` (F8 review Finding B, design decision): `iterm2`/`kitty`/`ghostty` are also
      // reachable by the user naming them outright via `preferredNotifChannel`, and `iterm2` vs
      // `iterm2_with_bell` exist as two separately selectable channels for exactly this: whether a bell
      // also rings. Firing the fallback bell for an explicit channel would silently override that choice
      // to compensate for a condition — undeliverable passthrough — we cannot detect, even on a machine
      // with `allow-passthrough on` where the rich notification arrives fine. The bell compensates for
      // `auto`'s uncertainty (ccx guessed at the emulator and can't confirm delivery), not for being
      // inside a multiplexer per se — so only fire it when `auto` is what chose this channel.
      if (settings.preferredNotifChannel === "auto" && isMuxed(env)) deps.write(BELL);
    },
  };
}
