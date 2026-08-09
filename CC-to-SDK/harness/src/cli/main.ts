import { parseCcx, nonLocalWithoutToken, UnknownFlagError } from "./args.js";
import type { CcxInvocation } from "./args.js";
import { versionLine, helpText, doctorReport } from "./help.js";
import { spawnDetached as realSpawnDetached } from "./spawn.js";
import { runHostMain as realRunHostMain } from "./hostMain.js";
import { collectFleet as realCollectFleet } from "../fleet/index.js";
import type { AgentsRow } from "../fleet/project.js";
import { renderAgents } from "./agents.js";
import { stopSession as realStopSession, rmSession as realRmSession, fleetGc as realFleetGc } from "./lifecycle.js";
import { ensureWorktree as realEnsureWorktree } from "./worktree.js";
import { SessionHost } from "../host/host.js";
import type { SessionHostOpts } from "../host/host.js";
import { mintShortId, hostSocketPath } from "../fleet/paths.js";
import { welcomeBanner } from "../tui/banner.js";
import type { AccountFacts } from "../tui/banner.js";
import { resolveModelAlias } from "../config/models.js";
import { DEFAULTS } from "../config/types.js";
import { resolvedPermissionMode } from "../config/resolveOptions.js";
import { parseThinkArg, thinkingConfigFrom } from "../tui/thinkLevels.js";
// Value import, and safe: prefs.ts is plain fs + the theme table, no React (main.ts stays React-free).
import { loadPrefs as realLoadPrefs } from "../tui/prefs.js";
import type { CcxPrefs } from "../tui/prefs.js";
// Value import, and safe for the same reason, deliberately: bypassAccepted.ts holds ONLY the acceptance
// predicate and has no runtime imports at all, which is why the canon reader could be split out of the
// `.tsx` dialog and shared with this file instead of re-implemented here as a raw prefs read.
import { hasAcceptedBypass } from "../tui/bypassAccepted.js";
import { prepareAttach as realPrepareAttach } from "./attach.js";
import { resolveResumeArg as realResolveResume } from "./resolveResume.js";
import { socketAnswers as realSocketAnswers } from "../fleet/liveness.js";
// type-only: main.ts stays React-free. The ink import happens only inside the DEFAULT runChatClient,
// via a dynamic import — an interactive path that never runs (e.g. every non-TTY/-p/--bg invocation)
// never pulls ink/React into the process at all.
import type { ChatClientOpts } from "../tui/chatMain.js";

/** One entry per dispatch target. Injected so a unit test can exercise the ROUTING without spawning a
 *  process, opening an SDK session, touching the real fleet directory or running git. */
export interface MainDeps {
  runHostMain: (argv: string[]) => Promise<void>;
  collectFleet: () => Promise<AgentsRow[]>;
  spawnDetached: (inv: CcxInvocation) => { short: string; banner: string };
  ensureWorktree: (repo: string, name: string) => Promise<string>;
  stopSession: (target: string) => Promise<void>;
  rmSession: (target: string) => Promise<void>;
  fleetGc: () => Promise<string[]>;
  runChatClient: (o: ChatClientOpts) => Promise<void>;
  makeHost: (o: SessionHostOpts) => SessionHost;
  runOnce: (inv: CcxInvocation) => Promise<string>;
  isTTY: () => boolean;
  prepareAttach: typeof realPrepareAttach;
  /** W-S6's `--resume <arg>` resolver. A SEAM like every other reader here: it lists this directory's
   *  transcripts and reads the fleet roster, so a routing test that did not inject it would depend on
   *  whatever sessions the machine running the suite happens to hold. */
  resolveResume: typeof realResolveResume;
  probeSocket: (path: string) => Promise<void>;
  runServe: (inv: CcxInvocation) => Promise<void>;
  /** The ccx client prefs (F6 T11). Injected for the same reason every other seam here is: a test must be
   *  able to say what is on disk without writing to the user's real prefs file. */
  loadPrefs: () => CcxPrefs;
  /** Wave-T T15 — the bypass consent gate. A SEAM, not a static import, for the same React-free reason
   *  `runChatClient` is one: `../tui/bypassConsent.js` is a `.tsx` module, and naming it up top would pull
   *  ink/React into every `-p` and `--bg` invocation. Resolves only when the warning is accepted; every
   *  other outcome exits the process from inside (decline 1, Escape 0). */
  showBypassConsent: () => Promise<void>;
}
const defaults: MainDeps = {
  runHostMain: realRunHostMain, collectFleet: realCollectFleet, spawnDetached: realSpawnDetached,
  ensureWorktree: realEnsureWorktree, stopSession: realStopSession, rmSession: realRmSession, fleetGc: realFleetGc,
  makeHost: (o) => new SessionHost(o),
  // The React-free guarantee: the import happens only when an interactive path actually calls it.
  runChatClient: async (o) => (await import("../tui/chatMain.js")).runChatClient(o),
  prepareAttach: realPrepareAttach,
  resolveResume: realResolveResume,
  loadPrefs: () => realLoadPrefs(),
  // The React-free guarantee again: the ink/React module tree loads only when a bypass launch actually
  // reaches the gate.
  showBypassConsent: async () => (await import("../tui/bypassConsent.js")).showBypassConsent(),
  // Wraps the fleet's existing boolean prober (socketAnswers, which already swallows error codes) into
  // the throw-shaped seam attachToImpl expects — no second prober, no expectation of an error code.
  probeSocket: async (p) => {
    if (!(await realSocketAnswers(p))) throw Object.assign(new Error(`no host listening at ${p}`), { code: "HOST_NOT_LISTENING" });
  },
  runOnce: async (inv) => {
    const { createHarness } = await import("../harness.js");
    // --think reached only runForegroundImpl before F4; -p is headless (no REPL /think), so the launch
    // flag is the ONLY way to set it here — same mapping, via the shared helper.
    const thinking = thinkingConfigFrom(inv.think);
    // RunResult.result IS the final string directly (harness.ts's run(): `if ("result" in mm) result =
    // mm.result` copies the SDK result message's own `result` field verbatim, one layer, not two).
    const r = await createHarness({ ...inv.config, ...(thinking ? { thinking } : {}) }).run(inv.prompt!);
    return typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  },
  isTTY: () => Boolean(process.stdin.isTTY),
  // The React-free-equivalent guarantee for the WebSocket stack: `ws` and the whole appserver module tree
  // load only when a `serve` invocation actually reaches this dispatch, never for `-p`/`--bg`/foreground.
  runServe: async (inv) => { const { runServe } = await import("./serveMain.js"); await runServe(inv); },
};

const msg = (e: unknown): string => (e as Error)?.message ?? String(e);
/** ONE stderr shape for the whole program — `ccx: <what went wrong>` — so a parse error, a refusal and a
 *  throw caught at the top level in bin.ts all read the same way to an operator tailing a daemon's log. */
const fail = (text: string, code: number): number => { console.error(`ccx: ${text}`); return code; };

/** Returns the exit code; never throws for an operator error. Everything a consumer script reads —
 *  the banner on stdout, the refusal on stderr, the code — is decided here. */
export async function main(argv: string[], deps: MainDeps = defaults): Promise<number> {
  // POSITIONAL, matching parseHostArgv's own contract. `argv.includes("--__host")` reads a marker out of
  // any position, so `ccx --bg --model --__host task` — a legitimate run whose model value repeats the
  // word — was routed to the child entry point, where it throws because the marker is not first.
  if (argv[0] === "--__host") { await deps.runHostMain(argv); return 0; }
  let inv: CcxInvocation;
  try { inv = parseCcx(argv); }
  catch (e) {
    // The ONE parse throw that is not an operator error in ccx's voice: commander writes the unknown-option
    // line raw (no `ccx: ` prefix, no usage block) and exits 1 (annex §C3.4). Everything else — the
    // KNOWN_UNSUPPORTED refusals, the value-domain rejections, the dangling-value throws — keeps exit 2.
    if (e instanceof UnknownFlagError) { console.error(e.message); return 1; }
    return fail(msg(e), 2);
  }
  // BEFORE every cross-flag refusal, the TTY gate and any host: the two printers answer about the program,
  // not about this invocation, so `ccx -c --resume x --help` prints help rather than the refusal it would
  // otherwise earn — commander's help/version intercepts run ahead of any action too.
  if (inv.version) { console.log(versionLine()); return 0; }
  if (inv.help) { console.log(helpText()); return 0; }

  // Main-level, NOT parseCcx: the detached child re-parses its own argv WITHOUT --detachable but WITH
  // this forwarded flag (spawn.ts's configFlags), so a grammar-level rule would kill every detachable
  // child at startup. Checked before any arm runs, for every command — --idle-timeout parses regardless
  // of subcommand (see args.ts), so `ccx agents --idle-timeout 5` must be refused here too.
  if (inv.idleTimeoutSec && (inv.command !== "run" || !inv.detachable)) return fail("--idle-timeout only applies to --detachable sessions", 2);
  // Same placement rule and the same reason (Task 9): a cross-flag contradiction, refused once for every
  // arm rather than in the grammar. `--continue` is never forwarded to a detached child (spawn.ts's
  // configFlags carries config fields only), so no re-parsing child can trip on it.
  if (inv.continue && inv.config.resume) return fail("--continue and --resume are mutually exclusive — --continue takes the most recent session, --resume takes the one you name", 2);
  // THE in-process REPL launch, and the condition both prompt refusals below key on. `--detachable` is
  // deliberately NOT one: its prompt travels with the client we attach with while its `--resume` travels
  // to the spawned child's own config, so the two never meet and there is nothing to refuse.
  const foregroundRun = inv.command === "run" && !inv.bg && !inv.print && !inv.detachable;
  // Only the foreground REPL has a launch-resume channel (initialResume → the client). `-p`, `--bg` and
  // `--detachable` all hand their work to a host that never sees this flag, so accepting it there would
  // start a FRESH session while reporting success — the silent-drop class this file refuses by name.
  if (inv.continue && !foregroundRun) return fail("--continue only applies to a foreground session (not -p, --bg or --detachable)", 2);
  // BOTH prompt refusals live up here, above the `run` arm's own side effects, for the reason :189-193
  // already gives about the consent gate: `ccx -c --worktree x "hi"` used to CUT the worktree and then
  // refuse, leaving a directory and a branch the operator had to unwind by hand. Refused before any of it.
  // The reason itself is the busy-guard: a launch resume together with a prompt sets BOTH initialResume and
  // initialPrompt on one ChatClientOpts, the submitted prompt starts a turn first, and resumeInto (Task 6)
  // then blocks the resume with "cannot resume mid-turn" — the resume never actually happens. Headless is
  // untouched: `-p --resume <id> "prompt"` and `--bg --resume <id> "task"` are the ordinary resume-fork.
  if (foregroundRun && inv.config.resume && inv.prompt) return fail("--resume with a prompt is not supported — resume, then type your prompt", 2);
  if (inv.continue && inv.prompt) return fail("--continue with a prompt is not supported — continue, then type your prompt", 2);

  switch (inv.command) {
    case "agents":
      // --all and --cwd travel UNCHANGED: doperpowers polls `agents --json --all` until a row reads a
      // terminal state, so a dropped --all hides the very answer it is waiting for.
      console.log(renderAgents(await deps.collectFleet(),
        { json: inv.json, all: inv.all, ...(inv.cwdFilter ? { cwdFilter: inv.cwdFilter } : {}) }));
      return 0;
    case "stop": case "rm": {
      // rm is deliberately silent on a session it cannot find, so a MISSING target would exit 0 having
      // removed nothing — success, over a session still on disk. Refuse before we get there.
      if (!inv.target) return fail(`${inv.command} requires a session: a short id, a session uuid or a name`, 2);
      try { await (inv.command === "stop" ? deps.stopSession : deps.rmSession)(inv.target); return 0; }
      catch (e) { return fail(msg(e), 1); }
    }
    case "gc":
      for (const p of await deps.fleetGc()) console.log(`removed ${p}`);
      return 0;
    // Pure reporting on the installation: it reads package manifests and this process, never the fleet,
    // and (like upstream, L411337) exits 0 whatever it finds — a doctor that failed would be one more
    // thing to diagnose.
    case "doctor":
      console.log(doctorReport());
      return 0;
    case "serve": {
      // Pure, checked before any listener binds (spec §11 last rule): a non-loopback --listen with no
      // --token-file would mean the only copy of the freshly-minted token lives in THIS process's memory,
      // reachable from anywhere on the network with nothing to authenticate against.
      if (nonLocalWithoutToken(inv)) return fail("--listen to a non-localhost host requires --token-file (spec §11)", 1);
      try { await deps.runServe(inv); return 0; } catch (e) { return fail(msg(e), 1); }
    }
    case "attach": {
      // A missing target would otherwise reach prepareAttach's resolveTarget with `undefined`, which
      // reads as "no session matches undefined" — a confusing error for what is really a missing argument.
      if (!inv.target) return fail("attach requires a session: a short id, a session uuid or a name", 2);
      try { return await attachToImpl(inv.target, {}, deps); } catch (e) { return fail(msg(e), 1); }
    }
    case "run": {
      if (inv.detachable && inv.bg) return fail("--detachable and --bg are mutually exclusive", 2);
      // T15-fix. `--bg` has no terminal to consent in, which is why the consent DIALOG skips it — but that
      // reasoning only justifies not ASKING, not entering bypass unasked: a detached, never-prompting agent
      // would have run in the one mode that stops checking, with no consent ever recorded, and every later
      // `ccx attach` onto it would inherit that. Upstream refuses the same combination in the same shape
      // (L451420-21, `z6H`'s --bg validator) and points the operator at the interactive run that records the
      // acceptance; ours says `ccx` where upstream says `claude`, so the instruction is followable here.
      // Placed with the other fatal argument errors — BEFORE --worktree prepares anything — so a refusal
      // costs nothing that has to be unwound.
      const unconsented = unconsentedBypassLaunch(inv, deps);
      if (unconsented) return fail(`${unconsented} with bypassPermissions requires accepting the disclaimer first. Run \`ccx --dangerously-skip-permissions\` once interactively.`, 2);
      // PRESENT and empty is not the same as absent: `--worktree "$WT"` with WT unset arrives here as "",
      // which the old truthiness guard read as "no worktree asked for" — the run landed in the shared
      // checkout and exited 0 with a banner, isolation requested and silently not delivered. The NAME check
      // is an argument error and stays with the others, above the consent gate; the worktree itself is
      // created below it (see there).
      if (inv.worktree !== undefined && !inv.worktree.trim()) return fail("--worktree requires a name", 2);
      // W-S6: resolve `--resume` for EVERY run path, not just the foreground one, and write the full id
      // back into the config the rest of the arm reads. spawn.ts's configFlags forwards `config.resume`
      // verbatim, and the -p path hands it to createHarness (runOnce) — so resolving here is what lets a
      // detached child and a headless run take the 8-char ids ccx prints, instead of only the REPL.
      // The child re-enters at `--__host` (line 101) long before this, so it never re-resolves.
      // ABOVE the consent dialog and the worktree cut, deliberately: an unresolvable id must not first ask
      // the operator to accept a disclaimer, nor leave a worktree behind for a run that never starts. The
      // cwd is the PRE-worktree one on purpose — it is the directory whose /status printed the id.
      if (inv.config.resume) {
        const arg = inv.config.resume;
        let r;
        try { r = await deps.resolveResume(arg, inv.config.cwd ?? process.cwd()); }
        catch (e) { return fail(msg(e), 1); }                  // an ambiguous prefix or roster target
        // `unknown`/`pending`/`live` all FAIL rather than dropping into a fresh session: silently opening
        // an empty one when the user asked for a specific conversation is the failure W-S6 exists to remove.
        if (r.kind === "unknown") return fail(`No conversation found with session ID: ${r.arg}`, 1);
        if (r.kind === "pending") return fail(`Session ${r.short} has not started a conversation yet — nothing to resume`, 1);
        if (r.kind === "live") return fail(`Session ${r.short} is still running — attach to it instead: ccx attach ${r.short}`, 1);
        // The fleet row exists — `ccx agents` lists it — but its transcript is under another project, and the
        // resumed REPL reads only this one. Naming the directory is the whole point of the outcome: it turns
        // "that id is wrong" into "run it over there" (external review, finding 3).
        if (r.kind === "foreign") return fail(`Session ${r.short} belongs to another project: ${r.path} — resume it from there`, 1);
        inv.config.resume = r.id;
      }
      // Wave-T T15 (qa3-14): bypass permissions is the one mode that stops asking before it acts, and until
      // now ccx entered it with no warning at all. Placed HERE — after the argument checks, before the spawn
      // and before any session exists — so a refusal costs nothing that has to be unwound. The gate keys on
      // the RESOLVED mode, so `--dangerously-skip-permissions` and `--permission-mode bypassPermissions` are
      // one condition and neither spelling can slip past it. It covers every launch that renders a REPL,
      // `--detachable` included; `-p` and `--bg` are deliberately outside it, matching upstream's own
      // placement (L554501-04 sits in the interactive startup) — a headless run has no terminal to consent in.
      // ABOVE the worktree creation, external review: `--worktree <new-name> --dangerously-skip-permissions`
      // used to cut the branch and the directory FIRST and ask second, so declining left a worktree on disk
      // that the operator had to unwind by hand — the exact cost this comment promises a refusal never has.
      // Nothing in the gate depends on the worktree: `resolvedPermissionMode` reads `config.permissionMode`
      // and nothing else (resolveOptions.ts), so moving it up changes what it decides not at all.
      if (needsBypassConsent(inv, deps)) await deps.showBypassConsent();
      if (inv.worktree !== undefined) {
        // Two consumers of the resolved path, both required: config.cwd is what the (bg-spawned or
        // in-process) session runs in, worktreePath is what the roster row records for `ccx rm`. Above
        // the fg/bg split (unlike A1) because a FOREGROUND run needs its own cwd exactly as much as a
        // detached one now that this task gives it a real code path.
        try { inv.worktreePath = await deps.ensureWorktree(inv.config.cwd ?? process.cwd(), inv.worktree); }
        catch (e) { return fail(`could not prepare worktree ${inv.worktree}: ${msg(e)}`, 1); }
        inv.config.cwd = inv.worktreePath;
      }
      if (inv.bg) { console.log(deps.spawnDetached(inv).banner); return 0; }
      // --detachable is an ATTACHED session that survives its terminal: spawn it exactly like --bg
      // (fully detached, kind:"interactive"), then attach to it ourselves — the prompt stays with US,
      // not the spawn line, because the client is the one that submits it (spec A2b §3).
      if (inv.detachable) {
        const { short, banner } = deps.spawnDetached({ ...inv, prompt: undefined });
        console.log(banner);
        return await attachToImpl(short, { ...(inv.prompt ? { initialPrompt: inv.prompt } : {}), fromSpawn: true }, deps);
      }
      if (inv.print) {
        // -p: one-shot headless print — the `cc-harness "<prompt>"` shape folded into ccx (contract table).
        if (!inv.prompt) return fail("-p requires a prompt", 2);
        console.log(await deps.runOnce(inv));
        return 0;
      }
      if (!deps.isTTY()) return fail("foreground ccx needs a terminal (use -p or --bg for scripts)", 2);
      return await runForegroundImpl(inv, deps);
    }
    default:
      // Exhaustive TODAY, and `inv.command` is `never` here to keep it that way. A member added to the
      // union without an arm used to fall out of the switch as `undefined`, which bin.ts hands to
      // exitAfterFlush as exit 0 — a command that did nothing, reported as success.
      return fail(`unhandled command ${String(inv.command)}`, 2);
  }
}

/** Wave-T T15's gate condition, kept out of the dispatch switch because it is three separate questions.
 *  `resolvedPermissionMode` is the same reader the banner and hookOpts use, given the same `?? "default"`
 *  foreground rule (EP-T1), so the mode this asks about is the mode the engine will actually run. */
function needsBypassConsent(inv: CcxInvocation, deps: MainDeps): boolean {
  if (inv.bg || inv.print || !deps.isTTY()) return false;
  if (resolvedPermissionMode({ ...inv.config, permissionMode: inv.config.permissionMode ?? "default" }) !== "bypassPermissions") return false;
  // `M8()` (bundle L43492): once accepted, never asked again. THE canon reader (bypassAccepted.ts), not a
  // second raw read of the same flag — this and the dialog's own gate must never disagree.
  return !hasAcceptedBypass(deps.loadPrefs());
}

/** T15-fix's `--bg` refusal (upstream L451420-21) and, from the external review, its `--detachable` twin.
 *  Returns the FLAG to name in the refusal, or null when the launch is fine. Reads the mode WITHOUT the
 *  foreground `?? "default"` rule above: a background run keeps the DEFAULTS mode deliberately (EP-T1), so
 *  the question here is only ever "did this invocation ask for bypass", which both spellings answer through
 *  `inv.config`.
 *
 *  Why `--detachable` joins `--bg` here, and only without a terminal: `needsBypassConsent`'s `!isTTY()`
 *  exemption is right for `-p` and `--bg` — a headless run has no terminal to consent in and leaves no
 *  interactive host behind — but `--detachable` is the one launch that has neither a terminal to ask at NOR
 *  a short life: it spawns a persistent, fully-autonomous bypass host that survives the terminal it came
 *  from, and every later `ccx attach` inherits that mode. Unconsented, it was skipping BOTH the gate and the
 *  ordinary non-TTY refusal below (which the `--detachable` arm returns before ever reaching). With a
 *  terminal nothing changes: the consent dialog runs exactly as it did. */
function unconsentedBypassLaunch(inv: CcxInvocation, deps: MainDeps): "--bg" | "--detachable" | null {
  if (resolvedPermissionMode(inv.config) !== "bypassPermissions" || hasAcceptedBypass(deps.loadPrefs())) return null;
  if (inv.bg) return "--bg";
  if (inv.detachable && !deps.isTTY()) return "--detachable";
  return null;
}

/** Retry classification: `fromSpawn` (the --detachable auto-attach) retries BOTH not-yet-resolvable (the
 *  child writes its roster row after fork) and not-yet-listening; a plain `ccx attach` retries NEITHER —
 *  a typo must fail fast, and a resolvable-but-silent socket is `agents`' unresponsive case, not a
 *  startup race. Bounded at 20×250ms ≈ 5s. Same wiring rule as Task 7: called directly with main's live
 *  `deps`, no self-referencing default. */
export async function attachToImpl(target: string, o: { initialPrompt?: string; fromSpawn?: boolean }, deps: MainDeps): Promise<number> {
  let prep;
  for (let i = 0; ; i++) {
    try { prep = await deps.prepareAttach(target); await deps.probeSocket(prep.socketPath); break; }
    catch (e) {
      const retryable = o.fromSpawn && i < 20;
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await deps.runChatClient({
    socketPath: prep.socketPath, client: { kind: "attached", short: prep.short }, cwd: prep.cwd,
    initialEntries: prep.initialEntries,
    ...(o.initialPrompt ? { initialPrompt: o.initialPrompt } : {}),
    onDetach: () => { console.error(`detached — session ${prep.short} keeps running · reattach: ccx attach ${prep.short}`); },
  });
  return 0;
}

/** Foreground ccx: an IN-PROCESS host + a loopback client over its own socket — exactly one ChatSession
 *  code path, so the daily REPL continuously exercises the attach protocol (spec A2b §3). */
export async function runForegroundImpl(inv: CcxInvocation, deps: MainDeps): Promise<number> {
  // The `--resume`/`--continue` + prompt refusals used to live here and now sit at main()'s :117-125,
  // above the worktree cut — a refusal must cost nothing that has to be unwound (review, t9). Nothing
  // reaches this function with that combination.
  const short = mintShortId(Math.random);
  const name = inv.name ?? short;
  const cwd = inv.config.cwd ?? process.cwd();
  process.env.CLAUDE_CODE_SESSION_NAME = name;       // engine self-registration, same as the fork path
  process.env.CLAUDE_CODE_SESSION_KIND = "interactive";
  // Launch-time thinking budget (the old cc-harness-chat behavior): --think off disables, a level sets
  // the budget, absent leaves the SDK default. thinkBudget/parseThinkArg from ../tui/thinkLevels.js (pure).
  const parsedThink = inv.think ? parseThinkArg(inv.think) : undefined;
  const thinking = thinkingConfigFrom(inv.think);
  // Launch resume goes to the CLIENT (initialResume → resumeInto → the adapter's resume op), NOT into
  // the host's config: one resume code path, and the incr-9 replay behavior survives the cutover.
  // Already the FULL id: main()'s run arm resolved it (and failed the launch outright if it named
  // nothing), for every path rather than this one, so what arrives here is a session that exists.
  const { resume, ...hostConfig } = inv.config;
  // F6 T11-fix — THE READER for the /model picker's "set as default" write. The picker persists
  // `prefs.model`; this is the one place a foreground launch decides what model the session starts on, so
  // this is where the default belongs. `--model` still wins: a flag the user typed for THIS run outranks a
  // preference they set once. From here it flows into `resolveOptions` exactly as `--model` does — no
  // engine round-trip, no new code path. `ccx attach` cannot honour it (the host it joins already owns its
  // model), and `-p`/`--bg` deliberately do not: a headless run takes its model from its invocation.
  const model = inv.config.model ?? deps.loadPrefs().model;
  // Wave T EP-T1: the REPL launches MANUAL like upstream (2.1.220 `gGl` L41536: `default` → "Manual").
  // QA sprint 1 found `rm` and `git init` running unconsulted because DEFAULTS.permissionMode is "auto"
  // (config/types.ts:161) and every surface resolves through it. Headless (-p/--bg) and the daemon KEEP
  // auto deliberately — a background run has nobody to ask.
  // ONE object, three readers: the host, the banner and hookOpts. Reading `inv.config` for the banner
  // instead would print "auto" (DEFAULTS) while the engine ran "default" — qa3-02 inverted.
  const foregroundConfig = { ...hostConfig, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}),
    permissionMode: inv.config.permissionMode ?? "default" };
  const host = deps.makeHost({
    short, name, cwd, kind: "interactive", detached: false,
    ...(inv.worktreePath ? { worktree: inv.worktreePath } : {}),
    config: foregroundConfig,
  });
  await host.start();
  // Terminal gone or OS says stop: finalize `done` — the deliberate asymmetry (acceptance 10): a default
  // session's life IS its terminal's. stop() is memoized+bounded, so double signals are safe.
  const onSignal = () => { void host.stop("done").finally(() => process.exit(0)); };
  process.on("SIGHUP", onSignal); process.on("SIGTERM", onSignal);
  // W-C T13 (EP-C8 §C8.3): the banner's billing label. Asked HERE because here is where the banner seeds —
  // the engine is open and the first turn has not run, which is exactly the window probe 101 proved
  // `accountInfo()` answers in. Skipped entirely on a resume/continue launch, which prints no banner at all.
  // A failure is SILENCE (`.catch`): the label is chrome, and a launch that stalls or shouts because a
  // credential probe went wrong is strictly worse than one that prints the model and says nothing about
  // billing. `?.` covers a host that does not implement it at all.
  const account = (resume || inv.continue ? undefined : await host.accountInfo?.().catch(() => undefined)) as AccountFacts | undefined;
  try {
    await deps.runChatClient({
      socketPath: hostSocketPath(process.pid), client: { kind: "loopback" }, cwd,
      ...(inv.prompt ? { initialPrompt: inv.prompt } : {}),
      // W-C T8 (EP-C4a): the terminal-title ladder's `--name` rung. `inv.name`, NOT the `name` local above —
      // that one falls back to the minted short id so the fleet roster always has a handle, and putting a
      // random `k3x9` in the tab would be worse than the literal `ccx` the writer falls through to.
      ...(inv.name ? { name: inv.name } : {}),
      // The welcome banner travels as the identified LOCAL entry it is — the same envelope every other
      // notice uses — so it can never masquerade as a persisted SDK row (F1 Task 4).
      // `{kind:"continue"}` is handed to the REPL as an INTENT, not an id: useChat's mount effect routes it
      // to doContinue(), which picks the most recent session for this directory itself. Its empty-list copy
      // ("No sessions to continue here") deliberately stays ours rather than upstream's "No conversation
      // found to continue" — the REPL's /continue already says it, and one surface must not say two things.
      ...(resume
        ? { initialResume: { kind: "id" as const, id: resume } }
        : inv.continue
        ? { initialResume: { kind: "continue" as const } }
        // W-C T13 (EP-C8, qa6-14): the banner is handed the SAME resolution `hookOpts.initialModel` gets
        // three lines below — `welcomeBanner` only ever renders what it is given, and what it was given was
        // the raw setting (an alias, or nothing at all → the literal `(default)`) while the status bar
        // showed the resolved id. §C8.7: one resolution, two surfaces, so they cannot disagree. Effort and
        // the account facts ride along for the same reason: everything on this line is the launch truth.
        : { initialEntries: [{ kind: "local" as const, identity: "welcome", event: { kind: "notice" as const, lines: welcomeBanner({ cwd, model: resolveModelAlias(model) ?? DEFAULTS.model, mode: resolvedPermissionMode(foregroundConfig), effort: foregroundConfig.effort ?? DEFAULTS.effort, ...(account ? { account } : {}) }) } }] }),
      // initialModel mirrors resolveOptions.ts's rule (alias first, then default) so the REPL knows what the
      // engine is actually running BEFORE the first turn ends. Without it the Tab ladder's `auto` rung reads
      // an undefined model and silently downgrades the session the user asked for. `ccx attach` (above) has
      // no launch config to pass, and useChat handles that unknown by declining to switch at all.
      // W-C T11 (EP-C6): `initialEffort` mirrors `resolveOptions.ts:52`'s own rule (the flag, else the
      // harness default) for the same reason `initialModel` mirrors its model rule — the §C6.2 hint has to
      // be able to name the level the engine is ACTUALLY running at mount, before any turn or catalog fetch.
      // `ccx attach` (the other foreground path) passes none, and undefined there means no hint, which is
      // the honest answer for a client that never saw a launch config.
      hookOpts: { initialMode: resolvedPermissionMode(foregroundConfig), initialModel: resolveModelAlias(model) ?? DEFAULTS.model, initialEffort: foregroundConfig.effort ?? DEFAULTS.effort, ...(parsedThink ? { initialThink: parsedThink.level } : {}) },
    });
  } finally {
    process.off("SIGHUP", onSignal); process.off("SIGTERM", onSignal);
    await host.stop("done");
  }
  return 0;
}
