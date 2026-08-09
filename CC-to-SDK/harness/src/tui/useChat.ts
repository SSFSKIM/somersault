// tui/src/useChat.ts — owns the session (event-driven, Goal B task 7): the host event stream is the
// SINGLE rendering source (turn/message/decision/tasks_changed/task/state events all arrive via
// ChatSession & SessionEvents & DecisionFeed & BgTasks), `submit`/`resolveDecision` are command channels
// only. Owns the transcript, the streaming turn, the decision queue, mode switching (Tab ladder + host
// truth via state events), the bg-task panel, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import { useStdout } from "ink";
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
import { loadPrefs, savePrefs as realSavePrefs } from "./prefs.js";
import { isInterruptSentinelFrame, pickTurnVerb as realPickTurnVerb, turnDurationLine } from "./durationRow.js";
import { AUTO_MODE_DESCRIPTION, AUTO_MODE_NOTICE_DELAY_MS, shouldShowAutoModeNotice } from "./autoModeNotice.js";
import { hasAcceptedBypass } from "./bypassConsent.js";
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
import { LiveTurn, IDLE_METER, type SpinnerMeter } from "./liveTurn.js";
import { retryStatusFrom, provesApiAnswered, type RetryStatus } from "./retryStatus.js";
import { FoldPendingState } from "./foldPendingState.js";
import { ingestTaskFrame, stampAgentCalls, type AgentMeta } from "./agentProgress.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { BgMetaHarvest, type BgTaskRow } from "./bgTaskMeta.js";
import { createNotificationStore, type CcxNotification, type NotificationStore } from "./notifications.js";
import { EFFORT_HINT_KEY, EFFORT_HINT_TIMEOUT_MS, EFFORT_LEVELS, effortHint, isEffortLevel, type EffortLevel } from "./modelPickerModel.js";
import { parseCommand, canonicalCommand, formatModel, formatModelSet, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, CLIENT_SIDE_NOTES, formatClientSide, parseConfigArg, totalOutputTokens, type ParsedCommand, type InitialResume, type SessionUsage } from "./commands.js";
import { rewindFailureHeading } from "./rewindModel.js";
import { truncateAtAnchor } from "./rewindRebuild.js";
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
import { NARROWED_SCOPE, RESUME_CANCELLED, type ResumeScope } from "./sessionPickerModel.js";
import { hasWorktrees as realHasWorktrees } from "./worktrees.js";
import { clearViewport } from "./clearViewport.js";
import { DEFAULTS, summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel, resolveModelAlias, renameSession as realRenameSession, tagSession as realTagSession, getSessionInfo as realGetSessionInfo } from "../index.js";
import type { RawContextUsage, ListSessionsOpts } from "../index.js";
import { type HistEntry, type HistoryScope } from "./historySearch.js";
import { appendHistory, hydrateEntry, readHistory } from "./promptHistory.js";
import { substituteChips } from "./pasteChips.js";
import { isEditableQueueEntry, joinQueuedForComposer, type QueueEntry } from "./queue.js";
import { composerMode } from "./promptMode.js";
import { buildStatusLinePayload, createStatusLineDriver, runStatusLine as realRunStatusLine, type StatusLineConfig, type StatusLineDriver, type StatusLineDriverDeps, type StatusLineSnapshot, type StatusLineUsage } from "./statusLine.js";
import type { PastedMap } from "./editor.js";

// F1 Task 2 role map: every line useChat itself emits is themed — failures `error`, the `! command`
// echo `bashBorder`. Read per emission so a mid-session /theme change colors the next line correctly.
const role = (name: "error" | "bashBorder") => resolveThemeColor(themeTokens()[name]);
const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
/** Wave T Task 13: silence, in a live turn, after which the indicator says so (see the watchdog below). */
const STALL_MS = 10_000;

// ChatSession is promoted to ../session/chatSession.ts (spec A2b §2) so the lib Session and the remote
// adapter satisfy ONE interface; re-exported here so this package's other modules' imports keep working.
export type { ChatSession };
/** `cwd` is `SDKSessionInfo`'s own field — the directory the transcript belongs to, which the SDK fills from
 *  the row's `relocatedCwd`, its head `cwd`, or the project directory it was found under. It is what the
 *  picker's three actions scope themselves by once Ctrl+A has widened the list past this project (external
 *  review, finding 2). NB there is no `projectPath` on `SDKSessionInfo` — checked against the installed
 *  sdk.d.ts; `projectPath` is an SDK-internal name that never reaches this shape. */
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number; cwd?: string }
/** The Ctrl-O detail route (Task 5 wires the pager onto it): `useChat` owns `documentRef`, ChatApp sees only
 *  the returned state, so this closure is how a source-backed detail projection reaches the pager without
 *  anyone reaching into the document itself. */
export type DetailItems = (projection: "detail-all" | "detail-collapsed") => readonly RenderItem[];
export interface ChatState { sessionId?: string; staticItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: RenderLine[]; pending: PendingDecision | null; mode: string; busy: boolean; /** W-C T8 — the engine's ai-title, read from disk once after the first turn (probe (d)). */ aiTitle?: string; /** W-C T8 — a successful `/rename`, which outranks `aiTitle`. */ renameTitle?: string; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[]; hasWorktree: boolean }; tasks: TaskItem[]; bgTasks: BackgroundTaskInfo[]; bgRows: BgTaskRow[]; bgPanelOpen: boolean; thinkLevel: string; /** W-C T11 (EP-C6): the session's live effort level, and whether the live model has the axis at all (undefined = the catalog has not answered yet). */ effort?: EffortLevel; effortSupported?: boolean; /** What the picker's/dialog's `(default)` clause compares against — see `DEFAULT_EFFORT`. */ defaultEffort: EffortLevel; effortDialog: { open: boolean; level?: EffortLevel; levels?: readonly EffortLevel[]; supported?: boolean; modelName?: string }; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[]; current?: string; sessionModel?: string; activeModel?: string; outputTokens?: number; ackedAt?: number }; commandCatalog: CommandEntry[]; queue: QueueEntry[];
  /** The composer's placeholder ladder reads both (`placeholder.ts` rule 4 — upstream's `submitCount` /
   *  `hasMessages`): how many prompts THIS client has sent, and whether the transcript holds any
   *  conversation message at all (a resumed or attached session does before the user types anything). */
  submitCount: number; hasMessages: boolean;
  staticEpoch: number; turnMeter: SpinnerMeter; rewindPicker: { open: boolean; anchors: RewindAnchor[] }; composerPrefill: { text: string; token: number; mode?: "replace" | "prepend"; pastedContents?: PastedMap } | null; rewinding: boolean; usageWarn?: string; shortcutsOpen: boolean; helpOpen: boolean; historyOpen: boolean; addDir: { open: boolean; prefill?: string }; themeDialog: { open: boolean }; bypassConsent: { open: boolean }; settings: { open: boolean; tab?: string }; outputStyle: string; showTurnDuration: boolean; permissions: { open: boolean; tab?: string }; denials: DenialEntry[];
  /** The session's working directories — the cwd plus every `/add-dir` grant (`listDirs()`). The FILE
   *  permission dialog's in-directory test runs over this set; nothing else reads it. */
  workDirs: readonly string[];
  /** Wave T Task 12: the live turn's API-retry state, driven by the SDK's `system/api_retry` frames. Set
   *  means the API is not answering; the row that replaces the spinner while it is set is Task 13's. */
  retryStatus?: RetryStatus;
  /** W-S7 (Wave S task 11): a compaction pass is in flight. EPHEMERAL render state — upstream discards its
   *  spinner, hint and bar together at compact_end (`a()`, L407334) and persists only the `Compacted …`
   *  message, so this is deliberately NOT a transcript row. `startedAt` is the only thing the bar has to
   *  work with: the SDK reports no compaction progress, so the bar is a wall-clock curve (compactionBar.ts). */
  compacting?: { startedAt: number };
  /** Wave C Task 1/2 (EP-C1a): the notification queue's `current`, mirrored out of the store so the tree
   *  repaints on it like every other live field (the repo has no `useSyncExternalStore` idiom). The store
   *  itself is the seam producers write through — `notify`/`dismissNotification` below. */
  notification: CcxNotification | null;
  /** WAVE C TASK 10 (EP-C2b): the statusLine script's last SUCCESSFUL output, ANSI and all (`Footer.tsx`
   *  does the dim-forcing). Undefined until the first run lands, and it never returns to undefined — a
   *  failing run resolves `undefined` and the driver simply does not call back, so the row goes quietly
   *  stale instead of blanking (statusLine.ts's header rule). */
  statusLineText?: string; }

// Tab cycles these; bypassPermissions stays off-cycle (/yolo). Single source with settingsRows.ts's own
// permissionMode row (review finding 3) — importing it here instead of a second literal array means the
// Tab ladder and the /config cycle order can never independently drift.
const LADDER = PERMISSION_MODE_OPTIONS;
/** Next mode on the Tab ladder; any off-ladder mode (e.g. bypassPermissions/dontAsk) re-enters at "default". */
function ladderNext(mode: string): string { const i = LADDER.indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  opts: { initialMode?: string; initialModel?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string; /** W-C T11: the launch effort (`--effort` ?? DEFAULTS.effort), so the §C6.2 hint can post at mount. */ initialEffort?: string; initialOutputStyle?: string; initialShowTurnDuration?: boolean; initialEntries?: readonly TranscriptBootstrapEntry[]; initialPrompt?: string; onExit?: () => void; detach?: () => void; clearStaticTranscript?: () => void; noticeBridge?: { bind(push: (text: string) => void): void };
    /** WAVE C TASK 10: the resolved `statusLine` setting, or undefined for "not configured". RESOLVED BY THE
     *  CALLER (`chatMain.tsx`, exactly as `initialOutputStyle` is seeded from `loadPrefs()`), and for a
     *  reason beyond symmetry: canon L154558 honours only the USER settings file, so resolving it here would
     *  mean every test that mounts this hook reading — and running the command out of — the developer's real
     *  `~/.claude/settings.json`. One production call site owns that read; nothing below ever touches disk. */
    statusLine?: StatusLineConfig } = {},
  // `home`/`platform` are injectable for the same reason `now`/`columns` are: the frame-capture fixture has
  // to pin the whole ProjectionContext, and `homedir()`/`process.platform` read live from the host — which
  // made a golden comparison depend on who ran it (a `/Users/…` home leaking into a `~`-shortened path) and
  // on the runner's OS (the active leader glyph is `⏺` on darwin and `●` everywhere else).
  deps: { now?: () => number; columns?: () => number; home?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; scheduleRepaint?: (cb: () => void, ms: number) => () => void; listSessions?: (scope?: ResumeScope) => Promise<SessionInfo[]>; readSessions?: (opts: ListSessionsOpts) => Promise<SessionInfo[]>; hasWorktrees?: (cwd: string) => Promise<boolean>; getSessionMessages?: (id: string, dir?: string) => Promise<any[]>; runBash?: (cmd: string, cwd: string) => Promise<BashResult>; appendMemory?: (note: string, cwd: string) => string; clearScreen?: () => void; clearViewport?: () => void; copyText?: (t: string) => Promise<void>; writeFile?: (path: string, text: string) => void; readFile?: (path: string) => string | null; renameSession?: (id: string, title: string, dir?: string) => Promise<void>; tagSession?: (id: string, tag: string | null) => Promise<void>; getSessionInfo?: (id: string) => Promise<any>; settingsFileDeps?: SettingsFileDeps; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; openEditor?: (file: string, prepare: () => void) => "no-editor" | "opened" | "failed"; rewindReplayRetry?: { attempts: number; delayMs: number };
    /** Wave C Task 1/2: the notification queue. Injected so a test can drive its timers synthetically. */
    notifications?: NotificationStore;
    /** Wave C Task 7: the duration row's verb. Upstream picks it uniformly at random (`SvH`), which would
     *  make every expected string in a test a regex — so the pick is a seam, exactly like `now`. */
    pickTurnVerb?: () => string;
    /** WAVE C TASK 10: the statusLine driver's own seams — a fake runner (so a test never forks a shell) and
     *  the two timers its 300 ms debounce and its `refreshInterval` poll run on. Supplying `runStatusLine`
     *  REPLACES the wrapper below that carries cwd/env/COLUMNS/LINES, which is the point: the wrapper is the
     *  only thing between this hook and a real child process. */
    statusLine?: StatusLineDriverDeps } = {},
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
  // Wave T Task 12: the live turn's retry state. The REF is what the hot path reads — the message arm runs
  // per stream_event delta (thousands per turn), and an unguarded `setRetryStatus(undefined)` there would
  // queue a setState per token; the ref lets the clear cost one comparison when there is nothing to clear.
  const [retryStatus, setRetryStatus] = useState<RetryStatus | undefined>(undefined);
  const retryRef = useRef<RetryStatus | undefined>(undefined);
  const clearRetry = () => { if (retryRef.current) { retryRef.current = undefined; setRetryStatus(undefined); } };
  // W-S7 (Wave S task 11): the compaction busy state, ref-mirrored for exactly the reason `retryRef` is —
  // its clear runs from the message arm and from turn end, both of which are hot, and an unguarded setState
  // there would queue one per frame. Two writers, because compaction reaches this client TWO ways and only
  // one of them is a wire path:
  //   · AUTOMATIC mid-turn compaction flows through `submit` → `runTask` → `message` events, so its
  //     `system/status status:"compacting"` frame arrives in the system-frame arm below and its
  //     `compact_boundary` frame ends it there too.
  //   · A TYPED `/compact` never reaches the wire at all: `session.compact()` installs its OWN private
  //     onMessage (session.ts:146-153) that swallows the status and boundary frames, the host's compact op
  //     calls it directly rather than through `runTask` (host.ts:329), and the host's always-on frame tap
  //     (host.ts:505-535) emits only for background_tasks_changed, the task_* family and a `status` frame
  //     carrying a permissionMode string — a bare `status:"compacting"` matches no branch. So the `/compact`
  //     arm sets and clears this state LOCALLY, where the client already knows a compaction started because
  //     it started it. Routing those frames out of the host is a wire change this P2 does not justify.
  const [compacting, setCompacting] = useState<{ startedAt: number } | undefined>(undefined);
  const compactingRef = useRef<{ startedAt: number } | undefined>(undefined);
  const startCompacting = () => { const c = { startedAt: nowFn() }; compactingRef.current = c; setCompacting(c); };
  const clearCompacting = () => { if (compactingRef.current) { compactingRef.current = undefined; setCompacting(undefined); } };
  // Wave T Task 13: the STALLED watchdog — the half of the outage surface no frame can announce. Probe 96
  // measured ~75 s of silence on a blackholed endpoint BEFORE the first api_retry frame exists (vs ~20 ms on
  // a refused one), so without this the first 75 s of a real outage still look like a healthy turn.
  // ANCHORED TO TURN START, NOT TO A ROLLING GAP: armed once when the turn begins, retired for good by the
  // first frame that proves the API answered, never re-armed. Canon's `Ss` (L358804-22) can afford a rolling
  // gap because it measures silence INSIDE the fetch (`mr.lastAt` is the last stream chunk), so local work
  // never trips it; out here a gap between frames is indistinguishable from a `Bash(npm test)` that is simply
  // running — and the only mid-tool keepalive on our wire (`tool_progress`, 30 s) is three times this
  // threshold, so a rolling gap would tell someone to check their network while their test suite ran, and
  // oscillate while it did. Threshold 10 s: canon's `SWs` is 20 s measured from inside the fetch, ours is
  // measured from the turn clock and has no earlier evidence to wait for. A guess never outranks a real
  // api_retry frame (the `retryRef` check) — an api_retry frame is evidence of FAILURE, not of health, so it
  // does NOT retire the watchdog, and probe 96's ladder delays run to 39 s, longer than this timer.
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarmStall = () => { if (stallTimer.current) { clearTimeout(stallTimer.current); stallTimer.current = null; } };
  const armStall = () => {
    disarmStall();
    stallTimer.current = setTimeout(() => {
      stallTimer.current = null;
      if (retryRef.current) return;                                            // already saying something truer — a guess never downgrades a true signal
      const stalled: RetryStatus = { kind: "stalled" };
      retryRef.current = stalled; setRetryStatus(stalled);
    }, STALL_MS);
    stallTimer.current.unref?.();
  };
  useEffect(() => () => disarmStall(), []);
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
  // WAVE C TASK 8 (EP-C4a) — the two title rungs the terminal title reads (ChatApp owns the writer; these
  // are the only state it needs). They are SEPARATE because they have different lifetimes and different
  // owners: `aiTitle` is fetched from disk exactly once, `renameTitle` is published by a user action and
  // outranks it forever after (see terminalTitle.ts's recorded skip on `terminalTitleFromRename`).
  const [aiTitle, setAiTitle] = useState<string | undefined>(undefined);
  const [renameTitle, setRenameTitle] = useState<string | undefined>(undefined);
  // Probe (d): the engine writes an `ai-title` row into the session JSONL DURING the first turn, and the SDK
  // surfaces it as `getSessionInfo().customTitle ?? .summary`. It is a DISK READ, not a wire event, so it has
  // to be fetched — and fetched once: the engine writes one title per session and never refreshes it as the
  // topic drifts, so a per-turn re-read would be a file open per turn for a value that cannot have changed.
  const aiTitleFetched = useRef(false);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [usageWarn, setUsageWarn] = useState<string | undefined>(undefined);
  // Seeded from the launch config, NOT left undefined until the first turn ends: the Tab ladder's `auto`
  // rung consults this to decide whether the live model supports auto, and an unknown model there used to
  // resolve to the DEFAULT and silently downgrade a `--model opus` session to sonnet before the user had
  // typed anything. Stays undefined for `ccx attach` (that client never saw the host's launch config).
  const [model, setModel] = useState<string | undefined>(opts.initialModel);
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
  // ── WAVE C TASK 11 (EP-C6): THE EFFORT AXIS. Three pieces of state, and the reason there are three is
  // that "what is the level" and "does this model have the axis at all" are answered by different sources at
  // different times.
  //   `effort` is seeded from the launch config the same way `model` is, and for the same reason: the hint
  // has to be able to say `● xhigh · /effort` at mount, before any turn or any catalog fetch. Undefined on
  // `ccx attach`, which never saw a launch config — and undefined is exactly "no hint, no picker row", which
  // is the honest answer for a client that does not know.
  const [effort, setEffortState] = useState<EffortLevel | undefined>(
    isEffortLevel(opts.initialEffort) ? opts.initialEffort : undefined);
  //   The catalog's effort capability per model, harvested from the ONE `capabilities()` call the command
  // palette already makes. Keyed by BOTH the catalog's tier alias (`opus`) and its resolved id
  // (`claude-opus-5`), because `model` here is resolved and the rows are aliases — the same two-sided match
  // `openModelPicker` does inline. State and not a ref: the hint's effect has to re-run when it lands.
  const [effortCaps, setEffortCaps] = useState<ReadonlyMap<string, { supportsEffort?: boolean; levels?: EffortLevel[] }>>(new Map());
  const effortCap = model ? effortCaps.get(model) : undefined;
  //   Tri-state ON PURPOSE. `false` only once the catalog has SAID so; `undefined` means "not known yet",
  //   which every consumer treats as "assume it has one".
  //   DIVERGENCE: upstream answers this synchronously — `Fk(model)` (L76243) is a local model registry, so a
  // model without an effort axis never shows the hint for even one frame. ccx has no such registry; the only
  // authority is `capabilities().models[].supportsEffort`, which arrives one round-trip after mount. So on an
  // effort-less model ccx posts the hint optimistically and WITHDRAWS it when the catalog lands, where
  // upstream would never have posted it. Withdrawing is the honest half of the trade; the alternative —
  // suppressing the hint until the catalog answers — would delay it on every session to spare a flicker on
  // the rare one, and would show nothing at all if the fetch failed.
  const effortSupported: boolean | undefined = effortCap === undefined ? undefined : effortCap.supportsEffort !== false;
  const effortLevels: readonly EffortLevel[] = effortCap?.levels ?? EFFORT_LEVELS;
  /** DIVERGENCE: upstream's `(default)` clause compares the level against the MODEL's default — `I5t`, off
   *  its own per-model registry (`_5(model, value)` falls back to `high`, L76470). The SDK catalog exposes
   *  `supportsEffort`/`supportedEffortLevels` and no default at all, so ccx compares against its own
   *  harness-wide launch default instead (`DEFAULTS.effort`, currently `xhigh`). Same clause, same place,
   *  one default for every model rather than one per model — and inventing a per-model table to match
   *  upstream's shape would be a table nothing could keep true.
   *  A CONSTANT, not state: it is the default for NEW sessions, which nothing in a running session moves. */
  const DEFAULT_EFFORT = DEFAULTS.effort as EffortLevel;
  /** The `/effort` dialog. Snapshotted at open time exactly as `modelPicker` is, so ChatApp reads state only. */
  const [effortDialog, setEffortDialog] = useState<{ open: boolean; level?: EffortLevel; levels?: readonly EffortLevel[]; supported?: boolean; modelName?: string }>({ open: false });
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[]; hasWorktree: boolean }>({ open: false, sessions: [], hasWorktree: false });
  // F6 T11: `current` is the row the picker opens on and marks as the value in force (the catalog VALUE, not
  // the resolved id — `openModelPicker` maps between them); `sessionModel` is set only by the `s` path and is
  // the sole thing that renders the picker's third header line.
  const [modelPicker, setModelPicker] = useState<{ open: boolean; models: ModelInfo[]; current?: string; sessionModel?: string; activeModel?: string; outputTokens?: number; ackedAt?: number }>({ open: false, models: [] });
  const sessionModelRef = useRef<string | undefined>(undefined);
  /** WAVE S T12 (EP-S8): the cumulative output count at which the model-switch cache warning was last
   *  ACCEPTED. It lives here and not in `ModelPicker` for a structural reason — the picker unmounts on every
   *  pick, so an ack it owned would be forgotten the instant it was given, and "not asked again until the
   *  model has produced more output" would be unimplementable. `openModelPicker` threads it in as a prop and
   *  `pickModel` stamps it back, on an ACCEPTED pick only. */
  const cacheMissAckedAtOutputTokens = useRef<number | undefined>(undefined);
  /** WAVE S T12: compaction RE-STAMPS the ack rather than resetting it, which is upstream's own rule —
   *  `$$e` (L232096-232112) is fired at every conversation boundary, and the compaction ones (L232164,
   *  L308436) keep the session and its growing output count. The reasoning is the warning's own: the prompt
   *  cache is already gone after a compaction, so switching models right then costs nothing extra and there
   *  is nothing to warn about. (`/clear`, resume and rewind reach the same net effect by RESET, in
   *  `replaceDocument` — a fresh conversation counts from zero and warns correctly.)
   *  FAILURE-TOLERANT: an unreadable `usage()` leaves the ack exactly as it was. Stamping a guessed count
   *  would either silence a real warning or raise a spurious one, and both are worse than the status quo. */
  async function stampAckAfterCompaction(): Promise<void> {
    const u = await session.usage().catch(() => undefined);
    if (disposed.current || u === undefined) return;
    cacheMissAckedAtOutputTokens.current = totalOutputTokens(u as SessionUsage);
  }
  const [rewindPicker, setRewindPicker] = useState<{ open: boolean; anchors: RewindAnchor[] }>({ open: false, anchors: [] });
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; token: number; mode?: "replace" | "prepend"; pastedContents?: PastedMap } | null>(null);
  const [rewinding, setRewinding] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);   // the `?` help overlay (pure display)
  const [helpOpen, setHelpOpen] = useState(false);             // F6 T14: /help's tabbed dialog (the same grid, plus the catalog)
  const [historyOpen, setHistoryOpen] = useState(false);       // the Ctrl-R history-search overlay
  const [addDir, setAddDir] = useState<{ open: boolean; prefill?: string }>({ open: false });   // W3 T3: /add-dir overlay
  const [themeDialog, setThemeDialog] = useState<{ open: boolean }>({ open: false });   // W3 T4: /theme overlay
  const [bypassConsent, setBypassConsent] = useState<{ open: boolean }>({ open: false });   // Wave-T T15: /yolo's consent gate
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
  // ── WAVE C TASK 1/2 (EP-C1a): THE ONE NOTIFICATION STORE. It lives here, not in a component, for the
  // lifetime reason `searchHintFiredRef` and the typing debounce already live here: the composer is
  // unmounted by every dialog, so a queue it owned would drop its pending entries — and its timers — every
  // time a permission prompt opened. `deps.notifications` is the injection seam (plan constraint 15: a unit
  // test hands in a store built on a synthetic scheduler); the default is a real one, created ONCE.
  const notificationsRef = useRef<NotificationStore | null>(null);
  if (notificationsRef.current === null) notificationsRef.current = deps.notifications ?? createNotificationStore();
  const notifications = notificationsRef.current;
  const [notification, setNotification] = useState<CcxNotification | null>(() => notifications.state().current);
  // The store fires synchronously after every change, including from inside its own timer. Mirroring on
  // subscribe (rather than reading during render) is what makes an EXPIRY repaint: nothing else re-renders.
  useEffect(() => notifications.subscribe(() => { if (!disposed.current) setNotification(notifications.state().current); }), [notifications]);
  const notify = (n: CcxNotification) => { notifications.add(n); };
  const dismissNotification = (key: string) => { notifications.remove(key); };
  // ── WAVE C TASK 11 (EP-C6), §C6.2: THE DECAYING EFFORT HINT. Transcribed from L496126-134, whose shape is
  // the whole point of this effect:
  //     useEffect(() => { if (!tue) { hp("effort-level"); return; }
  //                       hp("effort-level"); Nd({key:"effort-level", …, timeoutMs:1e4}); }, [tue, Nd, hp]);
  // REMOVE-THEN-ADD, on the producer side, every time. That is what restarts the ten seconds on a change —
  // upstream's store DEDUPS a same-key re-add outright (notifications.ts divergence 4 records that ours
  // replaces-and-restarts instead, deliberately as a superset), so the dance is upstream's own way of making
  // a repeated `/effort` re-display. Doing it here means ccx behaves identically on either store.
  //   The `!tue` arm is the two absences folded into one: no level at all (`ccx attach`), or a model whose
  // catalog row says it has no effort axis. Both mean "remove and post nothing".
  useEffect(() => {
    notifications.remove(EFFORT_HINT_KEY);
    if (!effort || effortSupported === false) return;
    notifications.add({ key: EFFORT_HINT_KEY, text: effortHint(effort), priority: "high", timeoutMs: EFFORT_HINT_TIMEOUT_MS });
  }, [effort, effortSupported, notifications]);
  // Wave C Task 6: the spinner reads a METER, not a token count — the parenthetical needs the streamed
  // character target (for the eased estimate), the stream mode (for the arrow) and the tool/thinking
  // windows (for the phase ladder). All four come off the one `LiveTurn` that already consumes the frames.
  const [turnMeter, setTurnMeter] = useState<SpinnerMeter>(IDLE_METER);
  // Prompts/turns submitted while busy; drained FIFO on turn end, or ALL AT ONCE back into the composer on
  // Up/ctrl+p (F5 task 8, CM48). `QueueEntry` (queue.ts) is upstream's own record shape — the raw text with
  // its prefix, the mode that text implies, the priority rung, and the paste map an entry was composed with.
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef<QueueEntry[]>([]); queueRef.current = queue;
  const [submitCount, setSubmitCount] = useState(0);   // upstream's `submitCount` — the placeholder ladder's rule 4
  const drainGen = useRef(0);                          // bumped by interrupt → invalidates any scheduled drain (no post-interrupt dispatch)
  const [staticEpoch, setStaticEpoch] = useState(0);  // bumped at a terminal boundary → mounts a FRESH append-only <Static>
  const disposed = useRef(false);
  // Wave S T10: the reader takes the picker's SCOPE now. Both axes are real `listSessions` options — dropping
  // `cwd` widens past this project, `includeWorktrees` widens past this checkout. The flag is passed
  // explicitly even when false because the SDK's own default is `true`: upstream STARTS narrowed on both axes
  // (that is what makes its opening footer offer to widen), and inheriting the SDK default would start us
  // half-widened with a footer offering a widening that had already happened.
  // TWO SEAMS, deliberately. `deps.listSessions` replaces the whole scope-aware loader (what most tests want);
  // `deps.readSessions` replaces only the READER underneath it, which is the only way to assert that the
  // mapping itself is right — an inverted mapping is invisible to a test that stubs the loader wholesale
  // (t10 review, finding 1: the inversion passed 4561 tests).
  const readSessions = deps.readSessions ?? ((o: ListSessionsOpts) => realListSessions(o) as Promise<SessionInfo[]>);
  const listSessions = deps.listSessions ?? ((scope: ResumeScope = NARROWED_SCOPE) =>
    readSessions({ ...(scope.allProjects ? {} : { cwd: opts.cwd }), includeWorktrees: scope.allWorktrees, limit: 30 }));
  const hasWorktreesFn = deps.hasWorktrees ?? ((dir: string) => realHasWorktrees(dir));
  // `dir` is the DIRECTORY THAT SESSION BELONGS TO, and it exists for one caller: the /resume picker after
  // Ctrl+A has widened the list past this project (external review, finding 2). Absent — which is every
  // caller that reads the CURRENT conversation, `/continue` included — it falls back to `opts.cwd`, so those
  // paths issue byte-identical reads to the ones they issued before.
  const getSessionMessages = deps.getSessionMessages ?? ((id: string, dir?: string) => realGetSessionMessages(id, { cwd: dir ?? opts.cwd }) as Promise<any[]>);
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
  // ── Wave C Task 7 (EP-C4d): the end-of-turn duration row ─────────────────────────────────────────────
  // SEEDED BY THE CALLER, not read here — `initialOutputStyle`'s exact pattern (W3 T5) and for its exact
  // reason: `chatMain` loads the prefs file once, before the first render, and this hook stays a pure
  // function of what it is handed. A `loadPrefs()` inside the hook would make every keyless test in
  // `test/tui/` read the developer's own `~/.claude/ccx/prefs.json` and answer differently on two machines.
  // Held in state from mount on: the /config row toggles this and writes the file behind it.
  const [showTurnDuration, setShowTurnDurationState] = useState<boolean>(opts.initialShowTurnDuration ?? true);
  const showTurnDurationRef = useRef(showTurnDuration); showTurnDurationRef.current = showTurnDuration;   // read inside the event effect, which never re-subscribes on a pref flip
  const pickTurnVerb = deps.pickTurnVerb ?? realPickTurnVerb;
  // The turn's own wall clock, and its disqualifier. Both are REFS, not state: they are written and read
  // inside the `onSessionEvent` closure, which is created once per session — a state read there would be one
  // render stale, and `turnStartedAt` (the spinner's clock) is already exactly that shape for that reason.
  // `undefined` start = no turn is being clocked, which is what the bare-truncated idle follow tail leaves.
  const turnStartRef = useRef<number | undefined>(undefined);
  const turnDisqualifiedRef = useRef(false);
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
  const renameSessionFn = deps.renameSession ?? ((id: string, t: string, dir?: string) => realRenameSession(id, t, { cwd: dir ?? opts.cwd }));
  const tagSessionFn = deps.tagSession ?? ((id: string, t: string | null) => realTagSession(id, t, { cwd: opts.cwd }));
  const getSessionInfoFn = deps.getSessionInfo ?? ((id: string) => realGetSessionInfo(id, { cwd: opts.cwd }));
  /** WAVE C TASK 8 — the once-per-session read of the engine's ai-title, called from the first `turn:end`.
   *  Silent on failure by design: an unreadable session file must cost the terminal title nothing (and must
   *  certainly not become a transcript notice), so the tab simply keeps whatever it already said. The
   *  `fetched` latch is set BEFORE the await so two turn ends racing on the same tick cannot both read.
   *
   *  `sessionId` is a PARAMETER because `resumeInto`'s caller has the new id and this closure does not: inside
   *  that function `session` is still the object being swapped out, so an un-parameterized call there would
   *  read the title of the conversation we just left. */
  const adoptAiTitle = (sessionId?: string): void => {
    const id = sessionId ?? session.sessionId;
    if (aiTitleFetched.current || !id) return;
    aiTitleFetched.current = true;
    void getSessionInfoFn(id).then(
      (info) => { if (disposed.current) return; const t = (info as any)?.customTitle ?? (info as any)?.summary; if (typeof t === "string" && t.trim()) setAiTitle(t.trim()); },
      () => {},
    );
  };
  const lastAssistant = useRef("");    // the last assistant reply's text, for /copy
  // THE REWIND WIPE: screen AND scrollback (`ESC[2J ESC[3J ESC[H`) — upstream's `Rms()`, bundle L176982. It is
  // deliberately harsher than `/clear`'s (next line), and only rewind may use it: a rewind TRUNCATES the
  // conversation, and Ink's app.clear() cannot reach rows that have already scrolled out of the viewport, so
  // without `ESC[3J` the discarded turns stay readable above the rebuilt transcript (see rebuildAfterRewind).
  const clearScreen = deps.clearScreen ?? (() => { try { if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); } catch { /* no tty */ } });
  // THE `/clear` RESET: viewport only, plus the repaint Ink's dedupe would otherwise swallow. Upstream's
  // INLINE clear arm (`yJr`, L176988) is the one being cloned here — L177120-177121 picks it over `Rms()`
  // whenever the alt screen is not in use, and it preserves scrollback because a cleared session stays on
  // disk and its transcript stays scrollable. Both halves and their citations live in clearViewport.ts.
  const inkStdout = useStdout();
  const clearViewportFn = deps.clearViewport ?? (() => { clearViewport(inkStdout); });

  // ── WAVE C TASK 10 (EP-C2b): THE STATUS LINE. Task 9 built the three pure objects (resolve / run / drive);
  // this is the mount site they were shaped for, and it DECIDES NOTHING — the cadence lives in
  // `createStatusLineDriver`, the payload in `buildStatusLinePayload`, the render in `Footer.tsx`. All that is
  // here is the wiring: which ccx value answers which payload field, and which ccx event is which upstream
  // delta. §C2.4's four triggers land as: (1) `mountRun` below, (2) the delta effect below, (3) UNREACHABLE —
  // ccx resolves the setting once at launch and never re-reads it, so the command cannot change under a live
  // session — and (4) the `refreshInterval` poll, which the driver arms for itself.
  //
  // NO ERROR BOUNDARY HERE, DELIBERATELY. `runStatusLine` never rejects, and the driver already swallows a
  // throwing `buildPayload` and a throwing `onText` into its debug seam (statusLine.ts's `execute`). A second
  // try/catch around either would only hide which layer failed from the one log line that reports it.
  const [statusLineText, setStatusLineText] = useState<string | undefined>(undefined);
  /** The last readings the payload needs, kept as REFS and not state: they are written by the same two
   *  fire-and-forget refreshers that already run at every turn end, and re-rendering the whole tree because a
   *  cost total moved by a cent is a cost the status line does not have to impose. The run that reads them is
   *  scheduled by an explicit poke on the same line, so nothing goes stale for want of a render. */
  const statusCtxRef = useRef<{ totalTokens?: number; maxTokens?: number } | undefined>(undefined);
  const statusUsageRef = useRef<StatusLineUsage | undefined>(undefined);
  /** model id → the catalog's display name, harvested from the ONE `capabilities()` call the command palette
   *  already makes (below). Without it `display_name` could only repeat the id; with it the payload carries
   *  what a status line actually wants to print. Empty until that fetch lands, and empty forever if it fails. */
  const modelNamesRef = useRef<Map<string, string>>(new Map());
  const statusDriverRef = useRef<StatusLineDriver | null>(null);
  const pokeStatusLine = (reason: string): void => { statusDriverRef.current?.poke(reason); };
  /** ccx state → the snapshot the payload builder reshapes. Rebuilt per RUN (the driver calls it inside
   *  `execute`), so a run always carries the state at its own moment. */
  function statusSnapshot(): StatusLineSnapshot {
    return {
      sessionId: session.sessionId,
      // The same two rungs the terminal title reads (W-C T8): a `/rename` outranks the engine's ai-title.
      sessionName: renameTitle ?? aiTitle,
      cwd,
      projectDir: cwd,
      // `current_dir` carries the cwd itself, so `added_dirs` is the /add-dir GRANTS alone — `workDirs`
      // seeds itself with `[cwd]`, and reporting it twice would make every session look like it had one.
      addedDirs: workDirs.filter((d) => d !== cwd),
      model,
      modelDisplayName: model ? modelNamesRef.current.get(model) : undefined,
      outputStyle,
      // ccx's think ladder has an explicit `off` rung and five live ones; upstream's `thinking.enabled` is
      // `f !== !1`, the same two-valued question asked of a richer setting.
      thinkingEnabled: thinkLevel !== "off",
      // W-C T11: upstream's `...Fk(y) && { effort: … }` guard, expressed as an absence. A model the catalog
      // has SAID has no effort axis reports no block at all — same rule the hint follows one screen up, so
      // the row a script prints and the hint the user sees can never disagree.
      ...(effort && effortSupported !== false ? { effort } : {}),
      context: statusCtxRef.current,
      usage: statusUsageRef.current,
    };
  }
  const statusSnapshotRef = useRef(statusSnapshot); statusSnapshotRef.current = statusSnapshot;
  useEffect(() => {
    const cfg = opts.statusLine;
    if (!cfg) return;
    // THE ONLY PLACE A CHILD PROCESS CAN BE BORN. `RunStatusLineDeps`' real runtime inputs (§C2.5) are bound
    // here because they are the mount site's to know: the session cwd, the parent env the SDK itself was
    // given, and the LIVE terminal size — read per run, not at mount, so a resized pane reaches the script.
    const run = deps.statusLine?.runStatusLine
      ?? ((c, payload, d) => realRunStatusLine(c, payload, { ...d, cwd, fallbackCwd: process.cwd(), env: deps.env ?? process.env, projectDir: cwd, columns: columnsFn(), lines: inkStdout.stdout?.rows ?? 24 }));
    const driver = createStatusLineDriver(cfg,
      () => JSON.stringify(buildStatusLinePayload(statusSnapshotRef.current())),
      (text) => { if (!disposed.current) setStatusLineText(text); },
      { ...deps.statusLine, runStatusLine: run });
    statusDriverRef.current = driver;
    driver.mountRun();                                    // §C2.4 trigger 1: immediate and UNDEBOUNCED
    return () => { driver.dispose(); statusDriverRef.current = null; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // §C2.4 trigger 2, as upstream states it: ONE effect over the delta list (`L484891`), not a poke wired into
  // each setter. Same reason upstream chose it — `mode` alone has three writers (Shift+Tab, `/config`, the
  // host's own `state` frame) and a per-setter poke would have to be remembered at each of them forever.
  // First render is skipped (`W.current`), because `mountRun` above already covers it.
  //   THE LIST IS UPSTREAM'S, MINUS WHAT CCX HAS NO PRODUCER FOR: `vimMode`, `fastMode` and `prStatus` do not
  // exist here, and `effortValue` arrives with TASK 11 (its payload block does too). `tokenUsage` and
  // `lastAssistantMessageId` are not React state in ccx at all — they are the two refresher refs above, which
  // poke explicitly from their own completion. `outputStyle`/`session_name` are ccx additions to the list:
  // both are payload fields here, and both can change with no turn in sight.
  const statusFirstRender = useRef(true);
  useEffect(() => {
    if (statusFirstRender.current) { statusFirstRender.current = false; return; }
    pokeStatusLine("state-delta");
    // W-C T11: `effort` IS upstream's `effortValue` delta, and `effortSupported` rides with it because the
    // catalog landing is the moment the block appears or disappears from the payload.
  }, [mode, model, thinkLevel, outputStyle, renameTitle, aiTitle, effort, effortSupported]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ranInitial = useRef(false);
  const ranInitialPrompt = useRef(false);
  // Set for the whole window in which THIS client's own rewind is in flight, so the host's `rewound`
  // broadcast — which every follower receives, the confirming client included — does not trigger a
  // second rebuild on top of confirmRewind's own. A boolean, not the anchor uuid: nothing on the wire is
  // needed to answer "was this mine", and the window is bounded by the same try/finally that owns
  // `rewinding`.
  const selfRewind = useRef(false);

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
   *  mount a fresh one and reconcile the new document from scratch.
   *
   *  W-S5 — and the reason the measured context percentage is dropped HERE rather than at the three call
   *  sites that discard the conversation (`clear`, `resumeInto`'s real-session swap, `rebuildAfterRewind`):
   *  this function IS the "the conversation on screen is no longer the one that was measured" boundary, so a
   *  fourth path that discards it inherits the reset by construction instead of having to remember. Two
   *  consequences worth naming. A code-only rewind never reaches here (confirmRewind returns before the
   *  rebuild, and the host emits no `rewound` broadcast for scope "code"), which is right — it changes no
   *  conversation state, so its measurement still describes what is on screen; and neither does resuming the
   *  SAME session into itself, which appends to the existing document rather than replacing it, for the same
   *  reason. `/status` reads the same `ctxPct`, so it is fixed by this one reset too. The one path that drops
   *  the number WITHOUT coming through here is `/compact` (see its case below): it keeps the conversation and
   *  shrinks it, which is a stale measurement rather than a misattributed one, and it re-measures on the spot.
   *
   *  HIDDEN until the next turn end measures a real one (`refreshCtx`), rather than refreshed on the spot:
   *  refreshing would also be honest and costs one call, but it puts a surface back on screen that has
   *  nothing true to say yet.
   *
   *  DIVERGENCE, recorded (W-S5): upstream has NO persistent context chip at all — its indicator returns
   *  null unless the context level is not "ok" (bundle L488912-922), and surfaces instead as a transient
   *  warning (`Context low (N% remaining) · Run /compact to compact & continue`, L489324). So ccx shows a
   *  chip upstream never shows, before and after this change: it does NOT make us match upstream, it stops
   *  our own chip lying. Whether to keep the inline percentage at all is parked for a later wave. */
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
    setCtxPct(undefined);               // W-S5, see above: measured against a conversation that is gone
    // WAVE S T12, THE SAME BOUNDARY AND THE SAME CLASS AS W-S5/Task 8: the ack is a number measured against
    // a conversation that no longer exists. `/clear` swaps the ENGINE (host `clear` op), so `usage()`
    // restarts at zero — an ack of 500 carried across would sit above every count the new conversation
    // produces for a long while, and (before the strict-equality fix, and still for any count that happens
    // to land on it) suppress the cache warning in a conversation it was never given for. Resume and rewind
    // come through here too and inherit the same reset.
    cacheMissAckedAtOutputTokens.current = undefined;

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
        // W-C T7: the duration row's clock, on the INJECTED `nowFn` rather than the `Date.now()` beside it —
        // that one feeds `TurnSpinner`'s wall-clock render loop and has to match it; this one is measured and
        // then FORMATTED into a permanent transcript row, so a test has to be able to place both ends of it.
        turnStartRef.current = nowFn(); turnDisqualifiedRef.current = false;
        liveTurnRef.current = new LiveTurn({ now: nowFn, columns: columnsFn, platform, cwd }); setBusy(true); setTurnStartedAt(Date.now()); setTurnMeter(IDLE_METER); setStreaming([]); clearRetry(); armStall();
      }
      else if (ev.kind === "message") {
        const data = ev.data as any;
        // W-C T7: a MID-TURN JOINER may not measure a turn that began before it connected. `follow()` hands
        // it a SYNTHETIC `turn:start` (host.ts:490) — which stamped the clock above with the ATTACH instant —
        // and then the buffer so far, every frame of it marked `replay` precisely so a joiner does not clock
        // history (host.ts:501). Dropping the clock on the first such frame is the honest answer: the joined
        // turn gets NO row, exactly as a replayed Agent call gets no duration clause. Unconditional rather
        // than first-only — re-clearing an already-cleared ref is the same act.
        if (ev.replay) turnStartRef.current = undefined;
        // Wave T Task 12 (probe 96). The SDK emits one `system/api_retry` frame per attempt, and it is
        // LIVE-TURN chrome, not history: a ten-attempt ladder is ONE replaced spinner row, not ten notices.
        // Hence the early return — the frame must not reach `systemNoticeLines` (which already paints
        // nothing for it, pinned in species-system.test.ts) nor the document, and it starts no fold break.
        // Stamped with `Date.now()` rather than the injected `nowFn`: `deadline` is read by the same
        // wall-clock render loop as `turnStartedAt` (TurnSpinner's `now = Date.now`), and a countdown seeded
        // off a different clock than the one it is compared against would tick wrong.
        const retry = retryStatusFrom(data, Date.now());
        if (retry) { retryRef.current = retry; setRetryStatus(retry); return; }
        // Wave T Task 13, corrected by the external review: only a frame that PROVES the API answered may
        // retire the turn-start stall watchdog (`provesApiAnswered`, retryStatus.ts — model output, its
        // deltas, tool/subagent progress, the terminal frame). The shipped rule was "every frame that is not
        // api_retry", and the CLI's own `system/init` — local, ~3.3 s into every turn (probe 99) — therefore
        // disarmed the 10 s timer roughly 70 s before a blackholed endpoint's first api_retry frame (probe
        // 96): the stalled row never appeared in the one outage it was built for. Past the first proving
        // frame the watchdog stays retired for the rest of the turn, so a long healthy tool run still cannot
        // trip it. The retry countdown's teardown is the SAME question — nothing announces "the retry
        // succeeded" (probe 96: no cancel/success event, and `max_retries` is a ceiling a 401 gave up short
        // of), so the recovered answer's own first frame is what clears it, not a local frame that happened
        // to arrive mid-ladder. Turn end, turn start and an idle host clear it too.
        if (provesApiAnswered(data)) { disarmStall(); clearRetry(); }
        // A `stream_event` is a PARTIAL, and it changes NOTHING outside the live turn: `appendSdk` rejects
        // partials outright, the bg harvest and the task list read only complete assistant/user frames, and
        // so do `stampAgentCalls`/`syncLiveOpen`. So the retained document cannot move here — and with
        // partials now default-on interactively a single turn carries THOUSANDS of these frames, which made
        // `reconcile()` (copy + sort + fold the whole transcript, twice, plus two setStates) run per token:
        // deltas × history. The live region is the only thing a delta may touch.
        if (data?.type === "stream_event") {
          const partial = liveTurnRef.current;
          if (partial) { partial.ingest(data); setStreaming(partial.snapshot()); setTurnMeter(partial.meter()); if (partial.model) setModel(partial.model); }
          return;
        }
        // W-C T7: an interrupt sentinel disqualifies the turn that carried it from the duration row —
        // upstream's own emission is gated on the aborted signal. An API FAILURE is not disqualifying (see
        // durationRow.ts): upstream prints the row under the error, and so do we.
        if (isInterruptSentinelFrame(data)) turnDisqualifiedRef.current = true;
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
        // W-S7: the AUTOMATIC path's opening frame. Nothing paints it today — `systemNoticeLines` exits on
        // any non-string `content`, so this structured frame reaches the transcript as nothing at all — and
        // it is the only announcement mid-turn compaction makes before its boundary. It sets the busy state
        // and is deliberately NOT returned from: the branches below still get to run (they no-op on it).
        //
        // NOT ON REPLAY, for the same reason `ingestTaskFrame` above guards: `follow()` (host.ts:465-496)
        // drains the last COMPLETED turn's buffer as `message` frames with `replay:true` and delivers no
        // turn events at all on an idle attach. A turn interrupted mid-auto-compaction leaves a buffered
        // `status:"compacting"` with no boundary behind it, so an unguarded arm would paint
        // `Compacting conversation… 0%` on the attaching client FOREVER: the turn-end belt is waiting for a
        // turn event that never comes, and the idle `state` arm clears retryStatus but not this (and would
        // not fire anyway — an interactive host reports "working"). A replayed compaction is history; the
        // live one, if there is one, announces itself on a fresh non-replay frame.
        if (!ev.replay && data?.type === "system" && data.subtype === "status" && data.status === "compacting") startCompacting();
        if (data?.type === "system" && data.subtype === "compact_boundary") {
          clearCompacting();   // W-S7: the boundary IS compact_end — the bar dies here, the summary row below persists
          // WAVE S T12: AUTOMATIC (mid-turn) compaction reaches us only here, and upstream's `$$e` re-stamp
          // fires on it too (L232164). `void` because this arm is a synchronous event handler and nothing
          // downstream depends on the stamp landing; guarded on `!ev.replay` for the same reason
          // `startCompacting` above is — a replayed boundary is history, and re-stamping off it would
          // suppress a warning for a compaction that happened before this client attached.
          if (!ev.replay) void stampAckAfterCompaction();
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
        if (l) { l.ingest(ev.data); setStreaming(l.snapshot()); setTurnMeter(l.meter()); if (l.model) setModel(l.model); }
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
        // W-C T7 (EP-C4d): the duration row, on the LOCAL-ENTRY seam every notice rides. Three ways not to
        // earn one, and each is a different "this turn did not complete": no clock at all (the bare-truncated
        // idle follow tail opens no turn, and its `end` must not clock the gap since the last real one), an
        // interrupt sentinel inside it, or an `ev.error` end. The clock is dropped either way — a second
        // `turn:end` for the same turn (a redelivered close) then finds nothing to measure.
        const startedAt = turnStartRef.current; turnStartRef.current = undefined;
        if (startedAt !== undefined && !turnDisqualifiedRef.current && !ev.error && showTurnDurationRef.current) {
          append([turnDurationLine(Math.max(0, nowFn() - startedAt), { pickVerb: pickTurnVerb })]);
        }
        // A call still open at turn end is an ORPHAN (interrupted, denied, or a result that never came):
        // the turn is over, so nothing is running — end the blink epoch instead of leaving a "running" row.
        clearLiveOpen();
        // W-S7 belt: the WIRE path's only other terminator. An automatic compaction that dies without ever
        // emitting its boundary — an interrupt, a turn that errors out mid-pass — would otherwise leave the
        // bar up forever, because nothing else on that path ever clears it. Cheap (ref-guarded), and on that
        // path it cannot fire early: the boundary always arrives inside the turn that compacted.
        // ACCEPTED EDGE, on the LOCAL path only: a prompt submitted while a typed `/compact` is still running
        // ends a turn of its own, and that turn end takes the bar down before `session.compact()` returns.
        // Narrow (it needs a submit during the pass), harmless (the `finally` then no-ops on an already-clear
        // state, and the `✦ compacted N → M` row still lands), and not worth a second flag to prevent.
        setStreaming([]); setBusy(false); clearRetry(); clearCompacting(); disarmStall(); void refreshCtx(); void refreshUsage(); drainNext();
        // W-C T10: upstream's `lastAssistantMessageId` delta. The two refreshers above poke on their own
        // completion, but only if they SUCCEED — and a turn that ran is news for the payload either way
        // (the model may have changed under it, `session_name` may have just been minted). The 300 ms
        // debounce coalesces this with whichever of the two lands first, so it costs no extra run.
        pokeStatusLine("turn-end");
        // W-C T8: and the one read of the engine's ai-title. Here rather than at `turn:start` because the row
        // it reads is written mid-turn (probe (d) saw it land at row 6 of 20, before the first assistant
        // frame) — a fetch at start would race the engine's own write. Latched, so this is a no-op from the
        // second turn on.
        adoptAiTitle();
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
      // ANOTHER client rewound: rebuild from disk, cut at the anchor the host resumed at (no prefill —
      // not our prompt). Our OWN rewind's broadcast is skipped: confirmRewind already awaits its own
      // rebuild, and running a second one on top of it re-reads disk and re-mints the composer prefill.
      else if (ev.kind === "rewound") { if (!selfRewind.current) void rebuildAfterRewind({ prevUuid: ev.prevUuid, cleared: ev.cleared }); }
      else if (ev.kind === "state") {
        idleFollowReplay.current = false;                          // the trailing frame of a follow replay ends the idle-ingestion mode
        if (ev.status.status === "idle") { clearLiveOpen(); clearRetry(); disarmStall(); }   // the host says nothing is running — no call of ours can still be live, no retry of ours is still pending, and nothing is left to go silent on us
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
        // W-C T10: the status line's `display_name`, off a response this effect was already making.
        // W-C T11: and the effort capability, off the same rows — see `effortCaps` for the two-key indexing.
        const caps2 = new Map<string, { supportsEffort?: boolean; levels?: EffortLevel[] }>();
        for (const m of (caps.models as { value?: unknown; displayName?: unknown; supportsEffort?: unknown; supportedEffortLevels?: unknown }[] | undefined) ?? []) {
          if (typeof m?.value !== "string") continue;
          if (typeof m.displayName === "string") modelNamesRef.current.set(m.value, m.displayName);
          const levels = Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter(isEffortLevel) : undefined;
          const entry = { ...(typeof m.supportsEffort === "boolean" ? { supportsEffort: m.supportsEffort } : {}), ...(levels?.length ? { levels } : {}) };
          caps2.set(m.value, entry);
          const resolved = resolveModelAlias(m.value);
          if (resolved && resolved !== m.value) caps2.set(resolved, entry);
        }
        setEffortCaps(caps2);
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
      if (disposed.current) return;
      if (u?.maxTokens) setCtxPct(Math.round(((u.totalTokens ?? 0) / u.maxTokens) * 100));
      // W-C T10: the same reading is the status line's `context_window`, and the poke is upstream's
      // `tokenUsage` delta by another name — this is the moment the number ccx reports actually moved.
      if (u) { statusCtxRef.current = { totalTokens: u.totalTokens, maxTokens: u.maxTokens }; pokeStatusLine("context"); }
    } catch { /* best-effort */ }
  }
  // Fire-and-forget at turn-end only — never poll (spec's no-polling rule). Drives the status-bar warning;
  // /status and /usage fetch usage() directly themselves and don't route through this.
  async function refreshUsage() {
    try {
      const u = await session.usage();
      if (!disposed.current) { setUsageWarn(usageWarning(u)); statusUsageRef.current = u as StatusLineUsage; pokeStatusLine("usage"); }   // W-C T10: `cost` + `current_usage`
      return u;
    }
    catch { return undefined; }
  }

  function append(ls: RenderLine[]) { if (ls.length) appendNewLocal({ kind: "visual", lines: ls }); }
  function notice(text: string) { appendNewLocal({ kind: "notice", lines: [{ text, dim: true }] }); }
  // F2 task 9: text from ABOVE this tree (the keybindings.json watcher) becomes a normal transcript notice.
  // Bound once on mount — `notice` only reads refs and setState, so the mount-time closure stays correct for
  // the life of the component, and after unmount `appendNewLocal`'s `disposed` guard drops the call.
  useEffect(() => { opts.noticeBridge?.bind((text) => notice(text)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Wave-T T2 — the auto-mode entry notice, upstream's shape exactly (bundle L547934-955): an effect keyed on
  // the MODE, not on whichever frame changed it, so every route into `auto` earns it — the host's `state`
  // frame, Shift+Tab's own applyMode, and an `attach` to a host already in auto (accepted: a background host
  // stays in auto, so attaching prints this; upstream's per-process ref behaves the same way). 800 ms later,
  // as a plain transcript `notice` row (upstream's `ml(text,"notice")`), at most once per process (the ref,
  // set inside the timer exactly like upstream's `qU` — a mode flip that leaves auto before the delay elapses
  // cancels it and stays eligible) and at most once per install (the prefs flag).
  const autoNoticeShown = useRef(false);
  useEffect(() => {
    if (mode !== "auto" || autoNoticeShown.current) return;
    const id = setTimeout(() => {
      if (disposed.current) return;
      autoNoticeShown.current = true;
      if (!shouldShowAutoModeNotice(loadPrefs(historyEnv))) return;
      notice(AUTO_MODE_DESCRIPTION);
      // Best-effort, mirrors theme's/output-style's own silent persistence (:1094). savePrefs does a mkdir + a
      // file write, and THIS is a bare timer callback: no promise chain, no error boundary, and the tree
      // installs no uncaughtException handler — so on a read-only home or a full disk an unguarded throw here
      // would take down an interactive session over a cosmetic flag. That "a throw from a timer/fire-and-forget
      // callback has nothing above it" shape is a recurring defect class in this codebase (an independent review
      // caught the identical pattern in an earlier wave); every such write is wrapped. The per-process
      // `autoNoticeShown` ref above is what still holds the notice to once when this write is the thing failing.
      try { savePrefsFn({ hasSeenAutoModeEntryWarning: true }, historyEnv); } catch { /* best-effort */ }
    }, AUTO_MODE_NOTICE_DELAY_MS);
    return () => clearTimeout(id);
  }, [mode]);   // eslint-disable-line react-hooks/exhaustive-deps
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
          // F6 T11-fix: `/model <name>` REPLACES whatever the picker's `s` last put in force, so the
          // session-only mark has to die with it — otherwise the picker's third line still claims
          // "Currently using Opus for this session only" over a session now running Sonnet. Cleared here
          // and not inside `setModel` because that setter also runs from stream events, where the model
          // reported IS the session-only one.
          if (cmd.args) { const m = resolveModelAlias(cmd.args)!; sessionModelRef.current = undefined; await session.setModel(m); if (!disposed.current) setModel(m); append(formatModel(m)); }
          else { await openModelPicker(); }
          break;
        // The in-progress affordance is not decoration: compact is a full engine summarization pass (30–120s
        // live), and the await below is silent for all of it — with nothing on screen, /compact reads as a hang.
        //
        // W-S7 (Wave S task 11): it used to be a permanent `append()` of `✻ compacting…`, which nothing ever
        // removed — the transcript kept it forever beside the `✦ compacted N → M` result. It is a BUSY STATE
        // now (A13): upstream clears its spinner, hint and bar together at compact_end and persists only the
        // `Compacted …` message, so the in-progress half is ephemeral render state and only the outcome is a
        // row. Set here rather than off the wire because /compact's frames never leave `session.compact()`
        // (the split is documented at `startCompacting`), and cleared in a `finally` so a compaction that
        // FAILS or throws takes the affordance down with it — the outcome line is the user's answer either way.
        //
        // W-S5 (task 8 review): a SUCCEEDED compaction is the one boundary that leaves the percentage
        // describing this same conversation and still wrong — the context shrank under it, and `refreshCtx`'s
        // only other caller is turn end, so the chip would overstate until the next turn. Re-measured HERE
        // rather than derived from the outcome: it carries preTokens/postTokens but no window size, and a
        // percentage needs the denominator, which only `getContextUsage` reports (deriving one against a
        // remembered maxTokens would also mix numerators — post_tokens counts the compacted conversation,
        // totalTokens the whole window). Dropped BEFORE the re-measure, so a re-measure that fails shows
        // nothing rather than the pre-compact number. NOT the failure path: a compaction that failed changed
        // no context, so the last measurement still stands and is left alone.
        //
        // The premise this rests on — that `getContextUsage` called right after the boundary already
        // reports the SHRUNKEN context, not a pre-compaction snapshot — is live-verified by probe 82
        // (2026-08-09): reading on the compact_boundary frame gave 16970 tokens against 17852 before,
        // while the boundary's own metadata claimed pre 17894 → post 1410 (the ~15.5k floor is fixed
        // system/tool overhead the usage call always counts and post_tokens doesn't).
        case "compact": {
          startCompacting();
          let outcome; try { outcome = await session.compact(); } finally { clearCompacting(); }
          append(formatCompact(outcome));
          if (outcome.ok) { setCtxPct(undefined); await refreshCtx(); await stampAckAfterCompaction(); }
          break;
        }
        case "context": append(formatContext(summarizeUsage((await session.getContextUsage()) as RawContextUsage))); break;
        case "cost": append(formatCost((await session.usage()) as SessionUsage)); break;
        case "status": {
          const u = await session.usage().catch(() => undefined);
          append(formatStatus({ model, mode, thinkLevel, ...(effort ? { effort } : {}), ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined }));
          break;
        }
        case "usage": append(formatUsage(await session.usage())); break;
        // Live-feedback fix (2026-08-06): /clear was UI-only — screen wiped, document replaced, ENGINE
        // CONTEXT KEPT — so the model still remembered everything, which read as "/clear doesn't work".
        // The engine half is a fresh-conversation swap (host `clear` op, busy-gated like resume). It runs
        // FIRST: if the host refuses (mid-turn) or predates the op, the screen is left alone and the
        // refusal is printed — a wiped screen over a kept context is exactly the lie this fixes.
        case "clear": {
          try { await session.clearSession?.(); } catch (e) {
            append([{ text: `clear: ${e instanceof Error ? e.message : String(e)} — screen left as is (engine context unchanged)`, dim: true }]);
            break;
          }
          clear();
          break;
        }
        // F6 T14: `/help` is a DIALOG upstream (`RNa`, L459684), not a printed list — the General tab carries
        // the shortcuts grid and the Commands tab browses the live catalog. The old `formatHelp()` listing it
        // replaced was deleted in T15 once this became its only ex-caller (see commands.ts).
        case "help": openHelp(); break;
        case "resume": void openPicker(); break;
        case "continue": void doContinue(); break;
        // Wave-T T15 / spec W-T20 — a DELIBERATE divergence: upstream's consent gate is launch-only, but
        // upstream's mode ladder cannot reach bypass at all (settingsRows.ts:23-27 transcribes that
        // exclusion), so this command is a ccx-specific route into the mode with no upstream precedent to
        // inherit. Same dialog, same persisted answer as the launch gate — and unlike the launch path a
        // refusal here simply leaves the session in the mode it is already in, because there is a live
        // session to leave (the launch gate's "decline exits" has nothing to fall back TO; spec W-T10).
        case "yolo":
          if (hasAcceptedBypass(loadPrefs(historyEnv))) void applyMode("bypassPermissions");
          else setBypassConsent({ open: true });
          break;
        case "think":
          if (cmd.args) {
            const parsed = parseThinkArg(cmd.args);
            if (!parsed) { append([{ text: `thinking: unknown level "${cmd.args}" · try off/low/medium/high/xhigh/max or a number`, color: role("error") }]); break; }
            await session.setMaxThinkingTokens(parsed.budget);
            if (!disposed.current) setThinkLevel(parsed.level);
            append(formatThink(parsed.level));
          } else append(formatThink(undefined, thinkLevel));
          break;
        // W-C T11 (EP-C6). No arg = upstream's shape, the dialog (`local-jsx`, L447278). An arg is ccx's
        // documented divergence (commands.ts's COMMANDS entry says why) and the only keyboard route to the
        // domain gate — a dialog cannot produce an invalid level.
        case "effort":
          if (cmd.args) applyEffort(cmd.args.trim());
          else openEffortDialog();
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
          // W-C T8: the top rung of the terminal-title ladder, published only AFTER the write succeeded — a
          // rename that threw must leave the tab saying what the session is still called. Unconditional over
          // the ai-title (the `terminalTitleFromRename` setting is a recorded skip).
          setRenameTitle(cmd.args);
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
            case "showTurnDuration": setShowTurnDuration(result.value !== "false"); break;
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
    try { const sessions = await listSessions(NARROWED_SCOPE); if (!disposed.current) setPicker({ open: true, sessions, hasWorktree: false }); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); return; }
    // Ctrl+W's gate, detected AFTER the picker is up: upstream kicks the same enumeration off in an effect
    // (`D(...)`, L476394), and a `git worktree list` behind a slow fsmonitor must not delay the list. The
    // chord and its hint simply appear when the answer lands, and never appear at all if git says no.
    void hasWorktreesFn(cwd).then((yes) => { if (yes && !disposed.current) setPicker((p) => (p.open ? { ...p, hasWorktree: true } : p)); }, () => {});
  }
  /** Wave S T10 (A11): the CANCEL path, and only it. A successful pick closes the same overlay through
   *  `pickSession` below, which sets the state directly — so the outcome line cannot follow a resume.
   *  Upstream prints this from a SECOND place too: cancelling its `Loading conversations…` / `Resuming
   *  conversation…` spinner (L476807, `isActive: s && !l`). ccx has no such surface — `openPicker` awaits
   *  `listSessions` with nothing on screen and `resumeInto` swaps synchronously — so there is no spinner to
   *  cancel and no second call site. Recorded, not missing (t10 review, note 5). */
  function closePicker() { if (!disposed.current) { setPicker({ open: false, sessions: [], hasWorktree: false }); notice(RESUME_CANCELLED); } }
  /** The picker's widen re-query (Wave S T10). Same reader the open used, under the scope the picker holds. */
  const reloadSessions = (scope: ResumeScope) => listSessions(scope);
  // Fetch the persisted transcript FIRST; only swap + replay if it has history (never drop into a broken resume).
  // Guarded on `busy` (mirrors the host's own busy-gated `resume` op, Task 2): swapping `session` mid-turn would
  // unsubscribe the `[session]`-keyed event effect from the OLD session before its turn-end event arrives, and
  // since busy is now cleared only by that event (no `.finally()` safety net post-refactor), busy would stay
  // stuck true forever and drainNext would never fire. We never auto-interrupt the old turn — that's the
  // human's call (Esc).
  async function resumeInto(id: string, dir?: string) {
    if (disposed.current) return;
    if (busy) { notice("cannot resume mid-turn — wait for the turn to finish or press Esc to interrupt"); return; }
    let msgs: any[] = [];
    try { msgs = await getSessionMessages(id, dir); } catch { msgs = []; }
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
    // W-C T8, THE SAME BOUNDARY AND THE SAME CLASS AS W-S5's context percentage: both title rungs name the
    // conversation that just went away, and the once-per-session latch was set for it. Left standing, the tab
    // kept the OLD session's title after a `/resume` AND the latch blocked the new session's fetch forever
    // (t8 review, Medium + Low). Gated on a REAL swap for the reason the sameSession branch above exists —
    // resuming a session into itself keeps its own `/rename`, which is a user action on this very conversation.
    // The re-read is IMMEDIATE rather than deferred to the first `turn:end`: a resumed session's ai-title is
    // already on disk (probes annex §(d)), so waiting for a turn would show `ccx` for a conversation the engine
    // has already named. Launch `--resume`/`--continue` route through here too, so they inherit the mount read.
    if (!sameSession) { setAiTitle(undefined); setRenameTitle(undefined); aiTitleFetched.current = false; adoptAiTitle(id); }
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
    setPicker({ open: false, sessions: [], hasWorktree: false });   // NOT closePicker: a pick is not a cancel
    // The row's OWN directory, not this REPL's: after Ctrl+A the list spans every project, and reading the
    // chosen transcript under `opts.cwd` found nothing and refused with `no history found` (external review,
    // finding 2). A narrowed row carries this very cwd, so the ordinary path is unchanged. What is NOT
    // changed is the engine: `makeSession` resumes in the host's own directory, so a cross-project resume
    // replays that transcript here rather than moving the working directory to it.
    void resumeInto(info.sessionId, info.cwd);
  }
  // F6 T11: the resume picker's two extra verbs. They are the SAME two session calls `/resume` and `/rename`
  // already use — routed out to the picker rather than duplicated in it, so the reader stays the one in
  // `deps` (a test swaps it once and both surfaces follow). A preview that cannot be read is an EMPTY
  // transcript, never a throw: the pane's job is to show what is there. `dir` is the picker's row's own
  // directory (finding 2 again) — the pane and the rename field must not act on a different project than
  // the one the highlighted row names.
  const previewSession = (id: string, dir?: string) => getSessionMessages(id, dir).catch(() => [] as any[]);
  // W-C T8 rides here too, and it is `id`-gated for the reason the picker exists: this verb renames ANY row
  // in the list, and renaming some other project's session must not retitle this terminal.
  const renamePickedSession = (id: string, title: string, dir?: string) =>
    renameSessionFn(id, title, dir).then(() => { if (id === session.sessionId) setRenameTitle(title); });

  async function openModelPicker() {
    try {
      // WAVE S T12: the switch confirm's gate needs the session's CUMULATIVE output tokens, and this is the
      // one moment it can be read — the spinner's own meter is per-turn and resets every turn.
      // Fetched alongside the catalog, not after it, so the picker still opens in one round-trip.
      // A FAILED usage read degrades to 0, which by gate condition 1 means NO confirm — i.e. it degrades to
      // exactly the behavior this surface had before T12, never to a dialog raised on a number we do not
      // have. The picker itself must never fail to open because a usage read did.
      const [caps, usage] = await Promise.all([session.capabilities(), session.usage().catch(() => undefined)]);
      if (disposed.current) return;
      const outputTokens = totalOutputTokens(usage as SessionUsage | undefined);
      // W-C T11: the two effort fields ride along, because the picker's effort row is answered by the FOCUSED
      // row (§C6.3's `tvn`/`nva`) and the catalog is the only place that knows.
      const models: ModelInfo[] = (caps.models as any[]).map((m) => ({
        value: String(m?.value ?? m), displayName: m?.displayName, description: m?.description,
        ...(typeof m?.supportsEffort === "boolean" ? { supportsEffort: m.supportsEffort } : {}),
        ...(Array.isArray(m?.supportedEffortLevels) ? { supportedEffortLevels: (m.supportedEffortLevels as unknown[]).filter(isEffortLevel) } : {}),
      }));
      if (!models.length) { append([{ text: "no models available", dim: true }]); return; }
      // Which ROW is the model in force. `model` is a resolved id ("claude-opus-5") and the rows are tier
      // aliases ("opus"), so the match runs through the same resolver `pickModel` writes with — a bare
      // `model` would tick no row at all on every alias-driven session, which is most of them.
      const current = models.find((m) => m.value === model || resolveModelAlias(m.value) === model)?.value;
      // `ackedAt` is snapshotted onto the state rather than read from the ref at render time so ChatApp keeps
      // reading state only, and so the pick that stamps it can stamp the SAME count the gate was asked about.
      // `activeModel` is the gate's THIRD comparison rung and the reason review finding 3 is closed: `current`
      // is undefined whenever no catalog row matches (a session pinned to an explicit id outside the alias
      // set), and without a fallback the gate would then be off for the whole session.
      setModelPicker({ open: true, models, outputTokens, ...(cacheMissAckedAtOutputTokens.current !== undefined ? { ackedAt: cacheMissAckedAtOutputTokens.current } : {}), ...(current ? { current } : {}), ...(model ? { activeModel: model } : {}), ...(sessionModelRef.current ? { sessionModel: sessionModelRef.current } : {}) });
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  function closeModelPicker() { if (!disposed.current) setModelPicker({ open: false, models: [] }); }
  /** `saveDefault` is the picker's Enter-vs-`s` split (DG46). The prefs write itself already happened inside
   *  the picker (it owns the `s` key, so it is the only place that knows); what reaches here is which of the
   *  two confirmation sentences is true, and whether a session-only override is now in force. */
  function pickModel(m: ModelInfo, opts: { saveDefault?: boolean; confirmed?: boolean } = {}) {
    if (disposed.current) return;
    const saveDefault = opts.saveDefault !== false;
    sessionModelRef.current = saveDefault ? undefined : m.value;
    // WAVE S T12: stamp the ack ONLY when this pick passed the switch confirm, and stamp the very count the
    // gate was asked about (the one `openModelPicker` put on the picker state). A DECLARED DIVERGENCE:
    // upstream's `_4H` stamps a FRESH `$S()` read at accept time (L447011); we snapshot deliberately,
    // because between the picker opening and the accept the count can only have GROWN, and stamping the
    // larger number would leave the ack sitting above a warning the user was never shown — silently
    // suppressing it. Snapshotting means the ack names exactly the state the user agreed to.
    // A pick that never raised the dialog stamps nothing: it must not silence the NEXT switch.
    if (opts.confirmed) cacheMissAckedAtOutputTokens.current = modelPicker.outputTokens ?? 0;
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
    // L471427's confirmation, which REPLACED `model → X` on this path: the picker's whole point is the
    // default-vs-session split, and the old line could not say which had happened. `/model <name>` (no
    // picker, no split) still prints `formatModel`.
    if (!fromSettings) append(formatModelSet(m.displayName ?? m.value, saveDefault));
    void session.setModel(v).catch(() => {});
  }

  // ── WAVE C TASK 11 (EP-C6): the effort verbs. ────────────────────────────────────────────────────────
  /** THE CLIENT-SIDE DOMAIN GATE, and the reason it exists is measured rather than defensive: probe 102
   *  established that `Query.applyFlagSettings({effortLevel})` — the SDK's ONLY runtime effort hook, there is
   *  no `setEffort` — performs NO VALIDATION. `{effortLevel:"bogus"}` resolves silently and the session keeps
   *  running at whatever level it had, so a typo would look exactly like a success. ccx therefore refuses
   *  out-of-domain levels HERE, before a frame is built: no wire op fires, and the user is told. The wire
   *  schema (`ops.ts`) closes the same domain again as the belt to this brace.
   *
   *  Commit-before-await, the same ordering `pickModel`/`setThink` settled on (final review Finding 2): the
   *  engine call is fire-and-forget with a swallowed rejection, so deferring the local commit until it
   *  settled would buy no correctness and would open a window where the hint and the status line still read
   *  the old level. */
  function applyEffort(level: string): void {
    if (disposed.current) return;
    if (!isEffortLevel(level)) {
      append([{ text: `effort: unknown effort level "${level}" · try low/medium/high/xhigh/max`, color: role("error") }]);
      return;
    }
    setEffortState(level);
    // Feature-tested like every other SettingsOps verb: a lib Session (whose config is fixed at construction)
    // has no flag layer to write, and the local state above is still the truthful thing to show.
    if (hasSettingsOps(session)) void session.setEffort(level).catch(() => {});
  }
  /** Snapshot at open time, exactly as `openModelPicker` does, so ChatApp reads state and nothing else. */
  function openEffortDialog(): void {
    if (disposed.current) return;
    setEffortDialog({
      open: true, level: effort ?? DEFAULT_EFFORT, levels: effortLevels,
      supported: effortSupported !== false,
      ...(model ? { modelName: modelNamesRef.current.get(model) ?? model } : {}),
    });
  }
  function closeEffortDialog(): void { if (!disposed.current) setEffortDialog({ open: false }); }
  function confirmEffort(level: EffortLevel): void { closeEffortDialog(); applyEffort(level); }

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

  // Wave-T T15 — the two answers to `/yolo`'s consent. The dialog persists the acceptance itself (every route
  // into bypass records it, so no caller can forget to), which leaves these two the mode change and the
  // notice. The refusal ignores the exit code the dialog reports: those codes are the LAUNCH path's, and a
  // refusal mid-session means "stay where you are", never "end the session".
  function acceptBypassConsent() { if (!disposed.current) { setBypassConsent({ open: false }); void applyMode("bypassPermissions"); } }
  function refuseBypassConsent() { if (!disposed.current) { setBypassConsent({ open: false }); notice("bypass permissions declined — permission mode unchanged"); } }

  // W3 T5: /config. A snapshot-diff design, not incremental change-tracking (see the settingsBaselineRef
  // comment above) — currentSettingsCtx() reads currentTheme() FRESH each call (theme.ts's own contract:
  // never cache it) alongside whatever this hook's own state currently holds for model/outputStyle/mode/
  // thinkLevel, so both the open-time baseline and the close-time snapshot are always accurate regardless
  // of how many times the Model/Theme/Output-style sub-flows ran in between.
  function currentSettingsCtx(): SettingsRowCtx { return { theme: currentTheme(), model, outputStyle, mode, thinkLevel, showTurnDuration }; }
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
  /** The Turn-duration row's boolean toggle (W-C T7). Purely client-side — there is no engine leg at all, so
   *  this is `/theme`'s shape rather than `setThink`'s: commit the state, persist behind it. The write is
   *  wrapped for the reason every prefs write in this file is (a read-only home must not take down a session
   *  over a cosmetic flag), and `savePrefs` merges, so it cannot clobber a neighbouring key. */
  function setShowTurnDuration(next: boolean): void {
    if (disposed.current) return;
    setShowTurnDurationState(next);
    try { savePrefsFn({ showTurnDuration: next }, historyEnv); } catch { /* best-effort */ }
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
    return formatStatus({ model, mode, thinkLevel, ...(effort ? { effort } : {}), ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined });
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
   *  this user's composer. NO LONGER IDEMPOTENT, and the `selfRewind` ref exists because of it: a second
   *  run re-reads disk, re-cuts, and re-mints the composer prefill, so the confirming client must not
   *  also act on its own `rewound` broadcast. (This line used to say re-running was harmless. It was true
   *  while the rebuild was a fire-and-forget read; it stopped being true when the rebuild gained the cut.) */
  async function rebuildAfterRewind(opts: { prevUuid?: string | null; prefill?: string; cleared?: boolean } = {}) {
    // Two halves, both measured:
    //  · The READ RACES THE SWAP, and the race cannot be won by waiting. The engine swap mints a session
    //    id asynchronously and the new file's first flush lags the swap settling, so the poll below still
    //    earns its keep for "is there anything to read yet". But polling can never produce the TRIMMED
    //    view: the row that moves the reader's leaf onto the new branch is written by the NEXT turn, so
    //    a poll waiting for it would exhaust its window and render the stale frame anyway. The rows are
    //    cut here instead, at the anchor the host itself resumed at (rewindRebuild.ts).
    //  · Ink's app.clear() (replaceDocument's bridge) cannot erase rows already scrolled OUT of the
    //    viewport, so the pre-rewind conversation survived above and the rebuild below read as "nothing
    //    re-rendered". So rewind does the real wipe (2J/3J/H — screen AND scrollback), immediately before
    //    the fresh document mounts. It is now the ONLY caller of that wipe: W-R t7 moved `/clear` onto
    //    upstream's viewport-only inline arm, which keeps scrollback on purpose. A rewind cannot, because
    //    the turns it discards must not stay readable above the transcript that replaced them.
    const retry = deps.rewindReplayRetry ?? { attempts: 8, delayMs: 375 };   // ≈3s worst case; injectable so tests never sit it out
    let id = session.sessionId;
    let msgs: any[] = [];
    // HOW MANY TIMES TO ASK DISK, and the two W-S8 arms that are not "the default eight":
    //  · `cleared` — a restore to the session's FIRST message. The host swapped to a fresh, EMPTY
    //    conversation on a NEW session id, so there is nothing to read: the only file our (possibly stale)
    //    cached id names is the OLD one, still holding every discarded turn, and with `prevUuid` null there
    //    is no anchor to cut it at — `truncateAtAnchor(rows, null)` hands back every row. So zero reads, and
    //    the empty-document arm below runs directly off the flag. A POSITIVE signal, never the absence of an
    //    anchor: the confirming client derives it (confirmRewind), a follower reads it off the wire.
    //  · `prevUuid === null` with no flag — a host too old to send one. Correct answer is still an empty
    //    conversation, so ONE read and no poll: waiting ~3s for rows that must never arrive makes a
    //    successful operation read as a hang. `!== null`, not falsy: `undefined` means "anchor unknown"
    //    (a follower on a pre-EP-S1 host), where rows ARE expected and the poll must run in full.
    const attempts = opts.cleared ? 0 : opts.prevUuid !== null ? retry.attempts : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) { await new Promise((r) => setTimeout(r, retry.delayMs)); if (disposed.current) return; }
      id = session.sessionId ?? id;
      if (!id) continue;
      try { msgs = await getSessionMessages(id); } catch { msgs = []; }
      if (msgs.length) break;                       // the poll waits for rows to EXIST — nothing more
    }
    if (disposed.current) return;
    const rows = truncateAtAnchor(msgs, opts.prevUuid);
    clearScreen();
    // A rewind is a deliberate session transition: the fresh document derives ONLY the restored persisted
    // messages. (Ctrl-O never uses this path.)
    if (rows.length) replaceDocument(replayDocument(rows, { id, label: "⏪ rewound", width: columnsFn() }));
    else { const fresh = new TranscriptDocument(); fresh.appendLocal({ kind: "rewind-divider", lines: [{ text: "⏪ rewound", dim: true }] }, "rewind:empty"); replaceDocument(fresh); }
    lastAssistant.current = lastAssistantText(rows);        // /copy follows what is on screen
    taskListRef.current.reset(); setTasks([]);
    bgHarvest.current.reset();
    if (opts.prefill !== undefined) setComposerPrefill({ text: opts.prefill, token: Date.now() });
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
    selfRewind.current = true;
    void (async () => {
      try {
        await session.rewind(anchor, scope);
        if (disposed.current) return;
        if (scope === "code") { notice(`⏪ code restored to before "${anchor.text.slice(0, 40)}"`); return; }
        // `cleared` is DERIVED here, not received: `selfRewind` exists precisely so the host's `rewound`
        // broadcast — the only thing that carries the field — never drives this client's rebuild (W-S8).
        await rebuildAfterRewind({ prevUuid: anchor.prevUuid, prefill: anchor.text, cleared: !anchor.prevUuid });
      // Upstream's own failure copy (`ce`, bundle L487142-154), chosen by the scope that was asked for —
      // see rewindFailureHeading for why the arm cannot be chosen by which half actually threw, and for the
      // one arm of upstream's four that has no channel to reach us at all.
      } catch (e) { append([{ text: rewindFailureHeading(scope), color: role("error") }, { text: (e as Error).message, color: role("error") }]); }
      finally { selfRewind.current = false; if (!disposed.current) setRewinding(false); }
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
  function openHelp() { if (!disposed.current) setHelpOpen(true); }
  // `EHf("Help dialog dismissed", { display: "system" })` (L459687) — checked, and unlike T13's Background
  // dismissal this one does NOT pass `display:"skip"`, so the line really is printed. Same `notice` shape the
  // Settings/Permissions dismissals use.
  function closeHelp() { if (!disposed.current) { setHelpOpen(false); notice("Help dialog dismissed"); } }
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
      if (model === undefined) notice("auto — can't check this client's model; if it doesn't support auto the engine will refuse the mode");
      else {
        const target = resolveAutoModel(model);
        if (model !== target) {
          // Same rule as the mode below (and as host.ts's applyPlanUpgrade): the MODEL truth moves only once
          // the engine took the swap, and a refused swap is reported rather than announced as done. The old
          // `.catch(() => {})` painted the new model and claimed the switch either way, so a failed swap left
          // the chip on a model the session isn't running while the engine refused auto outright (probe 99).
          let swapped = true;
          try { await session.setModel(target); }
          catch (e) { swapped = false; if (!disposed.current) append([{ text: `✗ auto — model swap to ${target} failed (${(e as Error)?.message ?? e}); ${model} doesn't support auto, so the engine will refuse the mode`, color: role("error") }]); }
          if (disposed.current) return;
          if (swapped) {
            setModel(target);
            append([{ text: `↻ auto — switched model to ${target} (${model} doesn't support auto)`, dim: true }]);
          }
        }
      }
    }
    await new Promise<void>((r) => setTimeout(r, 0));
    if (disposed.current) return;
    // THE MODE TRUTH MOVES ONLY ON SUCCESS — same rule and same ordering as host.ts's applyPlanUpgrade.
    // `allowDangerouslySkipPermissions` is set from the LAUNCH mode only (resolveOptions.ts), and the engine
    // enforces that one layer down (bundle L562709: "…because the session was not launched with
    // --dangerously-skip-permissions"; L562713 does the same for the model-gated `auto`). The old
    // `.catch(() => {})` here swallowed that refusal and the next line painted the chip anyway — a status bar
    // showing bypass in red while the engine sat in the previous mode. Report it and stay put instead.
    // The refusal ROW below is HARNESS-AUTHORED and has to be: all three copies of that refusal in the bundle
    // (L372121-127, L486915-921, L562707-713) are ENGINE-side and only hand back `ok:!1` + an `error` string —
    // upstream's own TUI flips the mode in-process and never renders a refusal at all, so there is no canon
    // client-side string to match here. Don't go hunting for one.
    try { await session.setPermissionMode(next); }
    catch (e) {
      if (!disposed.current) append([{ text: `✗ ${next} refused by the engine (${(e as Error)?.message ?? e}) — staying in ${mode}`, color: role("error") }]);
      return;
    }
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
  // `/clear` (W-R t7): the MODEL first, the SCREEN second — the one order that cannot leave a blank pane.
  // `replaceDocument` runs the Static seam (`app.clear()`), which erases the live frame's rows AND zeroes
  // log-update's counters; the reset then wipes the viewport and forces the frame back in the very same
  // synchronous burst, so no render can sit between them. React's re-render lands after: an identical frame is
  // deduped (the screen already carries it) and a changed one is written with a correct `eraseLines`, because
  // the reset left those counters describing exactly what it painted. Reversed, `app.clear()` would erase the
  // frame the reset had just put back — which is the blank pane, one step later.
  function clear() { if (!disposed.current) { replaceDocument(new TranscriptDocument()); clearViewportFn(); } }

  return { state: { sessionId: session.sessionId, staticItems, pendingItems, streaming, pending, mode, busy, aiTitle, renameTitle, ctxPct, model, picker, tasks, bgTasks, bgRows: bgHarvest.current.rows(bgTasks), bgPanelOpen, thinkLevel, effort, effortSupported, defaultEffort: DEFAULT_EFFORT, effortDialog, turnStartedAt, modelPicker, commandCatalog, queue, submitCount, hasMessages: documentRef.current!.messageCount > 0, staticEpoch, turnMeter, rewindPicker, composerPrefill, rewinding, usageWarn, shortcutsOpen, helpOpen, historyOpen, addDir, themeDialog, bypassConsent, settings, outputStyle, showTurnDuration, permissions, denials, workDirs, retryStatus, compacting, notification, statusLineText } as ChatState, detailItems, submit, popQueueToComposer, resolveDecision, cycleMode, interrupt, clear, closePicker, pickSession, reloadSessions, previewSession, renamePickedSession, closeModelPicker, pickModel, openModelPicker, openEffortDialog, closeEffortDialog, applyEffort, confirmEffort, notice, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, openHelp, closeHelp, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, acceptBypassConsent, refuseBypassConsent, applyMode, setThink, setShowTurnDuration, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir, notifications, notify, dismissNotification };
}
