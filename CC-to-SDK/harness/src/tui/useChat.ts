// tui/src/useChat.ts — owns the session (event-driven, Goal B task 7): the host event stream is the
// SINGLE rendering source (turn/message/decision/tasks_changed/task/state events all arrive via
// ChatSession & SessionEvents & DecisionFeed & BgTasks), `submit`/`resolveDecision` are command channels
// only. Owns the transcript, the streaming turn, the decision queue, mode switching (Tab ladder + host
// truth via state events), the bg-task panel, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import { mkdirSync, writeFileSync as realWriteFileSync, readFileSync as realReadFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve as resolvePath } from "node:path";
import type { ChatSession } from "../session/chatSession.js";
import { hasDecisionFeed, hasBgTasks, hasSessionEvents, hasRewind, hasSettingsOps } from "../session/chatSession.js";
import type { RewindAnchor, RewindScope, RewindDryRun } from "../session/chatSession.js";
import { validateAddDir, formatAddDirVerdict, formatAddDirResult, type AddDirVerdict } from "./addDir.js";
import { mergeSettingsFile, appendToArray, type SettingsFileDeps, type SettingsTarget } from "./settingsFile.js";
import { appendDenial, removeFromArray, type DenialEntry } from "./permissionsModel.js";
import type { CcxPrefs } from "./prefs.js";
import { savePrefs as realSavePrefs } from "./prefs.js";
import { currentTheme, resolveThemeColor, setTheme, themeTokens, type ThemeId } from "./theme.js";
import { buildRows, summarizeChanges, PERMISSION_MODE_OPTIONS, type SettingsRowCtx } from "./settingsRows.js";
import { OUTPUT_STYLE_REDIRECT } from "./OutputStylePicker.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import { userEchoLines, type RenderLine } from "./render.js";
import { compactSummaryLines, systemNoticeLines, isTranscriptOnlyNotice, COMPACT_SUMMARY_SPECIES, SYSTEM_INFO_SPECIES } from "./species.js";
import { TranscriptDocument, type LocalTranscriptEvent, type TranscriptBootstrapEntry } from "./transcriptModel.js";
import { projectCompact, projectDetail, projectPending, type ProjectionContext, type RenderItem } from "./toolRenderer.js";
import { LiveTurn } from "./liveTurn.js";
import { FoldPendingState } from "./foldPendingState.js";
import { ingestTaskFrame, stampAgentCalls, type AgentMeta } from "./agentProgress.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { BgMetaHarvest, type BgTaskRow } from "./bgTaskMeta.js";
import { parseCommand, canonicalCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, CLIENT_SIDE_NOTES, formatClientSide, parseConfigArg, type ParsedCommand, type InitialResume, type SessionUsage } from "./commands.js";
import { rewindFailureHeading } from "./rewindModel.js";
import { formatUsage, usageWarning, usageSummaryLine } from "./usageFormat.js";
import { mergeCommands, toCatalogEntry, type CommandEntry } from "./commandComplete.js";
import { parseThinkArg } from "./thinkLevels.js";
import { exportMarkdown, defaultExportName, filesInContext, formatFiles, formatStats, formatSessionInfo, EXPORT_HEADER } from "./sessionTools.js";
import { lastAssistantText } from "../sessions/rows.js";
import type { ModelInfo } from "./ModelPicker.js";
import { replayDocument } from "./replay.js";
import { runBash as realRunBash, formatBashOutput, type BashResult } from "./bash.js";
import { copyToClipboard as realCopyToClipboard } from "./copy.js";
import { appendMemory as realAppendMemory } from "./memory.js";
import { openInEditor } from "./externalEditor.js";
import { STARTER_KEYBINDINGS, userBindingsPath } from "./keys/userBindings.js";
import { useBindingLookup } from "./keys/KeymapProvider.js";
import { backgroundHintText, expandHintText } from "./keys/hints.js";
import { shortCwd } from "./banner.js";
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel, resolveModelAlias, renameSession as realRenameSession, tagSession as realTagSession, getSessionInfo as realGetSessionInfo } from "../index.js";
import type { RawContextUsage } from "../index.js";
import { type HistEntry, type HistoryScope } from "./historySearch.js";
import { appendHistory, hydrateEntry, readHistory } from "./promptHistory.js";
import { substituteChips } from "./pasteChips.js";
import { isEditableQueueEntry, joinQueuedForComposer, type QueueEntry } from "./queue.js";
import { composerMode } from "./promptMode.js";
import type { PastedMap } from "./editor.js";

// F1 Task 2 role map: every line useChat itself emits is themed — failures `error`, the `! command`
// echo `bashBorder`. Read per emission so a mid-session /theme change colors the next line correctly.
const role = (name: "error" | "bashBorder") => resolveThemeColor(themeTokens()[name]);
const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

// ChatSession is promoted to ../session/chatSession.ts (spec A2b §2) so the lib Session and the remote
// adapter satisfy ONE interface; re-exported here so this package's other modules' imports keep working.
export type { ChatSession };
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
/** The Ctrl-O detail route (Task 5 wires the pager onto it): `useChat` owns `documentRef`, ChatApp sees only
 *  the returned state, so this closure is how a source-backed detail projection reaches the pager without
 *  anyone reaching into the document itself. */
export type DetailItems = (projection: "detail-all" | "detail-collapsed") => readonly RenderItem[];
export interface ChatState { sessionId?: string; staticItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: RenderLine[]; pending: PendingDecision | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; bgTasks: BackgroundTaskInfo[]; bgRows: BgTaskRow[]; bgPanelOpen: boolean; thinkLevel: string; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[] }; commandCatalog: CommandEntry[]; queue: QueueEntry[];
  /** The composer's placeholder ladder reads both (`placeholder.ts` rule 4 — upstream's `submitCount` /
   *  `hasMessages`): how many prompts THIS client has sent, and whether the transcript holds any
   *  conversation message at all (a resumed or attached session does before the user types anything). */
  submitCount: number; hasMessages: boolean;
  staticEpoch: number; turnTokens: number; rewindPicker: { open: boolean; anchors: RewindAnchor[] }; composerPrefill: { text: string; token: number; mode?: "replace" | "prepend"; pastedContents?: PastedMap } | null; rewinding: boolean; usageWarn?: string; shortcutsOpen: boolean; historyOpen: boolean; addDir: { open: boolean; prefill?: string }; themeDialog: { open: boolean }; settings: { open: boolean; tab?: string }; outputStyle: string; permissions: { open: boolean; tab?: string }; denials: DenialEntry[];
  /** The session's working directories — the cwd plus every `/add-dir` grant (`listDirs()`). The FILE
   *  permission dialog's in-directory test runs over this set; nothing else reads it. */
  workDirs: readonly string[]; }

// Tab cycles these; bypassPermissions stays off-cycle (/yolo). Single source with settingsRows.ts's own
// permissionMode row (review finding 3) — importing it here instead of a second literal array means the
// Tab ladder and the /config cycle order can never independently drift.
const LADDER = PERMISSION_MODE_OPTIONS;
/** Next mode on the Tab ladder; any off-ladder mode (e.g. bypassPermissions/dontAsk) re-enters at "default". */
function ladderNext(mode: string): string { const i = LADDER.indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  opts: { initialMode?: string; initialModel?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string; initialOutputStyle?: string; initialEntries?: readonly TranscriptBootstrapEntry[]; initialPrompt?: string; onExit?: () => void; detach?: () => void; clearStaticTranscript?: () => void; noticeBridge?: { bind(push: (text: string) => void): void } } = {},
  // `home`/`platform` are injectable for the same reason `now`/`columns` are: the frame-capture fixture has
  // to pin the whole ProjectionContext, and `homedir()`/`process.platform` read live from the host — which
  // made a golden comparison depend on who ran it (a `/Users/…` home leaking into a `~`-shortened path) and
  // on the runner's OS (the active leader glyph is `⏺` on darwin and `●` everywhere else).
  deps: { now?: () => number; columns?: () => number; home?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; scheduleRepaint?: (cb: () => void, ms: number) => () => void; listSessions?: () => Promise<SessionInfo[]>; getSessionMessages?: (id: string) => Promise<any[]>; runBash?: (cmd: string, cwd: string) => Promise<BashResult>; appendMemory?: (note: string, cwd: string) => string; clearScreen?: () => void; copyText?: (t: string) => Promise<void>; writeFile?: (path: string, text: string) => void; readFile?: (path: string) => string | null; renameSession?: (id: string, title: string) => Promise<void>; tagSession?: (id: string, tag: string | null) => Promise<void>; getSessionInfo?: (id: string) => Promise<any>; settingsFileDeps?: SettingsFileDeps; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; openEditor?: (file: string, prepare: () => void) => "no-editor" | "opened" | "failed" } = {},
) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  const cwd = opts.cwd ?? process.cwd();
  const nowFn = deps.now ?? (() => Date.now());
  const columnsFn = deps.columns ?? (() => process.stdout.columns ?? 80);
  const scheduleRepaint = deps.scheduleRepaint ?? ((cb: () => void, ms: number) => { const id = setInterval(cb, ms); return () => clearInterval(id); });
  const home = deps.home ?? homedir(), platform = deps.platform ?? process.platform;
  // F3 Task 9 (LT20): the background hint is DERIVED from the live binding table on every render — a rebind of
  // `task:background` moves the sentence, an unbind removes the row (`backgroundHintText` returns undefined)
  // — and the tmux variant reads an INJECTED env, so a frame-pinning test is not at the mercy of the terminal
  // the suite runs under. Resolved here rather than inside the projection, which stays pure.
  const lookup = useBindingLookup();
  const bashHint = backgroundHintText(lookup("task:background"), (deps.env ?? process.env).TMUX !== undefined, platform);
  // F4 Task 10b, the SAME derivation for the other advertised chord. Before this, `(ctrl+o to expand)` was a
  // literal typed at four separate sites, so a `keybindings.json` that moved `app:toggleTranscript` left every
  // fold marker, group row and search sentence in the transcript naming a key that no longer did anything —
  // the exact dishonesty F2 shipped to end, still standing in the busiest surface of the app. It is read from
  // the LIVE lookup (user layers included), never from `defaultLookup`, which cannot see an override.
  const expandHint = expandHintText(lookup("app:toggleTranscript"), platform);
  // Read through a REF, not off the render closure (F3 final review). The projection is driven by callbacks
  // that outlive the render that created them — the 600 ms repaint interval is captured by an effect keyed
  // `[liveOpen, session]`, and the event subscription by one keyed `[session]` — so a keybindings.json
  // rebind landing while a Bash is running left every later frame advertising the DEAD chord while the key
  // itself had already moved. That is precisely the hint-honesty rule F2 shipped, so the hint has to reach
  // the projection at projection time, not at the time some effect was last re-subscribed.
  const bashHintRef = useRef(bashHint); bashHintRef.current = bashHint;
  const expandHintRef = useRef(expandHint); expandHintRef.current = expandHint;
  const projectionContext = (): ProjectionContext => ({ cwd, home, platform, columns: columnsFn(), now: nowFn(), thoughtMs: thoughtMsRef.current, pending: pendingStateRef.current!, agentMeta: agentMetaRef.current, bashHint: bashHintRef.current, expandHint: expandHintRef.current });
  // ── The ONE retained transcript document (F1 Task 4). Every visible row — live, replay, attach, resume,
  // rewind, Ctrl-O — is projected from it; `publishedIds` is what makes reconciliation append-only, so a
  // duplicate follow record, a rehydration or a redelivered bootstrap entry can never publish a row twice.
  const publishedIds = useRef<Set<string>>(new Set());
  const documentRef = useRef<TranscriptDocument | null>(null);
  if (documentRef.current === null) {
    const doc = new TranscriptDocument();
    // Seeded with the bootstrap stream — unless we're launching straight into a resume (the replay builds
    // the document itself and a banner would be misleading above a rejoined transcript).
    if (!opts.initialResume) for (const entry of opts.initialEntries ?? []) {
      if (entry.kind === "sdk") doc.appendSdk("disk", entry.message); else doc.appendLocal(entry.event, entry.identity);
    }
    documentRef.current = doc;
  }
  // The LIVE-open top-level calls — display state only, never written back into the source document. A call
  // id enters when a LIVE host event delivers its `tool_use` with no result yet, leaves when its result
  // attaches, and the whole set clears at every boundary (turn:end, an idle `state` frame, a session swap,
  // replaceDocument). The document alone can't answer "is something running": an orphan (a turn that ended
  // with no tool_result) and a dangling `tool_use` read off DISK at attach both stay open in it forever, and
  // keying the blink epoch + the transient region on THEM is what left a 600 ms timer running against a row
  // nothing was executing.
  const liveOpenIds = useRef<Set<string>>(new Set());
  const [liveOpen, setLiveOpen] = useState(false);   // mirror of `liveOpenIds.current.size > 0` — a ref alone can't re-run the blink effect
  const liveTurnRef = useRef<LiveTurn | null>(null);   // the in-flight turn's renderer (event-driven). Declared HERE, above the
  // first projection, because that projection's `mergeThoughtMs` reads it during the initial render.
  // F3 Task 3: the thinking clock's durations, `message:<id>` → locally clocked ms. Owned HERE rather than
  // by the LiveTurn that measures them, because the row they belong to outlives the turn: a fold group
  // stays in the transient region until a breaker publishes it, and once published it is an immutable
  // Static row that can never be re-rendered. `liveTurnRef` is nulled at turn end, so a duration read only
  // from there would take the `Thought for Ns` clause off screen the moment the turn finished. Cleared on
  // a document swap (rewind/resume/clear) — which IS P82's replay rule: durations exist nowhere on the
  // wire or on disk, so a rebuilt transcript must show no clause rather than a fabricated one.
  const thoughtMsRef = useRef<Map<string, number>>(new Map());
  // F3 Task 7: the Agent totals ladder's non-document inputs — the `system/task_*` sidechannel (P83: keyed
  // by the Agent `tool_use_id`, and the ONLY totals source for a parallel dispatch) plus the local
  // dispatch/result arrival stamps its derived rung measures against. Same lifetime rule as the thinking
  // clock above: live-only, keyed by tool-use id, and dropped on a document swap, because a rewound or
  // attached transcript never replays those frames and must fall back to what it can derive.
  const agentMetaRef = useRef<Map<string, AgentMeta>>(new Map());
  // F3 Task 4: the pending region's time-dependent group-row state — the ratcheted counters (R3.2) and the
  // throttled/lingering `⎿` hint (R4.7 steps 4–5). Upstream keeps both in refs INSIDE the row component,
  // whose instance survives a growing run's re-renders; our projection is rebuilt from scratch on every
  // 600 ms repaint, so the state has to live out here and be keyed by the run's anchor. Reads the SAME
  // injected clock as the projection, so a frame-pinning test controls the debounce too. Lazily constructed
  // (not `useRef(new …)`) so a re-render does not allocate a state object it immediately discards.
  const pendingStateRef = useRef<FoldPendingState | null>(null);
  if (pendingStateRef.current === null) pendingStateRef.current = new FoldPendingState({ now: nowFn });
  const [staticItems, setStaticItems] = useState<readonly RenderItem[]>(() => {
    const items = projectCompact(documentRef.current!, projectionContext());
    for (const item of items) publishedIds.current.add(item.id);
    return items;
  });
  const [pendingItems, setPendingItems] = useState<readonly RenderItem[]>(() => livePending());
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const docEpoch = useRef(0);              // bumped at every terminal boundary (rewind / clear / real session swap)
  const localSeq = useRef(0);              // monotonic within one epoch — two equal-looking /help runs stay distinct
  const followGen = useRef(0);             // one per follow subscription: a REDELIVERED idle replay reuses its gap identity
  const idleFollowReplay = useRef(false);  // set by a BARE truncated start, cleared by the replay-ending `state` frame
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const pendingRef = useRef<PendingDecision | null>(null); pendingRef.current = pending;
  const [pendingQueue, setPendingQueue] = useState<PendingDecision[]>([]);
  const pendingQueueRef = useRef<PendingDecision[]>([]); pendingQueueRef.current = pendingQueue;
  const answeredIds = useRef<Set<string>>(new Set());     // toolUseIDs THIS client answered — dropPending consults it, not the wire's `by` label
  // F6 T7 fix: the session's WORKING DIRECTORIES — the cwd plus every `/add-dir` grant. The file permission
  // dialog's in-directory test (upstream `z7`, L371374) runs over this set, not over the cwd alone, and the
  // difference is user-visible: after `/add-dir /other`, an Edit under `/other` must read "Yes, allow all
  // edits during this session", not "…in other/ during this session", and its constructed grant must not
  // re-add a directory the session already holds. `listDirs()` is the one place that knows, and it already
  // reports the cwd row itself (`source:"cwd"`), so the cwd needs no separate seeding beyond the initial
  // value here — which is also the answer for a session with no `SettingsOps` at all.
  const [workDirs, setWorkDirs] = useState<readonly string[]>([cwd]);
  function refreshWorkDirs() {
    if (!hasSettingsOps(session)) return;
    void session.listDirs()
      .then((rows) => { if (!disposed.current) setWorkDirs(rows.map((r) => r.path)); })
      .catch(() => {});                                   // a session that cannot answer keeps the last good list
  }
  // Once per session (a `/resume` swaps the object), plus the three call sites below: an `/add-dir` grant, a
  // workspace remove, and every decision park.
  useEffect(() => { refreshWorkDirs(); }, [session]);      // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const modeRef = useRef(mode); modeRef.current = mode;    // read inside the event effect without re-subscribing on every mode change
  const [busy, setBusy] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [usageWarn, setUsageWarn] = useState<string | undefined>(undefined);
  // Seeded from the launch config, NOT left undefined until the first turn ends: the Tab ladder's `auto`
  // rung consults this to decide whether the live model supports auto, and an unknown model there used to
  // resolve to the DEFAULT and silently downgrade a `--model opus` session to sonnet before the user had
  // typed anything. Stays undefined for `ccx attach` (that client never saw the host's launch config).
  const [model, setModel] = useState<string | undefined>(opts.initialModel);
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
  const [modelPicker, setModelPicker] = useState<{ open: boolean; models: ModelInfo[] }>({ open: false, models: [] });
  const [rewindPicker, setRewindPicker] = useState<{ open: boolean; anchors: RewindAnchor[] }>({ open: false, anchors: [] });
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; token: number; mode?: "replace" | "prepend"; pastedContents?: PastedMap } | null>(null);
  const [rewinding, setRewinding] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);   // the `?` help overlay (pure display)
  const [historyOpen, setHistoryOpen] = useState(false);       // the Ctrl-R history-search overlay
  const [addDir, setAddDir] = useState<{ open: boolean; prefill?: string }>({ open: false });   // W3 T3: /add-dir overlay
  const [themeDialog, setThemeDialog] = useState<{ open: boolean }>({ open: false });   // W3 T4: /theme overlay
  const [settings, setSettings] = useState<{ open: boolean; tab?: string }>({ open: false });   // W3 T5: /config overlay
  // Baseline SettingsRowCtx captured the moment /config opens, diffed against a fresh snapshot when it
  // closes (closeSettings). A ref, not a local ref inside SettingsDialog: the Model row reuses the
  // EXISTING top-level modelPicker overlay (chain order, ChatApp.tsx), which UNMOUNTS SettingsDialog while
  // it's up — anything the dialog itself tried to remember incrementally would be lost on that round-trip.
  const settingsBaselineRef = useRef<SettingsRowCtx | null>(null);
  const [outputStyle, setOutputStyleState] = useState<string>(opts.initialOutputStyle ?? "default");   // W3 T5: seeded from loadPrefs() by the caller (chatMain.tsx), like theme
  const [permissions, setPermissions] = useState<{ open: boolean; tab?: string }>({ open: false });   // W3 T7: /permissions overlay
  const [denials, setDenials] = useState<DenialEntry[]>([]);   // recent-denials ledger — dropPending appends via appendDenial (pure, permissionsModel.ts)
  // (behavior:rule) → the settings-file target addPermRule ALSO persisted it to (every add-rule choice
  // writes BOTH the flag layer and one of the three files — the destination picker has no "session only"
  // option), so a later removePermRule of the SAME rule knows which single file to strip it from too,
  // never a blind sweep of files we don't know contain it.
  const ruleFileTargets = useRef<Map<string, SettingsTarget>>(new Map());
  const [commandCatalog, setCommandCatalog] = useState<CommandEntry[]>(LOCAL_COMMAND_ENTRIES);   // local-only until the live fetch resolves
  const catalogNames = useRef<Set<string>>(new Set());                                            // catalog (non-local) names → routed to submit-as-prompt
  const taskListRef = useRef(new TaskList());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const bgTasksRef = useRef<typeof bgTasks>([]); bgTasksRef.current = bgTasks;
  const bgHarvest = useRef(new BgMetaHarvest());
  const killArmAt = useRef(0);
  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const [turnTokens, setTurnTokens] = useState(0);    // live output-token count for the in-flight turn (spinner)
  // Prompts/turns submitted while busy; drained FIFO on turn end, or ALL AT ONCE back into the composer on
  // Up/ctrl+p (F5 task 8, CM48). `QueueEntry` (queue.ts) is upstream's own record shape — the raw text with
  // its prefix, the mode that text implies, the priority rung, and the paste map an entry was composed with.
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef<QueueEntry[]>([]); queueRef.current = queue;
  const [submitCount, setSubmitCount] = useState(0);   // upstream's `submitCount` — the placeholder ladder's rule 4
  const drainGen = useRef(0);                          // bumped by interrupt → invalidates any scheduled drain (no post-interrupt dispatch)
  const [staticEpoch, setStaticEpoch] = useState(0);  // bumped at a terminal boundary → mounts a FRESH append-only <Static>
  const disposed = useRef(false);
  const listSessions = deps.listSessions ?? (() => realListSessions({ cwd: opts.cwd, limit: 30 }) as Promise<SessionInfo[]>);
  const getSessionMessages = deps.getSessionMessages ?? ((id: string) => realGetSessionMessages(id, { cwd: opts.cwd }) as Promise<any[]>);
  // GONE with F5 task 12: `getSessionMessagesIn` and `listHistorySessions`, the two readers that existed
  // solely to reconstruct prompt history out of persisted TRANSCRIPTS. `loadHistory` reads `history.jsonl`
  // now (see there), so neither has a caller left and neither is a dep any more.
  //
  // The env every history path in this hook reads (`CCX_FLEET_ROOT` and the skip gate), resolved once. Its
  // ChatComposer counterpart is the `historyEnv` prop, and for the same reason: a test points the whole
  // feature at a temp fleet root instead of mutating `process.env` for the rest of the suite.
  const historyEnv = deps.env ?? process.env;
  const runBash = deps.runBash ?? realRunBash;
  const savePrefsFn = deps.savePrefs ?? realSavePrefs;   // W3 T5: applyOutputStyle is useChat's first ACTUAL reader of this dep (Task 4 only threaded it through to ThemeDialog)
  const appendMemory = deps.appendMemory ?? realAppendMemory;
  const copyText = deps.copyText ?? realCopyToClipboard;
  const writeFile = deps.writeFile ?? ((p: string, t: string) => realWriteFileSync(p, t));
  // null means "nothing there, safe to create". ENOENT is the ONLY error that earns it: a target we
  // cannot read (a directory, EACCES, a binary blob) comes back as "" so the header check below fails
  // and /export refuses — we could not prove the file is ours, so we must not truncate it.
  const readFile = deps.readFile ?? ((p: string) => {
    try { return realReadFileSync(p, "utf8"); }
    catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : ""; }
  });
  // /keybindings' file opener. One seam, not two: `prepare` runs inside it, so "no editor configured" never
  // creates the starter file for an editor that was never going to open.
  const openEditor = deps.openEditor ?? ((file: string, prepare: () => void) => openInEditor(file, { prepare }));
  const renameSessionFn = deps.renameSession ?? ((id: string, t: string) => realRenameSession(id, t, { cwd: opts.cwd }));
  const tagSessionFn = deps.tagSession ?? ((id: string, t: string | null) => realTagSession(id, t, { cwd: opts.cwd }));
  const getSessionInfoFn = deps.getSessionInfo ?? ((id: string) => realGetSessionInfo(id, { cwd: opts.cwd }));
  const lastAssistant = useRef("");    // the last assistant reply's text, for /copy
  // Real terminal clear: wipe screen + scrollback + home cursor (Static is append-only — a model reset alone
  // can't erase already-printed lines, so we also clear the terminal, exactly like CC's /clear).
  const clearScreen = deps.clearScreen ?? (() => { try { if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); } catch { /* no tty */ } });
  const ranInitial = useRef(false);
  const ranInitialPrompt = useRef(false);

  // ── Projection reconciliation ────────────────────────────────────────────────────────────────────────
  /** Generic by `RenderItem.id`: filter out what is already published, append every unseen finalized item
   *  to immutable `staticItems` in projection order, then remember those ids. Tool units, assistant text,
   *  local visual output, dividers and later non-tool items all reconcile the same way, so a duplicate
   *  follow event cannot append any of them again. An OPEN call is never inserted into Static. */
  /** Copy whatever the in-flight turn has clocked so far into the map that outlives it. An unstopped block
   *  reports elapsed-so-far, so repeated merges make its value grow and the LAST merge — the one at turn
   *  end — is what it freezes at. Keyed by the sdk MESSAGE identity the projection matches on
   *  (`transcriptModel`'s `identityOf` prefers the frame uuid, which no partial frame carries). */
  function mergeThoughtMs(): void {
    const live = liveTurnRef.current;
    if (!live) return;
    for (const [id, ms] of live.thinkingDurations(nowFn())) thoughtMsRef.current.set(`message:${id}`, ms);
  }
  function reconcile(): void {
    if (disposed.current) return;
    // BEFORE the projection, not after: a group row's item id is derived from its membership alone, so a
    // run published into append-only Static with a stale (or missing) duration could never be corrected.
    mergeThoughtMs();
    const context = projectionContext();
    const finalized = projectCompact(documentRef.current!, context);
    const unseen = finalized.filter((item) => !publishedIds.current.has(item.id));
    if (unseen.length) {
      for (const item of unseen) publishedIds.current.add(item.id);
      setStaticItems((s) => [...s, ...unseen]);
    }
    setPendingItems(livePending(context));
  }
  /** The transient region: `projectPending` returns everything the compact projection cannot publish yet, and
   *  the live-open set narrows the OPEN calls to the ones a live turn is actually running — so a
   *  disk-bootstrapped dangling call, or one orphaned by a turn that ended without a result, is retained
   *  history but never a blinking row. The set is passed INTO the projection rather than used to filter its
   *  output: since Task 5c a contiguous run of collapsible calls projects to ONE group row whose id is derived
   *  from its membership, so an id-equality filter out here could no longer recognise it.
   *  It is NOT short-circuited on an empty live set: a run whose members have all settled but which no breaker
   *  has closed yet still owns a (settled-form) row here, and that row is all there is to see until the next
   *  prose or prompt publishes it into Static. */
  function livePending(context?: ProjectionContext): readonly RenderItem[] {
    // The 600 ms blink is the thinking clock's tick: merging here is what makes an OPEN thinking block's
    // `Thinking for Ns` advance without this hook owning a second timer.
    if (context === undefined) mergeThoughtMs();
    return projectPending(documentRef.current!, context ?? projectionContext(), liveOpenIds.current);
  }
  /** One live host message's effect on the live-open set: a top-level `tool_use` enters, and every id whose
   *  call has since acquired a result leaves (so a redelivered call that already settled never re-enters). */
  function syncLiveOpen(data: unknown): void {
    const live = liveOpenIds.current, m = data as any;
    if (m?.type === "assistant" && m.parent_tool_use_id === undefined)
      for (const b of m.message?.content ?? []) if (b?.type === "tool_use" && typeof b.id === "string" && b.id) live.add(b.id);
    if (live.size) for (const e of documentRef.current!.toolEvents()) if (e.result && live.has(e.id)) live.delete(e.id);
    setLiveOpen(live.size > 0);
  }
  /** A live-open boundary: nothing is running any more. Ends the blink epoch and RE-PROJECTS the transient
   *  region rather than emptying it — the orphaned calls drop out with the live set, but a fold run they were
   *  part of keeps its settled row until a breaker publishes it. The document keeps whatever stayed open
   *  verbatim, no result is ever fabricated into it. */
  function clearLiveOpen(): void {
    if (liveOpenIds.current.size === 0) return;
    liveOpenIds.current.clear();
    if (!disposed.current) { setLiveOpen(false); setPendingItems(livePending()); }
  }
  /** The 600 ms pending-tool repaint: re-projects ONLY the transient region, so the blink phase
   *  (`Math.floor(now / 600) % 2`) reaches Ink without an SDK message and Static history never moves. */
  function repaintPending(): void { if (!disposed.current) setPendingItems(livePending()); }
  /** Every local append/notice path (/help, /usage, /status, local Bash, welcome, errors, user/command
   *  echo, dividers, decisions) allocates its identity HERE, exactly once — so one retransmitted event is
   *  suppressed by document dedup while two equal-looking /help invocations still render twice. */
  function appendNewLocal(event: LocalTranscriptEvent): void {
    if (disposed.current) return;
    documentRef.current!.appendLocal(event, `event:${docEpoch.current}:${++localSeq.current}:${event.kind}`);
    reconcile();
  }
  /** The exception to the fresh-identity rule above: a local visual whose identity comes from the SOURCE
   *  frame that caused it, so a redelivered frame publishes it once rather than once per delivery. */
  function appendLocalIdentified(event: LocalTranscriptEvent, identity: string): void {
    if (disposed.current) return;
    if (documentRef.current!.appendLocal(event, identity)) reconcile();
  }
  /** The terminal boundary: a completed rewind, `/clear`, or a REAL session swap. Clear Ink's Static FIRST
   *  (never reset state values into an already-mounted <Static> — it would replay the whole history), then
   *  mount a fresh one and reconcile the new document from scratch. */
  function replaceDocument(next: TranscriptDocument): void {
    if (disposed.current) return;
    opts.clearStaticTranscript?.();
    docEpoch.current++; localSeq.current = 0; idleFollowReplay.current = false;
    clearLiveOpen();
    documentRef.current = next;
    publishedIds.current = new Set();
    thoughtMsRef.current = new Map();   // P82: a rebuilt transcript has no duration source — show none
    agentMetaRef.current = new Map();   // P83, same rule: the task sidechannel is live-only and its stamps are arrivals
    // Same rule for the latched counters and the held hint (F3 Task 4): a rebuilt transcript reuses the very
    // same tool-use ids as anchors, so a maximum latched before the swap would ride onto a run re-read from disk.
    pendingStateRef.current!.reset();

    setStaticItems([]); setPendingItems([]);
    setStaticEpoch((e) => e + 1);
    setStreaming([]);
    reconcile();
  }
  /** Task 5's route to the retained source, closed over the SAME resolved context the compact projection
   *  uses. Task 4 itself never calls it — the interim pager still shows the compact projection. */
  const detailItems: DetailItems = (projection) => projectDetail(documentRef.current!, { ...projectionContext(), projection });

  // Unmount-only sentinel: mark disposed. A parked remote permission is NOT resolved here — detach ≠
  // deny (spec A2b §5): the entry stays parked on the host for another client (or the same one, re-attached)
  // to answer. Never on a session swap.
  useEffect(() => () => { disposed.current = true; }, []);
  // The live repaint epoch: one interval while at least one top-level call is LIVE-open, cleared the moment
  // they all settle — and by turn end, an idle host, every session swap, resume/rewind reset and unmount
  // (the cleanup below). Keyed on the live set, never on the document's own open calls: an orphaned or
  // disk-bootstrapped call stays open there forever and would blink against nothing.
  useEffect(() => {
    if (!liveOpen) return;
    return scheduleRepaint(() => repaintPending(), 600);
  }, [liveOpen, session]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The ref above makes the NEXT projection honest; this makes one happen. A rebind changes no document and
  // fires no host event, so without a repaint of its own the corrected hint would wait for whatever event
  // came next — up to the whole remaining lifetime of the running call the hint is attached to. Keyed on the
  // hint VALUE (a re-render that resolves the same sentence is not a change), and the mount-time run is
  // skipped because the very first projection already read this value.
  const paintedHint = useRef(bashHint);
  useEffect(() => {
    if (paintedHint.current === bashHint) return;
    paintedHint.current = bashHint;
    repaintPending();
  }, [bashHint]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The expand hint gets the same treatment, with one honest limit worth naming: it also rides rows that are
  // already PUBLISHED into Ink's `<Static>`, which is append-only by construction (the F1 lesson) — a row
  // printed under the old chord stays printed. Re-projecting is what makes every row from here on correct,
  // and the projection cache keys on the hint so the rebind is not served the stale sentence out of cache.
  const paintedExpand = useRef(expandHint);
  useEffect(() => {
    if (paintedExpand.current === expandHint) return;
    paintedExpand.current = expandHint;
    reconcile(); repaintPending();
  }, [expandHint]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Dispose the PREVIOUS session whenever it changes (a /resume swap) and on unmount. Must not touch `disposed`.
  useEffect(() => () => { void session.dispose().catch(() => {}); }, [session]);
  // The host event stream is the SINGLE rendering source (spec A2b §2+§5, acceptance 7): a turn started by
  // another attached client renders exactly like one started here. Keyed on session identity.
  useEffect(() => {
    if (!hasSessionEvents(session)) return;
    followGen.current++;
    const off = session.onSessionEvent((ev) => {
      if (disposed.current) return;
      if (ev.kind === "turn" && ev.phase === "start") {
        // The host has TWO truncated start shapes and they mean opposite things (host.ts's follow()).
        // A BARE `{truncated:true}` with no seq is the completed idle tail: it must never open a LiveTurn,
        // never set busy, and has no later turn:end — it simply ends on the trailing `state` frame.
        if (ev.truncated && ev.seq === undefined) {
          if (!idleFollowReplay.current) { idleFollowReplay.current = true; documentRef.current!.appendFollowGap(`follow-gap:idle:${docEpoch.current}:${followGen.current}`); reconcile(); }
          return;
        }
        if (ev.truncated) { documentRef.current!.appendFollowGap(`follow-gap:${ev.seq}`); reconcile(); }
        // The SAME injected clock the projection uses: the thinking clock's arrival stamps and the `now`
        // the fold row is rendered against must not come from two different sources (a frame-capture
        // fixture pins one of them, and a live-reading LiveTurn would make its output unreproducible).
        liveTurnRef.current = new LiveTurn({ now: nowFn, columns: columnsFn, platform, cwd }); setBusy(true); setTurnStartedAt(Date.now()); setTurnTokens(0); setStreaming([]);
      }
      else if (ev.kind === "message") {
        const data = ev.data as any;
        // A `stream_event` is a PARTIAL, and it changes NOTHING outside the live turn: `appendSdk` rejects
        // partials outright, the bg harvest and the task list read only complete assistant/user frames, and
        // so do `stampAgentCalls`/`syncLiveOpen`. So the retained document cannot move here — and with
        // partials now default-on interactively a single turn carries THOUSANDS of these frames, which made
        // `reconcile()` (copy + sort + fold the whole transcript, twice, plus two setStates) run per token:
        // deltas × history. The live region is the only thing a delta may touch.
        if (data?.type === "stream_event") {
          const partial = liveTurnRef.current;
          if (partial) { partial.ingest(data); setStreaming(partial.snapshot()); setTurnTokens(partial.outputTokens); if (partial.model) setModel(partial.model); }
          return;
        }
        // Harvest bg-task metadata (command/output-file) first: a reconnect-buffer replay carries no live
        // turn but still needs to reach the (idempotent) harvest.
        bgHarvest.current.ingestMessage(ev.data);
        taskListRef.current.ingest(ev.data); setTasks(taskListRef.current.snapshot());
        // The `system/task_*` sidechannel reaches a LIVE client as its own `task` event — but the follow
        // drain replays the turn buffer as `message` frames, so an attaching client used to lose the
        // notification rung entirely and fall through to a derived duration it had no honest stamps for.
        // Ingested WITHOUT a clock: the totals on the frame are the host's measurements and stay true, the
        // arrival stamps would be ours and would be the attach instant (agentProgress.ingestTaskFrame).
        if (ev.replay) ingestTaskFrame(agentMetaRef.current, data, undefined);
        // A compact boundary is a SYSTEM frame — appendSdk retains none of those, so document dedup can
        // never suppress a redelivered one. Its identity therefore comes from the boundary itself; only a
        // uuid-less frame (nothing stable to dedup on) falls back to a fresh monotonic identity.
        if (data?.type === "system" && data.subtype === "compact_boundary") {
          // F4 Task 10b: upstream `XWo` shape B (L422282–422305) replaces the hand-rolled rule — a `⏺` bullet,
          // a bold `Compact summary`, and the LIVE expand hint. Shape A ("Summarized N messages …") needs
          // `summarizeMetadata`, which P81 read the wire frame key-by-key and did not find, so it is recorded
          // unreachable in species.ts rather than built from `compact_metadata` it does not describe.
          // The `species` tag is what lets the DETAIL projection drop the hint clause (`NAr = !iRe && …`,
          // L422289): the row is baked here, so projection needs to know which baked notice this is.
          const divider: LocalTranscriptEvent = {
            kind: "notice", lines: compactSummaryLines(expandHintRef.current, platform),
            data: { species: COMPACT_SUMMARY_SPECIES },
          };
          if (nonEmptyString(data.uuid)) appendLocalIdentified(divider, `compact-divider:${data.uuid}`); else appendNewLocal(divider);
        }
        // Task 10b: `dVo` (L428358). A `system` frame carrying a renderable string `content` is a notice the
        // transcript shows; everything else — every structured frame, every `level:"info"` line outside
        // verbose, `api_error`, the refusal-no-fallback pair — paints nothing, which `systemNoticeLines`
        // decides. The document retains NO system frame (`appendSdk` rejects them), so the identity comes
        // from the frame's own uuid exactly as the compact boundary's does, and a follow replay of the same
        // frame publishes once.
        if (data?.type === "system" && data.subtype !== "compact_boundary") {
          // `verbose: true` — deliberately, and it is NOT a claim that this client is verbose. The only thing
          // verbosity decides inside `systemNoticeLines` is the `level:"info"` gate, and that gate is a
          // PROJECTION question, not an ingest one: sdk.d.ts says info "shows only in transcript mode" and the
          // bundle's transcript screen renders the list with `verbose: !0` (L476168). Baking the row with the
          // gate OPEN and tagging it transcript-only is what lets compact hide it and ctrl+O show it; baking it
          // shut (the pre-fix shape) dropped the frame before it reached the document, so no projection —
          // detail included — could ever get it back.
          const lines = systemNoticeLines(data, { width: columnsFn(), platform, expandHint: expandHintRef.current, verbose: true });
          if (lines && lines.length) {
            const notice: LocalTranscriptEvent = { kind: "notice", lines, ...(isTranscriptOnlyNotice(data) && { data: { species: SYSTEM_INFO_SPECIES } }) };
            if (nonEmptyString(data.uuid)) appendLocalIdentified(notice, `system-notice:${data.uuid}`); else appendNewLocal(notice);
          }
        }
        // Retention is unconditional now: a completed record landing in the disk-read/follow window is
        // appended even though no new active turn starts, and document dedup — not a no-live-turn guard —
        // is what stops a redelivered copy from showing twice. /copy follows the SAME rule, so it can only
        // capture a reply that actually entered the transcript.
        // BEFORE the append: the stamp is arrival, not retention. NEVER for a replayed frame — its arrival
        // here is the moment this client attached, not the moment the work happened, and stamping a
        // completed Agent's dispatch and result microseconds apart is what made a mid-turn `ccx attach`
        // render `Done (2 tool uses · 0s)`. Spec §F3 Depends-on: a replay omits durations, it does not
        // invent them, and an unstamped call falls back to the clause-less honest row.
        if (!ev.replay) stampAgentCalls(agentMetaRef.current, data, nowFn());
        const appended = documentRef.current!.appendSdk("host", data);
        if (appended && data?.type === "assistant" && data.parent_tool_use_id === undefined) {
          const t = (data.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
          if (t.trim()) lastAssistant.current = t;
        }
        const l = liveTurnRef.current;
        if (l) { l.ingest(ev.data); setStreaming(l.snapshot()); setTurnTokens(l.outputTokens); if (l.model) setModel(l.model); }
        syncLiveOpen(data);   // AFTER the append: a result delivered in this very frame has already attached
        reconcile();
      }
      else if (ev.kind === "turn" && ev.phase === "end") {
        mergeThoughtMs();                            // the LAST read of this turn's clock — it is dropped on the next line
        const l = liveTurnRef.current; liveTurnRef.current = null;
        if (l?.model) setModel(l.model);
        // The turn's own failure is retained history, not a transient line: the live region dies with the
        // turn, so an error has to enter the document to survive into Static and a later Ctrl-O.
        // No live turn to fail INTO (an idle host died, or its synthetic close arrived with nothing
        // rendering) still earns a notice — otherwise an idle host's death is invisible until the next
        // submit times out ~10s later (F5).
        if (ev.error) l ? append([{ text: `✗ ${ev.error}`, color: role("error") }]) : notice(`✗ connection lost: ${ev.error}`);
        // A call still open at turn end is an ORPHAN (interrupted, denied, or a result that never came):
        // the turn is over, so nothing is running — end the blink epoch instead of leaving a "running" row.
        clearLiveOpen();
        setStreaming([]); setBusy(false); void refreshCtx(); void refreshUsage(); drainNext();
      }
      else if (ev.kind === "tasks_changed") setBgTasks(ev.tasks);
      else if (ev.kind === "task") {
        // These frames render NO transcript row (upstream renders none either). They used to become local
        // notices, and every local entry is a fold BREAKER — P84 shows a `task_started` arriving ~5 s into
        // every foreground Bash, so the notice was splitting fold runs mid-turn. Background-task visibility
        // is unaffected: the ↓ panel reads `bgHarvest`/`tasks_changed`, never the transcript.
        bgHarvest.current.ingestTask(ev.data);
        ingestTaskFrame(agentMetaRef.current, ev.data, nowFn());
        // Repaint on EVERY task frame, not just the ones that wrote agent meta: `bgRows` is derived at render
        // time from the harvest ref, so without a render the ↓ panel would show stale rows — which is the one
        // thing the deleted notices were incidentally providing. It also lets a `task_notification` arriving
        // after its result reach an Agent row that has already settled.
        reconcile();
      }
      else if (ev.kind === "rewound") void rebuildAfterRewind();   // ANOTHER client rewound: rebuild from disk (no prefill — not our prompt)
      else if (ev.kind === "state") {
        idleFollowReplay.current = false;                          // the trailing frame of a follow replay ends the idle-ingestion mode
        if (ev.status.status === "idle") clearLiveOpen();           // the host says nothing is running — no call of ours can still be live
        if (ev.status.permissionMode && ev.status.permissionMode !== modeRef.current) setMode(ev.status.permissionMode);
      }
    });
    const offDecision = hasDecisionFeed(session) ? session.onDecision((entry) => { if (!disposed.current) pushPending(entry); }) : undefined;
    const offSettled = hasDecisionFeed(session) ? session.onDecisionSettled((s) => { if (!disposed.current) dropPending(s.toolUseID, s.by, s.decision); }) : undefined;
    return () => { off(); offDecision?.(); offSettled?.(); };
  }, [session]);
  // Launch-time resume: run once on mount if an initialResume intent was passed.
  useEffect(() => {
    if (ranInitial.current || !opts.initialResume) return; ranInitial.current = true;
    if (opts.initialResume.kind === "id") void resumeInto(opts.initialResume.id);
    else void doContinue();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Launch-time prompt: submit once on mount if an initialPrompt was passed (mutually exclusive with
  // initialResume at the call site).
  useEffect(() => {
    if (ranInitialPrompt.current || !opts.initialPrompt) return; ranInitialPrompt.current = true;
    submit(opts.initialPrompt);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Fetch the live command catalog once per session (capabilities() works pre-turn — probe 29). On a /resume
  // swap the session changes → re-fetch. A failure/empty leaves the local-only palette (still fully usable).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const caps = await session.capabilities();
        if (cancelled || disposed.current) return;
        const catalog = (caps.commands as unknown[]).map(toCatalogEntry).filter((e): e is CommandEntry => !!e);
        catalogNames.current = new Set(catalog.map((c) => c.name));
        setCommandCatalog(mergeCommands(LOCAL_COMMAND_ENTRIES, catalog));
      } catch { /* keep the local-only catalog */ }
    })();
    return () => { cancelled = true; };
  }, [session]);

  async function refreshCtx() {
    try {
      const u = (await session.getContextUsage()) as { totalTokens?: number; maxTokens?: number };
      if (!disposed.current && u?.maxTokens) setCtxPct(Math.round(((u.totalTokens ?? 0) / u.maxTokens) * 100));
    } catch { /* best-effort */ }
  }
  // Fire-and-forget at turn-end only — never poll (spec's no-polling rule). Drives the status-bar warning;
  // /status and /usage fetch usage() directly themselves and don't route through this.
  async function refreshUsage() {
    try { const u = await session.usage(); if (!disposed.current) setUsageWarn(usageWarning(u)); return u; }
    catch { return undefined; }
  }

  function append(ls: RenderLine[]) { if (ls.length) appendNewLocal({ kind: "visual", lines: ls }); }
  function notice(text: string) { appendNewLocal({ kind: "notice", lines: [{ text, dim: true }] }); }
  // F2 task 9: text from ABOVE this tree (the keybindings.json watcher) becomes a normal transcript notice.
  // Bound once on mount — `notice` only reads refs and setState, so the mount-time closure stays correct for
  // the life of the component, and after unmount `appendNewLocal`'s `disposed` guard drops the call.
  useEffect(() => { opts.noticeBridge?.bind((text) => notice(text)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  /** /export, /files and /stats all read the PERSISTED transcript, which the SDK does not write mid-turn
   *  (probes 62-64). Local commands dispatch immediately even while busy, so running one during a turn
   *  answers from the last COMPLETED turn — an export that ends before the reply on screen, a token count
   *  that omits it. Nothing else on screen says so, so this does. */
  function staleTurnNote() { if (liveTurnRef.current) notice("  (the in-flight turn isn't included — the transcript is written at turn end)"); }

  // Decision FIFO: the dialog shows the head; extras queue behind it. `pushPending`/`dropPending` are
  // driven by the DecisionFeed subscription above — never optimistically from resolveDecision.
  function pushPending(entry: PendingDecision) {
    // Re-ask for the directory list on every park. The local `/add-dir` and workspace-remove paths refresh it
    // themselves, so this covers the one case they cannot: a directory granted by ANOTHER client on the same
    // session. It is one call per parked decision, and a late answer simply re-renders the open dialog.
    refreshWorkDirs();
    if (pendingRef.current === null) setPending(entry);
    else setPendingQueue((q) => [...q, entry]);
  }
  function dropPending(toolUseID: string, by: string, decision: string) {
    const wasMine = answeredIds.current.has(toolUseID);
    answeredIds.current.delete(toolUseID);
    // W3 T7: the recent-denials ledger. The settling entry may be the HEAD (pendingRef) or still only
    // QUEUED (pendingQueueRef) — either way its toolName/input is needed for the ledger's display string,
    // so look it up before either branch below drops it from state. appendDenial itself is the no-op gate
    // (non-deny decisions return the same array reference, so this setDenials call is a harmless no-op).
    const entry = pendingRef.current?.toolUseID === toolUseID ? pendingRef.current : pendingQueueRef.current.find((e) => e.toolUseID === toolUseID);
    if (entry) setDenials((d) => appendDenial(d, decision, entry.toolName, entry.input, by, Date.now()));
    if (pendingRef.current?.toolUseID === toolUseID) {
      if (!wasMine) {
        const verb = decision === "deny" ? "denied" : decision === "question_answer" ? "answered" : decision === "plan_approve" ? "approved" : decision === "plan_reject" ? "sent back" : "allowed";
        notice(`↳ ${pendingRef.current.toolName} ${verb} by ${by}`);
      }
      const q = pendingQueueRef.current;
      setPending(q[0] ?? null);
      setPendingQueue(q.slice(1));
    } else {
      setPendingQueue((q) => q.filter((e) => e.toolUseID !== toolUseID));   // settled while only queued (never shown)
    }
  }

  async function handleCommand(cmd: ParsedCommand) {
    // F4 Task 8: a slash command echoes through the SAME band as a prompt — `› ` + dim was our invention.
    // The ECHO keeps what the user typed (`/undo`, not `/rewind`); only the DISPATCH is canonicalized, and
    // exactly once, here — every arm below therefore matches on canonical names only (F6 T10's alias
    // mechanism, commands.ts's `canonicalCommand`).
    appendNewLocal({ kind: "command-echo", lines: userEchoLines(`/${cmd.name}${cmd.args ? " " + cmd.args : ""}`, { width: columnsFn() }) });
    const name = canonicalCommand(cmd.name);
    try {
      switch (name) {
        case "model":
          // `/model opus` must reach the engine as an id: the SDK's own `opus` alias still means Opus 4.8 (probe 72).
          if (cmd.args) { const m = resolveModelAlias(cmd.args)!; await session.setModel(m); if (!disposed.current) setModel(m); append(formatModel(m)); }
          else { await openModelPicker(); }
          break;
        case "compact": append(formatCompact(await session.compact())); break;
        case "context": append(formatContext(summarizeUsage((await session.getContextUsage()) as RawContextUsage))); break;
        case "cost": append(formatCost((await session.usage()) as SessionUsage)); break;
        case "status": {
          const u = await session.usage().catch(() => undefined);
          append(formatStatus({ model, mode, thinkLevel, ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined }));
          break;
        }
        case "usage": append(formatUsage(await session.usage())); break;
        case "clear": clear(); break;
        case "help": append(formatHelp()); break;
        case "resume": void openPicker(); break;
        case "continue": void doContinue(); break;
        case "yolo": void applyMode("bypassPermissions"); break;
        case "think":
          if (cmd.args) {
            const parsed = parseThinkArg(cmd.args);
            if (!parsed) { append([{ text: `thinking: unknown level "${cmd.args}" · try off/low/medium/high/xhigh/max or a number`, color: role("error") }]); break; }
            await session.setMaxThinkingTokens(parsed.budget);
            if (!disposed.current) setThinkLevel(parsed.level);
            append(formatThink(parsed.level));
          } else append(formatThink(undefined, thinkLevel));
          break;
        case "mcp": {
          const action = parseMcpArgs(cmd.args);
          if (!action) { append(formatMcpUsage()); break; }
          if (action.kind === "status") append(formatMcpStatus(await session.mcpServerStatus()));
          else if (action.kind === "reconnect") { await session.reconnectMcpServer(action.name); append([{ text: `mcp: reconnected ${action.name}` }]); }
          else { await session.toggleMcpServer(action.name, action.enabled); append([{ text: `mcp: ${action.name} → ${action.enabled ? "enabled" : "disabled (advisory — a tool call can revive it)"}` }]); }
          break;
        }
        case "bg": openBgPanel(); break;
        // A recorded ccx ADDITION, not an upstream command. Upstream reaches the full-screen picker only
        // through ctrl+r in fullscreen layout (`if (yie() && mr)`, bundle L496209); our REPL is permanently
        // classic, where that chord is the inline reverse-i-search instead — so without a command the picker
        // would be unreachable. See ChatApp's `app:toggleTranscript` neighbour for the full routing note.
        case "history": openHistorySearch(); break;
        case "rewind": void openRewind(); break;
        case "copy": { const t = lastAssistant.current; if (!t) { notice("nothing to copy"); break; } await copyText(t); notice(`✓ copied ${t.length} chars`); break; }
        case "export": {
          const id = session.sessionId;
          if (!id) { notice("no conversation to export yet"); break; }
          const msgs = await getSessionMessages(id).catch(() => [] as any[]);
          if (!msgs.length) { notice("no conversation to export yet"); break; }
          const md = exportMarkdown(msgs, { id });
          if (cmd.args === "clipboard") { await copyText(md); notice(`✓ copied ${md.length} chars of markdown`); staleTurnNote(); break; }
          // resolve, not join: `join(cwd, "/tmp/x.md")` silently yields "<cwd>/tmp/x.md" and then reports
          // that surprising path as success. resolve() honors an absolute path as typed.
          const path = resolvePath(cwd, cmd.args || defaultExportName(id));
          // writeFile TRUNCATES. `/export package.json` would destroy it with no prompt, so overwrite only
          // a file we can prove is a previous export of ours; anything else is the user's to lose, not ours.
          const existing = readFile(path);
          if (existing !== null && !existing.startsWith(EXPORT_HEADER)) { append([{ text: `✗ refusing to overwrite ${path} — not a previous ccx export`, color: role("error") }]); break; }
          writeFile(path, md);
          notice(`✓ exported to ${path}`);
          staleTurnNote();
          break;
        }
        case "files": {
          const id = session.sessionId;
          const msgs = id ? await getSessionMessages(id).catch(() => [] as any[]) : [];
          append(formatFiles(filesInContext(msgs)));
          staleTurnNote();
          break;
        }
        // Terminal stand-in for CC's diff dialog: status for the shape, stat for the sizes.
        case "diff": append(formatBashOutput(await runBash("git status --short; git diff --stat", cwd))); break;
        case "stats": {
          const u = (await session.usage().catch(() => ({}))) as SessionUsage;
          const msgs = session.sessionId ? await getSessionMessages(session.sessionId).catch(() => [] as any[]) : [];
          append(formatStats(u, msgs));
          staleTurnNote();
          break;
        }
        case "session": {
          const id = session.sessionId;
          if (!id) { notice("no session yet — send a first prompt"); break; }
          append(formatSessionInfo({ id, cwd: opts.cwd, info: await getSessionInfoFn(id).catch(() => undefined) }));
          break;
        }
        case "rename": {
          const id = session.sessionId;
          if (!id) { notice("no session yet — send a first prompt"); break; }
          if (!cmd.args) { const i = await getSessionInfoFn(id).catch(() => undefined); notice(`title: ${(i as any)?.customTitle ?? "(auto)"} — /rename <new title> to change`); break; }
          await renameSessionFn(id, cmd.args);
          notice(`✓ renamed to "${cmd.args}"`);
          break;
        }
        case "tag": {
          const id = session.sessionId;
          if (!id) { notice("no session yet — send a first prompt"); break; }
          const i = (await getSessionInfoFn(id).catch(() => undefined)) as { tag?: string } | undefined;
          if (!cmd.args) { notice(i?.tag ? `tag: #${i.tag} — /tag ${i.tag} to clear` : "no tag — /tag <name> to set"); break; }
          const next = i?.tag === cmd.args ? null : cmd.args;   // CC semantics: toggling the same tag clears it
          await tagSessionFn(id, next);
          notice(next ? `✓ tagged #${next}` : "✓ tag cleared");
          break;
        }
        // /add-dir: no arg → entry phase (the dialog itself prompts + validates via addDirValidate below).
        // With an arg, validate NOW against cwd + the live additional-dir list: invalid → print the
        // verdict's message (the generic echo above already showed the attempt); valid → skip straight to
        // the confirm phase, pre-filled with the resolved path (no re-typing what was already typed once).
        case "add-dir": {
          if (!hasSettingsOps(session)) { notice("add-dir unsupported on this session"); break; }
          if (!cmd.args) { setAddDir({ open: true }); break; }
          const v = await addDirValidate(cmd.args);
          if (v.kind === "ok") setAddDir({ open: true, prefill: v.abs });
          else append(formatAddDirVerdict(v));
          break;
        }
        // /theme: a pure client feature (no engine round-trip) — the dialog owns setTheme/savePrefs itself
        // (theme.ts's setTheme has "no persistence — caller's job", and the dialog IS that caller); this
        // just opens/closes it and prints whatever result line it hands back via closeThemeDialog.
        case "theme": setThemeDialog({ open: true }); break;
        // /config [key=value] (W3 T6): bare → open the Settings shell at Config (openSettings always seeds
        // tab:"Config"). With a key=value arg, parseConfigArg validates it against the SAME row model
        // SettingsDialog renders (buildRows(currentSettingsCtx()) — never a second copy of the row/
        // permission-mode/theme-id lists) and returns either an error to print or a validated {id,value} to
        // apply. parseConfigArg only decided WHAT to set, never HOW — that's this switch, so a rejected
        // parse can never partially mutate state. /settings is upstream's literal alias (Task 6 brief),
        // sharing this exact case body including its own args.
        case "settings":
        case "config": {
          const result = parseConfigArg(cmd.args, buildRows(currentSettingsCtx()));
          if (result.kind === "open") { openSettings(); break; }
          if (result.kind === "error") { append(result.lines); break; }
          switch (result.id) {
            // theme applies exactly like ThemeDialog's own Enter handler (setTheme + savePrefs) — the SAME
            // primitive, no session round-trip, matching /theme's own no-engine-touch design.
            case "theme": setTheme(result.value as ThemeId); savePrefsFn({ theme: result.value as ThemeId }); break;
            // model applies exactly like /model's own arg path — resolveModelAlias is the SAME tier-alias
            // translation ("opus" must still resolve to the real id, probe 72).
            case "model": { const m = resolveModelAlias(result.value)!; await session.setModel(m); if (!disposed.current) setModel(m); break; }
            case "outputStyle": await applyOutputStyle(result.value); break;
            case "permissionMode": await applyMode(result.value); break;
            // Boolean row vocabulary ("true"/"false") → setThink's own off/default vocabulary (its doc comment).
            case "thinking": await setThink(result.value === "false" ? "off" : "default"); break;
          }
          if (!disposed.current) append(result.lines);
          break;
        }
        // /permissions (W3 T7, alias /allowed-tools — upstream's own name for the same surface): the five-
        // tab Recently-denied/Allow/Ask/Deny/Workspace dialog. Needs SettingsOps the same way /add-dir does
        // (getSettings/listDirs/addRule/removeRule/addDir/removeDir all live behind that guard).
        case "permissions":
        case "allowed-tools":
          if (!hasSettingsOps(session)) { notice("permissions unsupported on this session"); break; }
          openPermissions();
          break;
        // /output-style (W3 T6): upstream folded the standalone picker into /config's Output-style row —
        // print the exact redirect line, then open Settings AT Config (openSettings always does), never the
        // picker directly (Global Constraints line 33).
        case "output-style": notice(OUTPUT_STYLE_REDIRECT); openSettings(); break;
        // /keybindings (F2 task 9): upstream's own "Open your keyboard shortcuts file", and now literally
        // that — the file IS the customization surface (~/.claude/keybindings.json, merged over the defaults
        // and hot-reloaded, so the edit applies the moment it is saved; no restart, no confirm step). The
        // starter template is written only when an editor exists to open it. The read-only `?` keymap is the
        // fallback for a shell with neither $VISUAL nor $EDITOR set: there is nothing to open there, and the
        // W3 divergence line ("customization isn't supported yet") is retired — it no longer holds.
        case "keybindings": {
          const file = userBindingsPath({ home });
          // mkdir -p BEFORE the seed write, the same way prefs.ts and settingsFile.ts do it: on a fresh
          // machine `~/.claude` may not exist at all (the session connects lazily, so a first-launch
          // /keybindings beats everything that would create it) and a bare writeFileSync would throw ENOENT
          // into the catch below — a raw errno where the editor should have been. Not injected: `home` above
          // already is, so a test's mkdir lands in its own mkdtemp dir.
          const result = openEditor(file, () => { if (readFile(file) === null) { mkdirSync(dirname(file), { recursive: true }); writeFile(file, STARTER_KEYBINDINGS); } });
          if (result === "no-editor") { notice(`set $VISUAL or $EDITOR to edit ${file} — showing the built-in keymap instead`); openShortcuts(); break; }
          if (result === "failed") { notice(`✗ couldn't open ${file} in your editor`); break; }
          notice(`${file} — saved changes apply live`);
          break;
        }
        // Same exit the Ctrl-D / Ctrl-C-twice keys use — the host owns the actual unmount (opts.onExit).
        case "exit": case "quit": opts.onExit?.(); break;
        // F0 KB5: detach moved off the Ctrl-Z chord onto this command. opts.detach is only set for an
        // attached client (ChatApp.tsx); a loopback client has nobody else to hand the session to, so it
        // refuses with the same notice Ctrl-Z used to print. Never touches a pending decision either way —
        // detach ≠ deny, the park stays host-owned regardless of how this client leaves.
        case "detach": if (opts.detach) opts.detach(); else notice("not detachable — run with --detachable, or ccx attach from another terminal"); break;
        default: append(formatUnknown(cmd.name));
      }
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }

  async function openPicker() {
    try { const sessions = await listSessions(); if (!disposed.current) setPicker({ open: true, sessions }); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  function closePicker() { if (!disposed.current) setPicker({ open: false, sessions: [] }); }
  // Fetch the persisted transcript FIRST; only swap + replay if it has history (never drop into a broken resume).
  // Guarded on `busy` (mirrors the host's own busy-gated `resume` op, Task 2): swapping `session` mid-turn would
  // unsubscribe the `[session]`-keyed event effect from the OLD session before its turn-end event arrives, and
  // since busy is now cleared only by that event (no `.finally()` safety net post-refactor), busy would stay
  // stuck true forever and drainNext would never fire. We never auto-interrupt the old turn — that's the
  // human's call (Esc).
  async function resumeInto(id: string) {
    if (disposed.current) return;
    if (busy) { notice("cannot resume mid-turn — wait for the turn to finish or press Esc to interrupt"); return; }
    let msgs: any[] = [];
    try { msgs = await getSessionMessages(id); } catch { msgs = []; }
    if (disposed.current) return;
    if (!msgs.length) { append([{ text: `⚠ couldn't resume ${id.slice(0, 8)} — no history found`, dim: true }]); return; }
    const sameSession = session.sessionId === id;
    setSession(makeSession(id));                                   // [session] effect disposes the old
    clearLiveOpen();                                               // the old engine's in-flight calls died with it — nothing of ours is live now
    // Same conversation: APPEND the raw persisted rows into the EXISTING document and reconcile only the
    // ids nobody has seen. Replacing it with disk-only rows would erase every prior local notice and
    // command output from later Ctrl-O detail — a real session change is the only terminal boundary.
    if (sameSession) { for (const m of msgs) documentRef.current!.appendSdk("disk", m); setStreaming([]); reconcile(); }
    else replaceDocument(replayDocument(msgs, { id, width: columnsFn() }));
    lastAssistant.current = lastAssistantText(msgs);            // /copy follows what is ON SCREEN, not just live turns
    taskListRef.current.reset(); setTasks([]);
    bgHarvest.current.reset();
    // The old session's bg tasks died with its engine — the old subscription is already detached, and no
    // `tasks_changed:[]` correction can ever arrive to clear them (the new host's follow() only replays a
    // NON-EMPTY snapshot). Without this, stale ⟳ running rows linger forever and killAgents targets ids
    // the new engine never had (F2, final review).
    setBgTasks([]);
  }
  async function doContinue() {
    try {
      const sessions = await listSessions();
      const id = pickMostRecent(sessions);
      if (!id) { append([{ text: "No sessions to continue here", dim: true }]); return; }
      await resumeInto(id);
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  function pickSession(info: SessionInfo) {
    if (disposed.current) return;
    setPicker({ open: false, sessions: [] });
    void resumeInto(info.sessionId);
  }

  async function openModelPicker() {
    try {
      const caps = await session.capabilities();
      if (disposed.current) return;
      const models: ModelInfo[] = (caps.models as any[]).map((m) => ({ value: String(m?.value ?? m), displayName: m?.displayName, description: m?.description }));
      if (!models.length) { append([{ text: "no models available", dim: true }]); return; }
      setModelPicker({ open: true, models });
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  function closeModelPicker() { if (!disposed.current) setModelPicker({ open: false, models: [] }); }
  function pickModel(m: ModelInfo) {
    if (disposed.current) return;
    setModelPicker({ open: false, models: [] });
    // The picker's rows come straight from supportedModels(), whose values are TIER ALIASES ("opus"), so the
    // same translation the /model command does applies here — otherwise picking "Opus" selects Opus 4.8.
    const v = resolveModelAlias(m.value)!;
    // This same picker is shared by the standalone /model command AND the Settings Model row (ChatApp's
    // overlay-chain comment on the settings arm) — `settings.open` stays true the whole time the Settings
    // route has this picker up (only the picker's OWN arm outranks it in that ternary; Settings itself never
    // closes), so it's the one signal that tells the two callers apart here. Reached via Settings, the
    // close-time change summary already reports this row's change — printing the immediate notice too would
    // report the same fact twice (review finding 1). The standalone /model path (settings closed) keeps it,
    // exactly like every other /model invocation.
    const fromSettings = settings.open;
    // Commit synchronously, BEFORE the engine round-trip — not after (final review Finding 2). The old
    // code deferred setModel(v) until `await session.setModel(v)` settled, catching any rejection into a
    // no-op first — so a failed engine call was already indistinguishable from a successful one; deferring
    // the commit bought no correctness, it only opened a window where Esc landing mid-request hit
    // closeSettings while `model` was still the OLD value, so the diff saw no change and printed "Config
    // dialog dismissed" even though the model WAS about to change. Committing first closes that window:
    // by the time any later keypress (Esc included) is processed, this state update has already rendered.
    setModel(v);
    if (!fromSettings) append(formatModel(v));
    void session.setModel(v).catch(() => {});
  }

  // W3 T3: /add-dir. `addDirValidate` is the ONE place that turns a typed path into a verdict — both the
  // command-line arg path above and the dialog's own entry-phase Enter call it, so they can never drift on
  // what counts as valid. `dirs` excludes cwd (validateAddDir takes cwd as its own parameter, matching the
  // host's own cwd/additionalDirectories split — see listDirs's doc comment on the host side).
  async function addDirValidate(raw: string): Promise<AddDirVerdict> {
    if (!hasSettingsOps(session)) throw new Error("add-dir unsupported on this session");
    const rows = await session.listDirs();
    const dirs = rows.filter((r) => r.source !== "cwd").map((r) => r.path);
    return validateAddDir(raw, cwd, dirs);
  }
  function closeAddDir() { if (!disposed.current) setAddDir({ open: false }); }
  // Accept: grant via the session FIRST (the typed door), then optionally persist to local settings. A
  // save failure does NOT roll back or hide the grant — "the session grant already succeeded" (brief) — it
  // only changes which result line prints.
  async function confirmAddDir(abs: string, remember: boolean) {
    closeAddDir();
    if (!hasSettingsOps(session)) return;
    try {
      await session.addDir(abs);
      if (disposed.current) return;
      refreshWorkDirs();                                  // the file dialog's in-directory test reads this
      if (!remember) { append(formatAddDirResult({ kind: "addedSession", abs })); return; }
      try {
        mergeSettingsFile("localSettings", cwd, appendToArray(["permissions", "additionalDirectories"], abs), deps.settingsFileDeps);
        append(formatAddDirResult({ kind: "addedRemembered", abs }));
      } catch (e) { append(formatAddDirResult({ kind: "addedSaveFailed", abs, err: (e as Error).message })); }
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  function cancelAddDir(abs?: string) {
    closeAddDir();
    append(formatAddDirResult(abs ? { kind: "cancelledPath", abs } : { kind: "cancelledEmpty" }));
  }

  // W3 T4: /theme. ThemeDialog's Enter/Esc handlers already did the setTheme/savePrefs work themselves
  // (this dialog needs no session access) — `line` is the exact verbatim result string ("Theme set to
  // {id}" / "Theme picker dismissed"), just close + print it.
  function closeThemeDialog(line: string) { if (!disposed.current) { setThemeDialog({ open: false }); notice(line); } }

  // W3 T5: /config. A snapshot-diff design, not incremental change-tracking (see the settingsBaselineRef
  // comment above) — currentSettingsCtx() reads currentTheme() FRESH each call (theme.ts's own contract:
  // never cache it) alongside whatever this hook's own state currently holds for model/outputStyle/mode/
  // thinkLevel, so both the open-time baseline and the close-time snapshot are always accurate regardless
  // of how many times the Model/Theme/Output-style sub-flows ran in between.
  function currentSettingsCtx(): SettingsRowCtx { return { theme: currentTheme(), model, outputStyle, mode, thinkLevel }; }
  function openSettings() {
    if (disposed.current) return;
    settingsBaselineRef.current = currentSettingsCtx();
    setSettings({ open: true, tab: "Config" });
  }
  function setSettingsTab(tab: string) { if (!disposed.current) setSettings((s) => ({ ...s, tab })); }
  function closeSettings() {
    if (disposed.current) return;
    const baseline = settingsBaselineRef.current;
    settingsBaselineRef.current = null;
    setSettings({ open: false });
    if (!baseline) { notice("Config dialog dismissed"); return; }
    const before = buildRows(baseline), after = buildRows(currentSettingsCtx());
    const changes = new Map<string, string>();
    before.forEach((row, i) => { if (row.value !== after[i]?.value) changes.set(row.label, after[i].value); });
    const lines = summarizeChanges(changes);
    if (lines.length) append(lines); else notice("Config dialog dismissed");
  }
  // The Thinking-mode row's boolean toggle: "off" (budget 0, disabled) or anything else canonicalized to
  // "default" (budget null — the SDK's own default thinking behavior, i.e. exactly the state before any
  // /think call ever ran). Deliberately NOT /think's off/low/medium/high/xhigh/max/<N> vocabulary — the
  // typed /think command is untouched by this, so neither can regress the other.
  async function setThink(level: string): Promise<void> {
    if (disposed.current) return;
    const next = level === "off" ? "off" : "default";
    // Commit first, same reasoning as pickModel above (final review Finding 2): the engine call's own
    // rejection is already swallowed below and never rolls this back, so committing before the await
    // removes the window where closeSettings could diff against a still-stale thinkLevel if Esc landed
    // while setMaxThinkingTokens was still in flight.
    setThinkLevel(next);
    await session.setMaxThinkingTokens(next === "off" ? 0 : null).catch(() => {});
  }
  // The Output-style row: apply the live engine style (best-effort, like every other flag-state op — a
  // session without SettingsOps just skips this leg), remember it in ccx's own prefs (the seed for next
  // boot's SettingsRowCtx.outputStyle), and write it into Claude Code's OWN local settings file so the
  // engine picks it back up natively at next launch — the same "remember" write /add-dir uses, just a
  // scalar patch instead of appendToArray.
  async function applyOutputStyle(id: string): Promise<void> {
    if (disposed.current) return;
    // Commit + persist first, same reasoning as pickModel/setThink above (final review Finding 2): the
    // awaited session.setOutputStyle call's own rejection is already swallowed below and never rolls this
    // back, so committing before the await removes the window where closeSettings could diff against a
    // still-stale outputStyle if Esc landed while the engine round trip was still in flight.
    setOutputStyleState(id);
    savePrefsFn({ outputStyle: id });
    try { mergeSettingsFile("localSettings", cwd, (current) => ({ ...(current && typeof current === "object" ? current : {}), outputStyle: id }), deps.settingsFileDeps); } catch { /* best-effort — no visible error line, mirrors theme's own silent persistence */ }
    if (hasSettingsOps(session)) await session.setOutputStyle(id).catch(() => {});
  }
  // The Settings dialog's Status/Usage/Stats tabs — mirror the /status, /usage, /stats cases exactly
  // (formatStatus/formatUsage/formatStats), just returning lines instead of appending them: the dialog
  // renders them itself, read-only.
  async function fetchSettingsStatus(): Promise<RenderLine[]> {
    const u = await session.usage().catch(() => undefined);
    return formatStatus({ model, mode, thinkLevel, ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined });
  }
  async function fetchSettingsUsage(): Promise<RenderLine[]> { return formatUsage(await session.usage()); }
  async function fetchSettingsStats(): Promise<RenderLine[]> {
    const u = (await session.usage().catch(() => ({}))) as SessionUsage;
    const msgs = session.sessionId ? await getSessionMessages(session.sessionId).catch(() => [] as any[]) : [];
    return formatStats(u, msgs);
  }

  // W3 T7: /permissions. Default tab is decided HERE (not in the component), mirroring openSettings's own
  // "always Config" simplicity — "Recently denied" if there's anything to show there, else "Allow" (the
  // upstream default-tab rule, Global Constraints line 34). Computed once at open time, not re-evaluated
  // live while the dialog is already up (a denial arriving mid-session doesn't yank focus to a new tab).
  function openPermissions() {
    if (disposed.current) return;
    setPermissions({ open: true, tab: denials.length ? "Recently denied" : "Allow" });
  }
  function setPermissionsTab(tab: string) { if (!disposed.current) setPermissions((p) => ({ ...p, tab })); }
  function closePermissions() { if (!disposed.current) { setPermissions({ open: false }); notice("Permissions dialog dismissed"); } }
  async function fetchPermSettings(): Promise<unknown> { return hasSettingsOps(session) ? session.getSettings() : {}; }
  async function fetchPermDirs(): Promise<{ path: string; source: "cwd" | "launch" | "session" }[]> { return hasSettingsOps(session) ? session.listDirs() : []; }
  // Add: the flag-layer grant (immediate, this session, via SettingsOps.addRule) AND a persisted write to
  // the CHOSEN file — every add-rule choice persists (the destination picker has no "session only" option,
  // unlike /add-dir's own three-way menu). Tracks which file so a LATER delete of this exact rule can undo
  // both halves, not just the flag layer (see removePermRule below). A file-write failure does not roll
  // back the already-succeeded flag-layer grant, mirroring /add-dir's own save-failure tolerance.
  async function addPermRule(behavior: "allow" | "ask" | "deny", rule: string, target: SettingsTarget): Promise<void> {
    if (disposed.current || !hasSettingsOps(session)) return;
    await session.addRule(behavior, rule).catch(() => {});
    if (disposed.current) return;
    try {
      mergeSettingsFile(target, cwd, appendToArray(["permissions", behavior], rule), deps.settingsFileDeps);
      ruleFileTargets.current.set(`${behavior}:${rule}`, target);
    } catch { /* best-effort persistence — the flag-layer grant above already succeeded */ }
  }
  // Remove: the flag-layer revoke (always, via SettingsOps.removeRule) + the file strip ONLY when this
  // EXACT rule was added through addPermRule above and we therefore know which of the three files to touch
  // — never a blind sweep of files we don't know contain it (a rule whose row came from an ACTUAL settings
  // file, not the flag layer, is readOnly and never reaches this function at all — the dialog routes it to
  // the read-only panel instead).
  async function removePermRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void> {
    if (disposed.current || !hasSettingsOps(session)) return;
    await session.removeRule(behavior, rule).catch(() => {});
    if (disposed.current) return;
    const key = `${behavior}:${rule}`;
    const target = ruleFileTargets.current.get(key);
    if (target) {
      try { mergeSettingsFile(target, cwd, removeFromArray(["permissions", behavior], rule), deps.settingsFileDeps); } catch { /* best-effort, same tolerance as addPermRule */ }
      ruleFileTargets.current.delete(key);
    }
  }
  // Workspace tab's session-dir remove: flag-layer revoke only — a /add-dir "remember" write is never
  // un-written on removeDir (no un-remember mechanism this wave; recorded divergence, Global Constraints).
  async function removeWorkspaceDir(path: string): Promise<void> {
    if (disposed.current || !hasSettingsOps(session)) return;
    await session.removeDir(path).catch(() => {});
    refreshWorkDirs();
  }

  // Esc-Esc rewind (Stage C5 flagship). Anchors are ALWAYS re-fetched, never patched locally — the persisted
  // transcript's row arithmetic after a rewind doesn't match naive local bookkeeping (live probe 68 Q4).
  async function openRewind() {
    if (disposed.current) return;
    if (busy) { notice("cannot rewind mid-turn — Esc to interrupt first"); return; }
    if (!hasRewind(session)) { notice("rewind unsupported on this session"); return; }
    try {
      const anchors = await session.rewindAnchors();
      if (disposed.current) return;
      // AN EMPTY LIST STILL OPENS THE DIALOG (F6 T10). Upstream has no "nothing to rewind to" notice: the
      // Rewind dialog opens and says `Nothing to rewind to yet.` inside its own frame (L487190's `!R` arm),
      // which is also the only way that literal is reachable. The picker owns the empty state now.
      setRewindPicker({ open: true, anchors });
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  function closeRewindPicker() { if (!disposed.current) setRewindPicker({ open: false, anchors: [] }); }
  /** Rebuild the transcript from the PERSISTED session after a conversation rewind truncated it. Shared by
   *  the client that confirmed the rewind and by every other follower reacting to the host's `rewound`
   *  broadcast — a follower passes no prefill, because someone else's rewound prompt does not belong in
   *  this user's composer. Idempotent: re-reading disk and re-rendering is harmless if it runs twice. */
  async function rebuildAfterRewind(prefill?: string) {
    const id = session.sessionId;
    let msgs: any[] = [];
    if (id) { try { msgs = await getSessionMessages(id); } catch { msgs = []; } }
    if (disposed.current) return;
    // A rewind is a deliberate session transition: the fresh document derives ONLY the restored persisted
    // messages. (Ctrl-O never uses this path.)
    if (msgs.length) replaceDocument(replayDocument(msgs, { id, label: "⏪ rewound", width: columnsFn() }));
    else { const fresh = new TranscriptDocument(); fresh.appendLocal({ kind: "rewind-divider", lines: [{ text: "⏪ rewound", dim: true }] }, "rewind:empty"); replaceDocument(fresh); }
    lastAssistant.current = lastAssistantText(msgs);        // /copy follows what is on screen
    taskListRef.current.reset(); setTasks([]);
    bgHarvest.current.reset();
    if (prefill !== undefined) setComposerPrefill({ text: prefill, token: Date.now() });
  }

  function rewindDryRun(uuid: string): Promise<RewindDryRun> {
    return hasRewind(session) ? session.rewindDryRun(uuid) : Promise.resolve({ canRewind: false, error: "unsupported" });
  }
  // A conversation rewind ("both"/"conversation") rebuilds the transcript from the persisted session, bumps
  // staticEpoch (mounting a FRESH append-only <Static>), and pre-fills the composer with the rewound prompt's text —
  // CC's edit-and-resend loop. A code-only rewind changes no conversation state: just a notice.
  function confirmRewind(anchor: RewindAnchor, scope: RewindScope) {
    closeRewindPicker();
    if (!hasRewind(session)) return;
    // A rewind is a multi-second engine operation (file restore + engine swap). Without a modal the
    // composer remounts immediately while `busy` is still false, so a prompt typed in that window is
    // cleared from the editor, forwarded, and rejected by the host as busy — silently losing what the
    // user typed. `rewinding` keeps the composer off-screen until the operation settles.
    setRewinding(true);
    void (async () => {
      try {
        await session.rewind(anchor, scope);
        if (disposed.current) return;
        if (scope === "code") { notice(`⏪ code restored to before "${anchor.text.slice(0, 40)}"`); return; }
        await rebuildAfterRewind(anchor.text);
      // Upstream's own failure copy (`ce`, bundle L487142-154), chosen by the scope that was asked for —
      // see rewindFailureHeading for why the arm cannot be chosen by which half actually threw, and for the
      // one arm of upstream's four that has no channel to reach us at all.
      } catch (e) { append([{ text: rewindFailureHeading(scope), color: role("error") }, { text: (e as Error).message, color: role("error") }]); }
      finally { if (!disposed.current) setRewinding(false); }
    })();
  }

  // The command channel: echo the prompt, then hand it to the session. ALL rendering (busy/streaming/
  // tasks/model/lines) comes from the event effect above, not from this call — a turn started by another
  // attached client renders identically (spec A2b acceptance 7). onMessage is a deliberate no-op: the
  // events, not the submit callback, own the render.
  function runTurn(prompt: string) {
    // THE live prompt echo. It shares `userEchoLines` with replay and the queued list so the band a prompt
    // wears cannot depend on which surface minted it. Baked at the width of the moment: a local entry's lines
    // project verbatim (`projectLocalEvent`), so an already-echoed prompt keeps its band across a resize.
    appendNewLocal({ kind: "user-echo", lines: userEchoLines(prompt, { width: columnsFn() }) });
    session.submit(prompt, () => {}).catch((e) => {
      append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]);
      // Only reclaim busy/drain when no turn is event-owned (liveTurnRef null): a live turn — another
      // client's turn streaming, or our own turn that already started and whose end (incl. a synthetic
      // one on host death) the turn-end event arm will still deliver — owns busy/drain on its own; doing
      // it again here would double-drain the queue and can clobber busy out from under a stream that is
      // in fact still live (F2).
      if (liveTurnRef.current === null) { setBusy(false); drainNext(); }
    });
  }
  // After a turn ends, dispatch the next queued prompt (if any) on the next macrotask, so busy=false has
  // committed before dispatch may set it true again. A drained TURN re-drains via its finally (self-chaining);
  // a drained non-turn (e.g. a queued unknown/typo `/cmd`) has no finally, so we re-drain here so the chain
  // never stalls. `drainGen` lets interrupt() cancel an already-scheduled drain (no post-interrupt dispatch).
  function drainNext() {
    const q = queueRef.current;
    if (disposed.current || q.length === 0) return;
    // The REF is written beside the state, this file's standing discipline — and it matters more since F5
    // task 8. `queueRef.current` is otherwise only refreshed during render, so between this call and the
    // next commit the ref would still hold the entry this drain has already claimed; an Up landing in that
    // window would let `popQueueToComposer` hand the SAME prompt back to the composer while the scheduled
    // `dispatch` was still going to send it — edited and submitted at once. Written, not left to React:
    // under ink-testing-library the commit happens to flush synchronously inside the event emit, so the
    // window is not observable from a test (a discriminating regression test was attempted three ways and
    // each passed with the write reverted — see the task-8 report's follow-up pass). Depending on that
    // flush timing for a correctness invariant is exactly what this file's ref discipline exists to avoid.
    const next = q[0].value, rest = q.slice(1); queueRef.current = rest; setQueue(rest);
    const gen = drainGen.current;
    setTimeout(() => { if (disposed.current || drainGen.current !== gen) return; if (!dispatch(next)) drainNext(); }, 0);
  }
  // ! bash mode — echo the command, run it locally in cwd, append its output (no model turn; CC's shell escape).
  async function runBashMode(command: string) {
    if (disposed.current || !command) return;
    appendNewLocal({ kind: "command-echo", lines: [{ text: `! ${command}`, color: role("bashBorder") }] });   // immediate echo
    try { const r = await runBash(command, cwd); if (!disposed.current) append(formatBashOutput(r)); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  // # memory mode — append the note to the project CLAUDE.md (CC's `#` adds to a memory file).
  function memoryMode(note: string) {
    if (disposed.current || !note) return;
    try { const path = appendMemory(note, cwd); append([{ text: `✓ noted in ${shortCwd(path)}`, dim: true }]); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  /** Route one prompt: ! bash · # memory · /local-command · /catalog-or-prompt turn. Returns true iff it
   *  started a turn (whose finally re-drains the queue); false for non-turn ops (drainNext must re-drain). */
  function dispatch(prompt: string): boolean {
    if (prompt.startsWith("!")) { void runBashMode(prompt.slice(1).trim()); return false; }
    if (prompt.startsWith("#")) { void memoryMode(prompt.slice(1).trim()); return false; }
    const cmd = parseCommand(prompt);
    if (cmd) {
      if (LOCAL_NAMES.has(cmd.name)) { void handleCommand(cmd); return false; }   // local → engine switch
      // U1: a catalogued client-side control gets an honest message, never a prompt the model can't act
      // on. hasOwn, not `in`: a bare object's prototype chain would match "/toString" etc.
      if (Object.hasOwn(CLIENT_SIDE_NOTES, cmd.name)) { append([...userEchoLines(`/${cmd.name}${cmd.args ? " " + cmd.args : ""}`, { width: columnsFn() }), ...formatClientSide(cmd.name)]); return false; }
      if (catalogNames.current.has(cmd.name)) { runTurn(prompt); return true; }   // catalog → run "/name …" as a turn (probe 31)
      void handleCommand(cmd); return false;                                       // unknown → formatUnknown (switch default)
    }
    runTurn(prompt); return true;
  }
  // While a turn runs, regular prompts + catalog commands QUEUE (drained FIFO on turn end); local commands and
  // !/# run immediately (control-channel / local — safe mid-turn). Type-ahead while Claude works (CC parity).
  function submit(prompt: string) {
    if (disposed.current || !prompt.trim()) return;
    setSubmitCount((n) => n + 1);
    if (!busy) { dispatch(prompt); return; }
    if (prompt.startsWith("!") || prompt.startsWith("#")) { dispatch(prompt); return; }
    const cmd = parseCommand(prompt);
    if (cmd && LOCAL_NAMES.has(cmd.name)) { dispatch(prompt); return; }
    setQueue((q) => [...q, makeQueueEntry(prompt)]);                            // turn while busy → enqueue
  }
  /** CM51. The mode is DERIVED from the text's own prefix, the one derivation `composerMode` owns for the
   *  whole port — so a queued `!git status` re-enters the composer in bash mode when the drain hands it back
   *  (queue.ts's divergence 1). Nothing reaching this line today can be bash (`submit` dispatches `!`/`#`
   *  immediately, above), which is why the mapping is written out rather than hardcoded to `"prompt"`. */
  function makeQueueEntry(prompt: string): QueueEntry {
    return { value: prompt, mode: composerMode(prompt) === "bash" ? "bash" : "prompt", priority: "now", origin: "user" };
  }
  /** CM48's drain, the useChat half (`popAllEditable`, bundle L149093): hand EVERY editable entry back to the
   *  composer as one `\n`-joined block and clear them from the queue; a non-editable entry survives it. The
   *  composer merges the block above its live draft — see `queue.ts` and `ChatComposer`'s `queuePop` prop.
   *  Synchronous, and answers with a value rather than routing through `composerPrefill`: the Up keystroke
   *  has to know in the same tick whether the queue answered it, or it cannot decide to walk history. */
  function popQueueToComposer(): { text: string; pastedContents?: PastedMap } | null {
    if (disposed.current) return null;
    const q = queueRef.current;
    const popped = joinQueuedForComposer(q);
    if (!popped) return null;
    const kept = q.filter((e) => !isEditableQueueEntry(e));
    queueRef.current = kept; setQueue(kept);
    return popped;
  }
  // Answer the head entry via the remote feed; the dialog clears/advances on the SETTLED event (dropPending),
  // never optimistically here — a race (someone else answered first) still needs the settle to land.
  function resolveDecision(outcome: DecisionOutcome) {
    const entry = pendingRef.current;
    if (!entry || !hasDecisionFeed(session)) return;
    answeredIds.current.add(entry.toolUseID);
    void session.answerDecision(entry.toolUseID, outcome).then((r) => { if (r.alreadyAnsweredBy) notice(`answered by ${r.alreadyAnsweredBy}`); })
      .catch((e) => {
        // A designed-for rejection path (host death mid-dialog, or the 10s request deadline on a wedged
        // host) — never leave this unhandled (F1: it used to crash the whole REPL). Un-mark it as ours so
        // a LATER settle of the same entry (the park is still live host-side — never cleared here) still
        // renders correctly instead of being mistaken for our own already-applied answer.
        answeredIds.current.delete(entry.toolUseID);
        notice(`✗ answer failed: ${(e as Error).message}`);
      });
  }
  // The "already applied" knowledge lives HERE, not in a ref inside ChatComposer: the composer unmounts
  // whenever any popup arm takes over (shortcuts/rewind/bg-tasks/model/session picker, any decision
  // dialog), which resets a component-local dedup ref to its initial value while `composerPrefill` still
  // holds the already-consumed rewound prompt — so on remount the ref-guarded effect re-applies it,
  // resurrecting a stale prompt into the composer after the user already edited/submitted past it. A
  // prefill is applied at most once: the composer calls this the moment it applies the text, clearing the
  // state so no later remount (with a reset ref) can ever see a non-null prefill to re-apply.
  function clearPrefill() { if (!disposed.current) setComposerPrefill(null); }
  function openBgPanel() { if (!disposed.current) setBgPanelOpen(true); }
  function closeBgPanel() { if (!disposed.current) setBgPanelOpen(false); }
  function openShortcuts() { if (!disposed.current) setShortcutsOpen(true); }
  function closeShortcuts() { if (!disposed.current) setShortcutsOpen(false); }
  function openHistorySearch() { if (!disposed.current) setHistoryOpen(true); }
  function closeHistorySearch() { if (!disposed.current) setHistoryOpen(false); }
  // Esc/Tab (historySearch:accept): the chosen prompt lands in the composer via the same prefill seam the
  // rewind edit-and-resend uses — applied at most once, remount-safe. Its `pastedContents` rides along, so a
  // recalled `[Pasted text #1 +9 lines]` comes back as a live chip the composer can expand and the submit can
  // substitute, instead of a label that would be sent to the model as literal text.
  function acceptHistory(e: HistEntry) { if (disposed.current) return; setHistoryOpen(false); setComposerPrefill({ text: e.text, token: Date.now(), pastedContents: e.pastedContents }); }
  // …and the same payloads on the way OUT: `substituteChips` is what `submitTurn` (editor.ts) runs before
  // handing text to the model, so running it here keeps the picker's Enter and a typed Enter identical.
  // …and it RE-RECORDS the entry on the way out, which the composer's own submit path (`persistHistory`,
  // ChatComposer.tsx) does for every other route into `submit` — a typed prompt, an Esc-Esc'd draft, an
  // executed `/command`, the inline ctrl+r search (which re-enters `applyKey`, so it gets it for free).
  // Without it, re-running a year-old prompt left it a year old in the log and the next `/history` still
  // ranked it last (final review, P2). What is written is the DISPLAY plus its pastes — the chip labels the
  // user saw, not the substituted bodies that go to the model — because that is what a recall must bring
  // back, and it is exactly the entry shape the picker already handed us, only with a fresh timestamp.
  // `appendHistory` owns its own `CLAUDE_CODE_SKIP_PROMPT_HISTORY` gate and swallows every write failure.
  //
  // The IN-SESSION half of the same promotion — the composer's Up-arrow list — is ChatApp's, not this
  // hook's: that list lives in the app-scoped `editorStateRef` a composer instance reads at mount, and
  // useChat has no reach into it. See ChatApp's `onExecute` wrapper.
  function executeHistory(e: HistEntry) {
    if (disposed.current) return;
    setHistoryOpen(false);
    appendHistory({ display: e.text, pastedContents: e.pastedContents, project: cwd, sessionId: session.sessionId }, historyEnv);
    submit(substituteChips(e.text, e.pastedContents ?? {}));
  }
  /** F5 task 12: BOTH search surfaces read `history.jsonl` (`readHistory` = upstream's `UUd`, the very file
   *  upstream's own picker scans) instead of the persisted transcripts this used to reconstruct prompts from.
   *  The transcript source disagreed with the log on two things a prompt search must get right — a transcript
   *  row has already lost the `!` that makes a line bash mode, and it never carried `pastedContents` at all.
   *  The cost, recorded in Task 13: prompts submitted before F5 task 6 began writing the log are not in it.
   *
   *  Async because the overlay's `load` contract is (and a paged reader could still want to be); the read
   *  itself is synchronous — `readHistory` caps at 100 entries, which is tens of KiB. */
  async function loadHistory(scope: HistoryScope): Promise<HistEntry[]> {
    // `scope:"session"` needs a REAL id; before the first state event there is none, and the prompts written
    // in that window carry none either, so this matches exactly those sessionless lines (Task 13).
    const rows = readHistory({ scope, project: cwd, sessionId: session.sessionId }, historyEnv);
    return rows.map((r) => { const h = hydrateEntry(r, historyEnv); return { text: h.display, ts: r.timestamp, pastedContents: h.pastedContents }; });
  }
  function stopBgTask(id: string) { if (hasBgTasks(session)) void session.stopBgTask(id).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: role("error") }])); }
  // Ctrl-X Ctrl-K (CC chat:killAgents): double-press confirm within 3s, exactly the 2.1.220 flow —
  // "No background agents running" when idle, arm notice on the first press, stop-all on the second.
  function killAgents() {
    const tasks = bgTasksRef.current;
    if (tasks.length === 0) { notice("No background agents running"); return; }
    const now = Date.now();
    if (now - killArmAt.current <= 3000) {
      killArmAt.current = 0;
      for (const t of tasks) stopBgTask(t.task_id);
      notice(`◼ stopping ${tasks.length} background task${tasks.length === 1 ? "" : "s"}`);
      return;
    }
    killArmAt.current = now;
    notice("Press Ctrl-X Ctrl-K again to stop background agents");
  }
  function backgroundNow() {
    if (!hasBgTasks(session)) { notice("background unsupported on this session"); return; }
    void session.background().then((b) => { if (!b) notice("nothing to background"); }).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]));
  }
  // Apply a permission mode. `auto` is model-gated (probe 24): if the live model can't run auto, swap to a
  // supported one FIRST (verified to take effect at runtime) with a notice, then set the mode. Disposed-guarded
  // across each await — incl. a macrotask yield before setPermissionMode so a cycle fired right after unmount
  // (ink runs the disposed-sentinel cleanup one macrotask late) is caught and never mutates state post-unmount.
  async function applyMode(next: string) {
    if (disposed.current) return;
    if (next === "auto") {
      // Only ever switch a model we actually KNOW. When `model` is undefined (an `attach` client that has
      // not seen a turn end) the old code resolved it to DEFAULT_AUTO_MODEL and switched — downgrading a
      // session whose model the user deliberately chose. Say what we can't determine instead of guessing.
      if (model === undefined) notice("auto — can't check this client's model; if it doesn't support auto the engine falls back to default");
      else {
        const target = resolveAutoModel(model);
        if (model !== target) {
          await session.setModel(target).catch(() => {});
          if (disposed.current) return;
          setModel(target);
          append([{ text: `↻ auto — switched model to ${target} (${model} doesn't support auto)`, dim: true }]);
        }
      }
    }
    await new Promise<void>((r) => setTimeout(r, 0));
    if (disposed.current) return;
    await session.setPermissionMode(next).catch(() => {});
    if (!disposed.current) setMode(next);
  }
  function cycleMode() { void applyMode(ladderNext(mode)); }
  // Esc/Ctrl-C on a busy turn (ChatApp routes both here — a deliberate extension of upstream's Escape-only
  // wording): stop everything, DESTROY nothing. Any queued prompts are rescued back into the composer as a
  // "prepend" prefill (CM49) rather than dropped with the queue.
  function interrupt() {
    drainGen.current++;
    const q = queueRef.current;
    if (q.length) setComposerPrefill({ text: q.map((e) => e.value).join("\n"), token: Date.now(), mode: "prepend" });
    queueRef.current = [];
    setQueue([]);
    void session.interrupt().catch(() => {});
  }
  function clear() { if (!disposed.current) { clearScreen(); replaceDocument(new TranscriptDocument()); } }   // /clear: wipe screen + model (session context kept)

  return { state: { sessionId: session.sessionId, staticItems, pendingItems, streaming, pending, mode, busy, ctxPct, model, picker, tasks, bgTasks, bgRows: bgHarvest.current.rows(bgTasks), bgPanelOpen, thinkLevel, turnStartedAt, modelPicker, commandCatalog, queue, submitCount, hasMessages: documentRef.current!.messageCount > 0, staticEpoch, turnTokens, rewindPicker, composerPrefill, rewinding, usageWarn, shortcutsOpen, historyOpen, addDir, themeDialog, settings, outputStyle, permissions, denials, workDirs } as ChatState, detailItems, submit, popQueueToComposer, resolveDecision, cycleMode, interrupt, clear, closePicker, pickSession, closeModelPicker, pickModel, openModelPicker, notice, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, applyMode, setThink, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir };
}
