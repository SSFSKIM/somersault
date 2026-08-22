// tui/src/copy.ts — F9 T-MOUSE Task 7: the dual-channel clipboard write (research r1-mouse.md §2.5's `yP`/
// `gTp`/`i2n`/`Mts`, canon L188574-188631 + L188518-188530 + L551407-551424). Two independent halves run on
// EVERY call: a best-effort NATIVE tool spawn (skipped outright over SSH — there is no local clipboard to
// reach), and an OSC 52 escape sequence that is ALWAYS built (SSH or not — it is the one channel that can
// cross a remote session) and handed back to the caller to write, never written here. `copyToClipboard`
// below is the pre-Task-7 shape kept alive for `/copy`/`/export clipboard` (`useChat.ts`'s own `copyText`
// local, a DIFFERENT function from this file's `copyText`): those commands want a bare `Promise<void>` that
// REJECTS on a failed write (their pre-Task-7 contract) and no OSC 52 side-write to stdout — behaviour
// Task 7's brief pins as unchanged, so it calls the native half directly rather than through `copyText`,
// which never rejects (a failed native attempt there just falls the toast back to `osc52`).
import { spawn as realSpawn } from "node:child_process";

type SpawnFn = typeof realSpawn;

/** DI'd exactly like the pre-Task-7 `copyToClipboard` was: `env`/`platform`/`spawn` are read from the real
 *  process by default, swapped for synthetic ones in tests (`copyChannels.test.ts`) the same way `bash.ts`'s
 *  `runBash` is. `write`, unlike the other three, is a CONVENIENCE rather than a requirement: the documented
 *  contract is "the caller writes `oscBytes` to stdout" (ChatApp's auto-copy/`Ctrl+C` paths do exactly that,
 *  sequencing the write after the toast), but a caller that does not need that sequencing — none exists yet
 *  in this harness, kept for interface fidelity with the brief's own signature — can ask `copyText` to write
 *  the bytes itself instead of round-tripping them back out. */
export interface CopyDeps {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  spawn?: SpawnFn;
  write?: (bytes: string) => void;
}

export interface CopyResult {
  channel: "native" | "tmux-buffer" | "osc52";
  oscBytes: string | null;
}

/** One child process, fed `text` on stdin, resolved `true`/`false` — never rejects, so a chain of fallback
 *  tools (`linuxSelection` below) can just `await` each in turn without a `try`/`catch` at every step. A
 *  `spawn` that THROWS synchronously (a test stub simulating "command not found" without going through the
 *  child's own `error` event) is caught the same way a real ENOENT is. */
function spawnWrite(spawn: SpawnFn, cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    let child: ReturnType<SpawnFn>;
    try { child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] }); }
    catch { done(false); return; }
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
    child.stdin!.end(text);
  });
}

/** Linux carries TWO independent X11 selections — `CLIPBOARD` (paste with ctrl+v) and `PRIMARY` (paste with
 *  a middle click) — and canon writes BOTH (R1 §2.5: "wl-copy (+`--primary`) / xclip … *and* primary / xsel").
 *  Each selection gets its OWN tool chain (wl-copy → xclip → xsel, canon's own probe order) rather than the
 *  two selections sharing one fallback decision: a Wayland compositor with `wl-copy` but no `xclip` must
 *  still get its PRIMARY write attempted via `wl-copy --primary`, not silently skipped because CLIPBOARD's
 *  chain already picked a winner. */
async function linuxSelection(spawn: SpawnFn, text: string, selection: "clipboard" | "primary"): Promise<boolean> {
  const primary = selection === "primary";
  if (await spawnWrite(spawn, "wl-copy", primary ? ["--primary"] : [], text)) return true;
  if (await spawnWrite(spawn, "xclip", ["-selection", selection], text)) return true;
  if (await spawnWrite(spawn, "xsel", [primary ? "--primary" : "--clipboard"], text)) return true;
  return false;
}

/** win32 (and WSL, which reports `platform === "linux"` upstream but never reaches here without an X server
 *  — out of scope, recorded omission): `clip.exe` first (ships with every Windows install, reads stdin
 *  directly, exactly the pre-Task-7 chain), falling back to PowerShell's `Set-Clipboard` for the odd shell
 *  that lacks it. The command is base64/UTF-16LE-`-EncodedCommand`'d rather than interpolated as a `-Command`
 *  argument string — the text this ever carries is arbitrary user selection, and an encoded command is the
 *  one shape PowerShell can never reinterpret as shell syntax. */
async function windowsCopy(spawn: SpawnFn, text: string): Promise<boolean> {
  if (await spawnWrite(spawn, "clip", [], text)) return true;
  const encoded = Buffer.from("Set-Clipboard -Value ([Console]::In.ReadToEnd())", "utf16le").toString("base64");
  return spawnWrite(spawn, "powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], text);
}

/** The native half of `yP` (R1 §2.5's `gTp`) — `false` for an unsupported platform or a fully-exhausted
 *  chain, never a throw. */
async function nativeCopy(spawn: SpawnFn, platform: string, text: string): Promise<boolean> {
  if (platform === "darwin") return spawnWrite(spawn, "pbcopy", [], text);
  if (platform === "linux") {
    // Both selections are attempted independently — see `linuxSelection`'s own doc for why one write must
    // not gate the other. `||`, not `&&`: ChatApp's toast only needs to know SOMETHING landed natively.
    const clipboard = await linuxSelection(spawn, text, "clipboard");
    const primary = await linuxSelection(spawn, text, "primary");
    return clipboard || primary;
  }
  if (platform === "win32") return windowsCopy(spawn, text);
  return false;
}

/** GNU screen's DCS envelope has a payload cap (documented divergence: canon's own chunk constant, `sTp`, is
 *  not recoverable from outside the bundle — this ports the widely-used `vim-oscyank`/`tmux-yank` convention
 *  of 76 base64 characters per DCS chunk, which is comfortably under every documented screen limit). The
 *  FIRST chunk opens with `ESC P` and immediately carries the OSC 52 prefix (`ESC]52;c;`); every later chunk
 *  closes the previous DCS string (`ESC \`) and opens a fresh one (`ESC P`) before its own base64 slice; the
 *  LAST chunk is BEL-terminated (the OSC's own terminator) and then DCS-closed — screen forwards the BEL to
 *  the real terminal as the OSC 52 payload's end, exactly as it would for an unchunked one. */
const SCREEN_CHUNK = 76;
function screenChunk(b64: string): string {
  let out = "";
  for (let i = 0; i < b64.length; i += SCREEN_CHUNK) {
    const chunk = b64.slice(i, i + SCREEN_CHUNK);
    out += i === 0 ? `\x1bP\x1b]52;c;${chunk}` : `\x1b\\\x1bP${chunk}`;
  }
  return `${out}\x07\x1b\\`;
}

/** tmux's DCS passthrough (canon's `Fq`, R1 §2.5): `ESC Ptmux;` + the wrapped payload with every literal ESC
 *  DOUBLED (tmux's own escaping rule for a passthrough body — otherwise tmux would read the payload's OWN
 *  `ESC]52;…` as the START of a nested control sequence rather than opaque bytes to forward) + the DCS
 *  terminator `ESC \`. The plain OSC 52 string (`buildOscBytes`'s own BEL-terminated form) carries exactly
 *  one ESC, so this always doubles that one byte. */
function tmuxPassthrough(payload: string): string {
  const escaped = payload.replace(/\x1b/g, "\x1b\x1b");
  return `\x1bPtmux;${escaped}\x1b\\`;
}

/** ALWAYS builds the OSC 52 string (R1 §2.5: "in every case it returns an OSC 52 string for stdout"),
 *  regardless of whether the native half ran or succeeded — SSH included, which is the one case that has NO
 *  other channel at all. `$TMUX` and `$STY` are mutually exclusive in practice (screen does not run inside
 *  tmux's own multiplexed pane the way tmux can run inside screen's), so checking `TMUX` first and falling
 *  through to `STY` never has to arbitrate a real conflict; a plain terminal gets the bare BEL-terminated
 *  form, kitty's ST-vs-BEL split (R1's own aside) is a recorded omission — nothing in this track's required
 *  cells exercises it. */
function buildOscBytes(text: string, env: NodeJS.ProcessEnv): string {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const plain = `\x1b]52;c;${b64}\x07`;
  if (env.TMUX) return tmuxPassthrough(plain);
  if (env.STY) return screenChunk(b64);
  return plain;
}

/** The whole of `yP` + `i2n` (R1 §2.5): native copy attempted unless over SSH, OSC 52 built unconditionally,
 *  and `channel` resolved by canon's own priority — `"native"` when the native half actually landed (SSH
 *  already rules it out; "a tool exists" collapses to "the write worked" here, since this port has no
 *  separate cached-probe step to consult ahead of the attempt), else `"tmux-buffer"` under `$TMUX`, else
 *  `"osc52"`. The caller (ChatApp's auto-copy latch and its `Ctrl+C` arm) writes `oscBytes` to stdout AFTER
 *  showing the toast `channel` drives — sequencing this function has no opinion about. Never rejects: a
 *  fully-failed native attempt just demotes the channel, matching canon's own "both channels, always" frame
 *  (there is no failure mode this function itself needs to report). */
export async function copyText(text: string, deps: CopyDeps = {}): Promise<CopyResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? realSpawn;
  const isSSH = !!env.SSH_CONNECTION;
  const nativeOk = isSSH ? false : await nativeCopy(spawn, platform, text);
  const oscBytes = buildOscBytes(text, env);
  deps.write?.(oscBytes);
  const channel: CopyResult["channel"] = nativeOk ? "native" : env.TMUX ? "tmux-buffer" : "osc52";
  return { channel, oscBytes };
}

/** Canon's `n2n` (R1 §2.5, L188443-188456): which modifier bypasses OSC 52's terminal-selection theft, by
 *  `$TERM_PROGRAM`. This is the one place that string is read for the whole feature — every other channel
 *  decision is env/platform, not the emulator's own identity. */
function copyBypassModifier(termProgram: string | undefined): "Fn" | "Option" | "Shift" {
  if (termProgram === "Apple_Terminal") return "Fn";
  if (termProgram === "iTerm.app") return "Option";
  return "Shift";
}

/** Canon's `Mts` toast text (R1 §2.5), verbatim, keyed by the SAME `channel` `copyText` returned. */
export function copyToastText(channel: CopyResult["channel"], chars: number, termProgram: string | undefined): string {
  if (channel === "native") return `copied ${chars} chars to clipboard`;
  if (channel === "tmux-buffer") return `copied ${chars} chars to tmux buffer · paste with prefix + ]`;
  return `sent ${chars} chars via OSC 52 · if paste fails, hold ${copyBypassModifier(termProgram)} while selecting for native copy`;
}

/** The pre-Task-7 shape (`useChat.ts`'s `realCopyToClipboard`, feeding its OWN `copyText` local for `/copy`/
 *  `/export clipboard`): native-only, and REJECTS on a failed write exactly as the old implementation did
 *  (those two commands have no error handling around their `await copyText(t)` call, so silently swallowing
 *  a failure — `copyText` above's own contract — would be a behaviour change this task does not own). Every
 *  existing `/copy`/`/export clipboard` test injects its OWN `copyText` dep and never reaches this function
 *  at all (confirmed against `useChat.test.tsx`), so this is exercised only by the real, un-injected
 *  production path. */
export async function copyToClipboard(text: string, deps: { platform?: string; spawn?: SpawnFn } = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? realSpawn;
  const ok = await nativeCopy(spawn, platform, text);
  if (!ok) throw new Error(`no working clipboard tool for ${platform}`);
}
