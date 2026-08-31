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
import { screenReaderEnabled } from "../tui/renderer.js";
import { resolveModelAlias } from "../config/models.js";
import { DEFAULTS } from "../config/types.js";
import { resolvedPermissionMode } from "../config/resolveOptions.js";
import { resolveLaunchPermissionMode } from "./launchMode.js";
import { parseThinkArg, thinkingConfigFrom } from "../tui/thinkLevels.js";
import { isPersistableEffortLevel } from "../tui/modelPickerModel.js";
import { createPromptLatch } from "../hooks/promptLatch.js";
import { mergeHooks } from "../hooks/merge.js";
// Value import, and safe: prefs.ts is plain fs + the theme table, no React (main.ts stays React-free).
import { loadPrefs as realLoadPrefs } from "../tui/prefs.js";
import type { CcxPrefs } from "../tui/prefs.js";
// Value import, and safe for the same reason: accountBridge.ts is React-free (a closure over a promise).
import { createAccountBridge } from "../tui/accountBridge.js";
// Value import, and safe for the same reason, deliberately: bypassAccepted.ts holds ONLY the acceptance
// predicate and has no runtime imports at all, which is why the canon reader could be split out of the
// `.tsx` dialog and shared with this file instead of re-implemented here as a raw prefs read.
import { hasAcceptedBypass } from "../tui/bypassAccepted.js";
import { prepareAttach as realPrepareAttach } from "./attach.js";
import { resolveResumeArg as realResolveResume } from "./resolveResume.js";
import { socketAnswers as realSocketAnswers } from "../fleet/liveness.js";
// F8 T8: the three facts startupTips branches on — same plain-fs/no-React safety as prefs.ts above.
import { opendirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
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
  /** W-C T13 (review finding 1) — the launch clock, injected for the same reason every reader here is: the
   *  banner's account race has a DEADLINE, and a test that could not drive it would either sleep for real or
   *  pin nothing. One caller today (`ACCOUNT_LABEL_BUDGET_MS`). */
  delay: (ms: number) => Promise<void>;
  /** F8 T7 review finding — the banner's row-count reader. `process.stdout.rows` is `undefined` in every
   *  vitest worker (the default forks pool gives stdout a pipe, not a pty), so a bare global read here is
   *  invisible to any test this suite can contain: deleting the wire at the call site left 118/118 green.
   *  Same idiom as `useChat.ts`'s `rowsFn`, one directory over. */
  rows: () => number | undefined;
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
  // `unref` so a race the OTHER arm already won cannot keep the event loop alive for the rest of the budget:
  // this timer exists to bound a wedge, never to delay an exit.
  delay: (ms) => new Promise<void>((r) => { setTimeout(r, ms).unref?.(); }),
  rows: () => process.stdout.rows,
};

/** Review finding E: canon's `jCu` (L40335) probes emptiness with `opendir` + exactly ONE `read()`,
 *  deliberately avoiding enumeration on the launch path, and — because `opendir` sees dotfiles — a
 *  directory holding only `.git` is NOT empty to canon (a git repository is not an empty workspace, and
 *  that reading is the better one, not just the faithful one). `readdirSync().filter(dotfile)` disagreed on
 *  both counts. The handle is always closed, sync mirror of canon's `finally { await t.close() }`. */
function isEmptyWorkspace(cwd: string): boolean {
  const dir = opendirSync(cwd);
  try { return dir.readSync() === null; }
  finally { dir.closeSync(); }
}

/** F8 T8's two fs-derived checklist facts. Guarded, deliberately deviating from the plan's literal bare
 *  reads (found live: `args-bypass.test.ts`'s "consent gate runs BEFORE --worktree touches the disk" test
 *  fakes `ensureWorktree`/`makeHost` without ever creating the directory on disk, and a bare `readdirSync`
 *  threw ENOENT there, killing the whole launch over a checklist tip). Same rule the account race a few
 *  lines below already lives by: this is chrome, and chrome must never cost the user their launch. */
function checklistFsFacts(cwd: string): { emptyWorkspace: boolean; hasClaudeMd: boolean } {
  try { return { emptyWorkspace: isEmptyWorkspace(cwd), hasClaudeMd: existsSync(join(cwd, "CLAUDE.md")) }; }
  catch { return { emptyWorkspace: false, hasClaudeMd: false }; }
}

const msg = (e: unknown): string => (e as Error)?.message ?? String(e);
/** ONE stderr shape for the whole program — `ccx: <what went wrong>` — so a parse error, a refusal and a
 *  throw caught at the top level in bin.ts all read the same way to an operator tailing a daemon's log. */
const fail = (text: string, code: number): number => { console.error(`ccx: ${text}`); return code; };

/** Returns the exit code; never throws for an operator error. Everything a consumer script reads —
 *  the banner on stdout, the refusal on stderr, the code — is decided here. */
export async function main(argv: string[], rawDeps: MainDeps = defaults): Promise<number> {
  // F10 T-MAINT item 2 (F9 ledger Minor): ONE prefs read per launch. Four consumers ask for the same
  // file on the run arm — `unconsentedBypassLaunch`, `needsBypassConsent`, the `--detachable` model
  // materialization and `runForegroundImpl`'s model/effort resolution — and an ordinary interactive
  // launch used to hit `readFileSync` twice for it. MEMOISED RATHER THAN HOISTED, deliberately: every
  // one of those consumers has its own short-circuit, and an eager read at the top of the arm would put
  // a disk read on `-p`/`--bg` launches that ask nothing of prefs at all. `main` runs once per process,
  // so the memo's lifetime IS the launch's; nothing in this function re-reads prefs expecting to see a
  // write the REPL made mid-session (the REPL's own writers go through `tui/prefs.js` directly).
  let prefsOnce: CcxPrefs | undefined;
  const deps: MainDeps = { ...rawDeps, loadPrefs: () => (prefsOnce ??= rawDeps.loadPrefs()) };
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
        // An absent roster `sessionId` no longer means only "not minted yet". A1 made the field a LIVENESS
        // claim — a host that `/clear`s discards its conversation and the row is re-stamped empty — so a
        // cleared session reached this line and was told it had never started, which is not true of it.
        // The refusal is right either way (before A1 this resumed the DISCARDED conversation); the sentence
        // names both states rather than guessing between two the roster cannot tell apart.
        if (r.kind === "pending") return fail(`Session ${r.short} holds no conversation to resume — it has not started one, or /clear discarded the one it had`, 1);
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
        // F9 T-AUTO A1 (plan-review catch): hostMain.ts loads no prefs of its own, so the SAME effective
        // model runForegroundImpl resolves (flag, else saved pref) is materialized into inv.config HERE,
        // before the spawn — without it, a saved model would arrive at the child as undefined, fall back
        // to DEFAULTS.model (auto-capable) and launch `auto` while a foreground run on the same saved
        // model launched `default`: the split-brain EP-T1 was written to prevent, on the model axis.
        // bl7 T-ADVISOR task 1: advisorModel rides the SAME materialize-before-spawn rule as model, off
        // ONE loadPrefs() call (F10 T-MAINT item 2's read-count discipline) — hostMain.ts loads no prefs
        // of its own, so a saved advisorModel must be merged in here too, or a --detachable child would
        // silently launch with no advisor consult at all (default OFF means "no consult", so a silent
        // drop here is invisible rather than a loud misconfiguration).
        const detachedPrefs = deps.loadPrefs();
        const model = inv.config.model ?? detachedPrefs.model;
        const advisorModel = inv.config.advisorModel ?? detachedPrefs.advisorModel;
        const { short, banner } = deps.spawnDetached({ ...inv, prompt: undefined, config: { ...inv.config, ...(model ? { model } : {}), ...(advisorModel ? { advisorModel } : {}) } });
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
 *  Runs the SAME launch-mode resolver runForegroundImpl uses (F9 T-AUTO A1), so the mode this asks about
 *  is the mode the engine will actually run — bypassPermissions is only ever reached explicitly (neither
 *  resolver arm produces it on its own), so this is unaffected by the auto/default default. */
function needsBypassConsent(inv: CcxInvocation, deps: MainDeps): boolean {
  if (inv.bg || inv.print || !deps.isTTY()) return false;
  const prefs = deps.loadPrefs();
  const model = inv.config.model ?? prefs.model;
  if (resolveLaunchPermissionMode({ explicitMode: inv.config.permissionMode, effectiveModel: model }).mode !== "bypassPermissions") return false;
  // `M8()` (bundle L43492): once accepted, never asked again. THE canon reader (bypassAccepted.ts), not a
  // second raw read of the same flag — this and the dialog's own gate must never disagree.
  return !hasAcceptedBypass(prefs);
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
    ...(prep.diskStamp ? { initialDiskStamp: prep.diskStamp } : {}),
    ...(o.initialPrompt ? { initialPrompt: o.initialPrompt } : {}),
    onDetach: () => { console.error(`detached — session ${prep.short} keeps running · reattach: ccx attach ${prep.short}`); },
  });
  return 0;
}

/** How long the launch will wait for the banner's billing label before printing without it (t13 review
 *  finding 1; RESIZED by the t15 acceptance run). Sized to be WON, not lost: A12 pins a truthful billing
 *  label and the banner is Static-seeded (D-C8) — there is no late fill, so a label that misses first paint
 *  is gone for the session. The measured handshake this races is ~450 ms warm / ~1152 ms cold, so 1500 ms
 *  clears both while still capping an engine that is alive but never completes it (the wedge the t13 review
 *  actually cared about was the UNBOUNDED await; its 300 ms suggestion lost to its own measurements, and
 *  three keyed pty runs printed no billing segment at all). The typical real cost is the handshake itself
 *  (~0.5–1.2 s) — which upstream's banner also pays in substance: its account segments come from the same
 *  init payload. Exported so the test pins the number the code actually uses rather than a copy of it. */
export const ACCOUNT_LABEL_BUDGET_MS = 1500;

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
  // F6 T11-fix — THE READER for the /model picker's "set as default" write, and (T-EFFORT) for `/effort`'s
  // own. ONE read: both `model` and `effort` persist to the same ccx-prefs file, so this is the one place a
  // foreground launch decides what a session starts on for either axis, matching the model precedent this
  // comment already describes. `--model` still wins: a flag the user typed for THIS run outranks a
  // preference they set once. From here it flows into `resolveOptions` exactly as `--model` does — no
  // engine round-trip, no new code path. `ccx attach` cannot honour it (the host it joins already owns its
  // model), and `-p`/`--bg` deliberately do not: a headless run takes its model from its invocation.
  const prefs = deps.loadPrefs();
  const model = inv.config.model ?? prefs.model;
  // bl7 T-ADVISOR task 1 — advisorModel rides the SAME flag-or-saved-pref rule, off the SAME `prefs` read
  // (no second loadPrefs() call). Default OFF: absent config.advisorModel and no saved pref means the
  // field stays out of foregroundConfig entirely, not a phantom `advisorModel: undefined`.
  const advisorModel = inv.config.advisorModel ?? prefs.advisorModel;
  // T-EFFORT — the model precedent's exact twin, one line down: `--effort` still wins over a saved default,
  // and the saved default is re-filtered through the SAME persistable-level gate the write side uses
  // (`isPersistableEffortLevel`, canon's `Qdt` on read, R2 §2.5) — a hand-edited `"max"` in prefs.json is
  // exactly as inert here as an attempted write of it would have been. `DEFAULTS.effort` stays the final
  // rung when neither the flag nor a persisted default names a level.
  const persistedEffort = isPersistableEffortLevel(prefs.effort) ? prefs.effort : undefined;
  // F9 T-AUTO A1 (spec 2026-08-22-f9-wave-design.md "Track T-AUTO"; supersedes Wave T EP-T1): the REPL now
  // launches AUTO by default, not MANUAL. EP-T1's Manual call was benchmarked against a `claude` that
  // launched Manual; that benchmark has since moved — canon 2.1.236 is mid-rollout of auto-as-default
  // (cli.pretty.js:106133-106139) and the owner's own ~/.claude/settings.json already sets
  // permissions.defaultMode: "auto" — so this flip is TOWARD canon, not a regression of the qa3-03 finding
  // it was written to fix. The reversal is recorded as a decision in docs/parity/qa-sprint-1-triage.md.
  // The launch mode is GATED, not hardcoded: `resolveLaunchPermissionMode` (launchMode.ts) tests the
  // EFFECTIVE model (`model`, above — flag or saved pref, alias-resolved) against the live-verified
  // isAutoSupportedModel set. An unsupported model launches `default` with the model left untouched —
  // never silently swapped, unlike resolveOptions.ts's explicit-auto gate would do if fed an unconditional
  // "auto". Headless (-p/--bg) and the daemon KEEP auto unconditionally, as always — a background run has
  // nobody to ask.
  // ONE object, three readers: the host, the banner and hookOpts. Reading `inv.config` for the banner
  // instead would print a mode the engine isn't actually running — qa3-02 inverted.
  const launch = resolveLaunchPermissionMode({ explicitMode: inv.config.permissionMode, effectiveModel: model });
  // WAVE 2 TASK 6 (EP-D4): the statusLine payload's `transcript_path` / `prompt_id`. Both live only on hook
  // inputs, so the REPL can only learn them from an engine it is in-process with — which is exactly this
  // launch and not `ccx attach`. Registered on the host's config (it reaches the SDK through
  // `resolveOptions`' `options.hooks`) and handed to the client as a plain shared object, the same bridge
  // shape `chatMain`'s clear/notice bridges use. Merged rather than assigned so a caller-supplied
  // `config.hooks` keeps its own `UserPromptSubmit` entries.
  const promptLatch = createPromptLatch();
  const foregroundConfig = { ...hostConfig, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}),
    ...(advisorModel ? { advisorModel } : {}),
    permissionMode: launch.mode,
    hooks: mergeHooks(hostConfig.hooks ?? {}, promptLatch.hooks()) };
  const host = deps.makeHost({
    short, name, cwd, kind: "interactive", detached: false,
    ...(inv.worktreePath ? { worktree: inv.worktreePath } : {}),
    config: foregroundConfig,
  });
  await host.start();
  // Terminal gone or OS says stop: finalize `done` — the deliberate asymmetry (acceptance 10): a default
  // session's life IS its terminal's. stop() is memoized+bounded, so double signals are safe.
  //
  // FSW T6 (spec §A3) — THE SIGNAL INTERLOCK. `process.exit` below never runs `runChatClient`'s `finally`,
  // so anything the REPL must do before the process dies has to happen HERE, synchronously, ahead of the
  // asynchronous `host.stop`. Under the fullscreen renderer that "anything" is the alt screen: a SIGTERM
  // that skipped it would hand the shell back a terminal with no scrollback, no cursor and mouse reporting
  // still armed. The array is the transport (plan review I8) — main owns it, `chatMain` registers the
  // alt-screen guard's cleanup into it — so SIGTERM/SIGHUP keep ONE handler each and the REPL does not
  // double-register the signals this launch already owns. `splice` because a second signal must not re-run
  // cleanups that already ran, and a cleanup that throws must not cost the process its exit.
  //   SIGINT IS ONE OF THE THREE (T6 review F4). The REPL's ctrl+c is raw-mode bytes, not a signal
  // (`tui/keys/bindings.ts:42`), so the only thing that delivers one to a foreground launch is an external
  // `kill -INT` — and that is a request to end this session exactly as a TERM is. Handled in the guard
  // instead, it tore the screen down correctly and left the session unfinalized with a stale roster row,
  // because the guard is the one module here that cannot see the host. Owning all three in one place is
  // also what lets `chatMain` declare `signalsOwned` and stop sniffing listener counts.
  const beforeExit: Array<() => void> = [];
  const onSignal = () => {
    for (const cleanup of beforeExit.splice(0)) { try { cleanup(); } catch { /* dying anyway */ } }
    void host.stop("done").finally(() => process.exit(0));
  };
  process.on("SIGHUP", onSignal); process.on("SIGTERM", onSignal); process.on("SIGINT", onSignal);
  // W-C T13 (EP-C8 §C8.3): the banner's billing label. Asked HERE because here is where the banner seeds.
  //
  // What it actually costs (t13 review finding 1, correcting this block's first draft): `accountInfo()` is
  // NOT a pre-turn control round-trip. The SDK answers it out of the memoized init payload —
  // `(await this.initialization).account` — so awaiting it bare means awaiting the `claude` CLI's boot and
  // handshake before first paint (measured 1152 ms cold, ~450 ms warm), and an engine that is alive but
  // never completes that handshake never settles it at all, which `.catch` cannot rescue. The SDK bounds
  // this same promise in its own warm-pool path; so do we.
  //
  // Hence the race: whichever of the answer and the deadline lands first. BOTH arms yield `undefined` on
  // anything but a real answer, and `undefined` simply OMITS the segment — the label is chrome, and chrome
  // never gets to cost the user their first paint. Skipped entirely on a resume/continue launch, which
  // prints no banner at all. `?.` covers a host that does not implement it (a non-promise loses the race
  // instantly, which is the right answer: there is nothing to wait for).
  //
  // F10 T-MAINT item 1: ONE `accountInfo()` call, TWO consumers with different deadlines. The banner keeps
  // the race exactly as tuned above — chrome never costs first paint, and `undefined` simply omits the
  // segment. The SAME promise, unraced, also goes to the REPL through the bridge, so the auto-mode notice
  // can still learn the truth after the banner has already given up on it (before this, the raced value
  // WAS the only channel and a slow cold boot destroyed the fact outright). The bridge swallows rejection
  // at `offer`, so a credential-less host produces no unhandled rejection on the path nobody awaits.
  // Skipped on resume/continue exactly as before: no banner is printed there, no handshake is started,
  // and the notice keeps its documented unknown arm — the same answer `ccx attach` gets.
  const accountBridge = createAccountBridge();
  const liveAccount = resume || inv.continue ? undefined : (host.accountInfo?.() as Promise<AccountFacts | undefined> | undefined);
  if (liveAccount) accountBridge.offer(liveAccount);
  const account = (liveAccount
    ? await Promise.race([
        liveAccount.catch(() => undefined),
        deps.delay(ACCOUNT_LABEL_BUDGET_MS).then(() => undefined),
      ])
    : undefined) as AccountFacts | undefined;
  try {
    await deps.runChatClient({
      socketPath: hostSocketPath(process.pid), client: { kind: "loopback" }, cwd,
      // FSW T6: the drain array above. Handed down rather than re-derived, because the whole point is that
      // the handler that calls `process.exit` and the code that must run first are in different modules.
      beforeExit,
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
        //
        // EFFORT IS THE FLAG ALONE, not `?? DEFAULTS.effort` (t13 review finding 4). This task is named
        // banner truth, and ` with xHigh effort` on a bare `ccx --model haiku` is not true: haiku's catalog
        // row has no effort axis at all. The banner cannot know that at seed time — the catalog is a
        // `capabilities()` round-trip nobody has made yet — but it can know whether the USER named a level,
        // and a level they named is a fact about the launch either way. `hookOpts.initialEffort` below keeps
        // the default: naming what the ENGINE runs is a different claim from asserting the model has the axis.
        // F8 T7: rows/screenReader ride along too — the same launch-truth rule as everything else on this
        // line. `process.stdout.rows` is undefined off a TTY, which welcomeBanner treats as "unknown" (the
        // FULL box), not "degrade" — the same honesty the account race above already has to observe.
        // F8 T8: the checklist's three facts ride along the same way — emptyWorkspace/hasClaudeMd read the
        // launch cwd (not process.cwd(): a --cwd launch or a worktree run must see ITS OWN directory, the
        // same rule `cwd` above already exists to enforce), inHomeDir compares it against the real home.
        : { initialEntries: [{ kind: "local" as const, identity: "welcome", event: { kind: "notice" as const, lines: welcomeBanner({ cwd, model: resolveModelAlias(model) ?? DEFAULTS.model, mode: resolvedPermissionMode(foregroundConfig), ...(foregroundConfig.effort ? { effort: foregroundConfig.effort } : {}), ...(account ? { account } : {}), rows: deps.rows(), screenReader: screenReaderEnabled(process.env),
          ...checklistFsFacts(cwd),
          // Review finding D: RESOLVED, not the raw --cwd value — canon compares its resolved cwd, and a
          // trailing slash (what shell tab-completion produces, e.g. `--cwd ~/`) survived string equality
          // as a mismatch, silently suppressing the note.
          inHomeDir: resolve(cwd) === homedir() }) } }] }),
      // initialModel mirrors resolveOptions.ts's rule (alias first, then default) so the REPL knows what the
      // engine is actually running BEFORE the first turn ends. Without it the Tab ladder's `auto` rung reads
      // an undefined model and silently downgrades the session the user asked for. `ccx attach` (above) has
      // no launch config to pass, and useChat handles that unknown by declining to switch at all.
      // W-C T11 (EP-C6): `initialEffort` mirrors `resolveOptions.ts:52`'s own rule for the same reason
      // `initialModel` mirrors its model rule — the §C6.2 hint has to be able to name the level the engine
      // is ACTUALLY running at mount, before any turn or catalog fetch. T-EFFORT adds the middle rung: the
      // flag still wins, but a persisted default now outranks the harness default, the model precedent's
      // exact shape (`model` above). `ccx attach` (the other foreground path) passes none, and undefined
      // there means no hint, which is the honest answer for a client that never saw a launch config.
      // T2 (F9 T-AUTO §A2): the SAME `account` the banner's billing label reads two blocks up, handed down a
      // second path so the auto-mode notice's variant selector sees it too. `account` is already undefined
      // on a resume/continue launch (the banner race is skipped there), which lands the notice on its
      // documented unknown arm exactly like `ccx attach` does below.
      // bl7 T-ADVISOR Task 3 (spec D15): `initialAdvisorModel` rides `advisorModel` (declared above, the same
      // flag-or-saved-pref local `foregroundConfig` already folded in) straight through — no re-resolution,
      // exactly as `initialModel` rides the already-resolved `model` local two lines up.
      hookOpts: { initialMode: resolvedPermissionMode(foregroundConfig), initialModel: resolveModelAlias(model) ?? DEFAULTS.model, initialAdvisorModel: advisorModel, initialEffort: foregroundConfig.effort ?? persistedEffort ?? DEFAULTS.effort, ...(parsedThink ? { initialThink: parsedThink.level } : {}), initialTokenSource: account?.tokenSource, promptLatch, accountBridge },
    });
  } finally {
    process.off("SIGHUP", onSignal); process.off("SIGTERM", onSignal); process.off("SIGINT", onSignal);
    await host.stop("done");
  }
  return 0;
}
