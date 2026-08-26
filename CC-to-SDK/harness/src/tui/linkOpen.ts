// tui/src/linkOpen.ts — bl5 T-LINKOPEN Task 2: the pure gate decision + scheme allowlist + spawn wrapper
// behind canon 2.1.246's transcript-link self-open flip. Full byte evidence in
// .doperpowers/sdd/2026-08-26-bl5-round/research-links.md — this file transcribes exactly three pieces of
// that research and nothing else; the dispatch wiring (arming/cancelling the 500 ms timer, reading the
// window-activation flag off the keys layer, resolving `linkHrefAt`) is Task 3's job in ChatApp.tsx, not
// this module's. Everything here is pure or DI'd so the unit suite never spawns a real browser.
import { spawn as realSpawn } from "node:child_process";

/** What Task 3's ChatApp sink knows about a paired press+release by the time it asks whether to open:
 *  which SGR modifier bits were set, and whether the press immediately followed a terminal focus-in
 *  (`ESC[I`, DECSET 1004) — canon's `pressIsWindowActivation` (research-links.md §3c, offset 184525314).
 *  A window-activation press answers false no matter what else is true; it exists to eat the click that
 *  merely refocused the terminal, not to open anything. */
export interface LinkClickPress {
  alt: boolean;
  ctrl: boolean;
  isWindowActivation: boolean;
}

/** Canon's release-time gate (§3c, offset 184525314 — the `if(f==="unhandled"&&!e.pressIsWindowActivation)`
 *  block), transcribed term-for-term:
 *    NOT TERM_PROGRAM==="vscode"           — `He.TERM_PROGRAM!=="vscode"` (`xi()`'s xterm.js half is
 *                                             PARKED per plan D5; this gate is a partial transcription)
 *    AND NOT isWindowActivation            — `!e.pressIsWindowActivation`
 *    AND ( alt || ctrl                     — `(o.button&24)!==0`: SGR bit 8 (Meta/Alt) | bit 16 (Ctrl)
 *          OR (darwin AND ghostty|Warp) )  — `AE.macCmdClickArrivesWithoutSgrModifierBit()` (offset
 *                                             184189991): those two terminals forward cmd+click to the
 *                                             app with no SGR modifier bit at all, so the *plain* release
 *                                             is the only signal available. `NE()`'s XTVERSION-sniffed
 *                                             Ghostty fallback is PARKED per plan D5 (no XTVERSION probe).
 *  Order matters for readability, not behavior: vscode and window-activation are checked first because
 *  they're absolute vetoes, independent of every modifier/terminal term that follows. */
export function shouldOpenOnClick(
  press: LinkClickPress,
  env: { TERM_PROGRAM?: string },
  platform: NodeJS.Platform,
): boolean {
  if (env.TERM_PROGRAM === "vscode") return false;
  if (press.isWindowActivation) return false;
  if (press.alt || press.ctrl) return true;
  return platform === "darwin" && (env.TERM_PROGRAM === "ghostty" || env.TERM_PROGRAM === "WarpTerminal");
}

/** Canon's scheme allowlist (§2a, offset 184275720), verbatim — 13 entries: http/https plus 11 app-launch
 *  schemes. Order and membership copied byte-for-byte from the research doc's `E=new Set([...])` literal;
 *  do not "clean up" this list without re-checking that offset. */
const ALLOWED_SCHEMES = new Set([
  "https:", "http:", "vscode:", "vscode-insiders:", "cursor:", "windsurf:", "zed:",
  "jetbrains:", "idea:", "slack:", "linear:", "notion:", "figma:",
]);

/** A leading `scheme:` shape, used only to name the scheme of a URL the WHATWG `URL` constructor itself
 *  rejects (e.g. a bare "not a url at all" has no colon at all) — canon's own `I(r)` never needs this
 *  because its refusal path only runs on a URL that parsed; ours reports SOME scheme in the refused
 *  variant even when parsing failed outright, falling back to the literal string "invalid". */
const SCHEME_LIKE_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/;

export type LinkUrlClassification =
  | { kind: "open" }
  | { kind: "file-noop" }
  | { kind: "refused"; scheme: string };

/** Canon's `I(r)` (§2a, offset 184274065) minus the actual dispatch — classification only, so `openUrl`
 *  below can act on the verdict without re-parsing. `file:` gets its own branch ahead of the allowlist
 *  check for the same reason canon special-cases it first: it's a real, recognized scheme that still must
 *  not fall through to the browser. Spec D6: this clone has no editor-panel surface for `file:` links to
 *  route to (canon's `fileHyperlinkOpensInPanel` path), so where canon opens the editor, this is a no-op
 *  rather than a browser open — opening `file:///etc/hosts` in a browser would be a worse divergence than
 *  doing nothing. */
export function classifyLinkUrl(url: string): LinkUrlClassification {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    const match = SCHEME_LIKE_PREFIX.exec(url);
    return { kind: "refused", scheme: match ? match[1]! : "invalid" };
  }
  if (parsed.protocol === "file:") return { kind: "file-noop" };
  if (ALLOWED_SCHEMES.has(parsed.protocol)) return { kind: "open" };
  return { kind: "refused", scheme: parsed.protocol };
}

type SpawnFn = typeof realSpawn;

/** DI'd exactly like `copy.ts`'s `CopyDeps`: `env`/`platform`/`spawn` read from the real process by
 *  default, swapped for synthetic ones in tests. `warn` defaults to `console.warn` — canon's own refusal
 *  path is a logged warning, not a thrown error, and nothing here needs the caller to react to it. */
export interface OpenUrlDeps {
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  warn?: (message: string) => void;
}

/** Canon's headless-Linux guard, `p()` (§2a, offset 184274180): `platform==="linux" && !DISPLAY &&
 *  !WAYLAND_DISPLAY`. Canon only consults this when no `$BROWSER` override is configured (its own `f(r)`
 *  checks `if(!o&&p())` — `o` is the resolved browser command); an explicit `$BROWSER` is trusted to know
 *  what it's doing even on a display-less box (e.g. a headless CI box with a browser-shaped script). */
function isHeadlessLinux(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

/** Canon's `f(r)` (§2a, offset 184274904): resolve the browser command — `$BROWSER` override, else
 *  darwin's `open`, else `xdg-open` — and fire-and-forget spawn it with the URL as the sole argument.
 *  Fire-and-forget mirrors `copy.ts`'s spawn idiom (`stdio:["ignore","ignore","ignore"]`, errors
 *  swallowed) but does NOT await a `close`/`error` promise the way `copy.ts`'s `spawnWrite` does: canon
 *  itself does not block the click handler on the child's exit, and `openUrl`'s own signature is `void`.
 *  A synchronous throw from `spawn` (a stub simulating "command not found" without the child's own
 *  `error` event, or a real ENOENT on some platforms) and the child's async `error` event are both
 *  swallowed — there is nothing left here to report a spawn failure to. */
function launchBrowser(url: string, spawn: SpawnFn, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  const command = env.BROWSER || (platform === "darwin" ? "open" : "xdg-open");
  try {
    const child = spawn(command, [url], { stdio: ["ignore", "ignore", "ignore"], detached: true });
    child.on("error", () => {});
    child.unref?.();
  } catch {
    // no working browser command — nothing to report, matching canon's own swallow-and-move-on shape.
  }
}

/** The whole of canon's `I(r)` (§2a) from the click side: classify, then act. `file-noop` does nothing at
 *  all (no warn, no spawn — see `classifyLinkUrl`'s doc). `refused` warns the EXACT canon copy (offset
 *  184274264) and spawns nothing. `open` applies the headless-Linux guard before resolving/launching the
 *  browser command. */
export function openUrl(url: string, io: OpenUrlDeps = {}): void {
  const classification = classifyLinkUrl(url);
  if (classification.kind === "file-noop") return;
  if (classification.kind === "refused") {
    const warn = io.warn ?? ((message: string) => console.warn(message));
    warn(`[hyperlink] refusing to dispatch clicked link with non-allowlisted scheme ${classification.scheme}`);
    return;
  }
  const env = io.env ?? process.env;
  const platform = io.platform ?? process.platform;
  if (!env.BROWSER && isHeadlessLinux(platform, env)) return;
  const spawn = io.spawn ?? realSpawn;
  launchBrowser(url, spawn, env, platform);
}
