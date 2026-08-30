// tui/src/useChat.ts — owns the session (event-driven, Goal B task 7): the host event stream is the
// SINGLE rendering source (turn/message/decision/tasks_changed/task/state events all arrive via
// ChatSession & SessionEvents & DecisionFeed & BgTasks), `submit`/`resolveDecision` are command channels
// only. Owns the transcript, the streaming turn, the decision queue, mode switching (Tab ladder + host
// truth via state events), the bg-task panel, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import { useStdout } from "ink";
import { randomUUID } from "node:crypto";
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
import type { RendererChoice } from "./renderer.js";
import { loadPrefs, savePrefs as realSavePrefs } from "./prefs.js";
import { isInterruptSentinelFrame, pickTurnVerb as realPickTurnVerb, turnDurationLine } from "./durationRow.js";
import { createSuggester as realCreateSuggester, formatTranscriptTail, markSuggestionAccepted, suggestionRenderStep, suggestionSuppression, EMPTY_SUGGESTION, TAIL_MESSAGE_CHARS, type PromptSuggestion, type Suggester, type TailMessage } from "./suggester.js";
import { AUTO_MODE_NOTICE_DELAY_MS, ACCOUNT_NOTICE_DEADLINE_MS, autoModeNoticeText, shouldShowAutoModeNotice } from "./autoModeNotice.js";
import type { AccountBridge } from "./accountBridge.js";
import type { AccountFacts } from "./banner.js";
import { hasAcceptedBypass } from "./bypassConsent.js";
import { currentTheme, resolveThemeColor, setTheme, themeTokens, type ThemeId } from "./theme.js";
import { buildRows, summarizeChanges, PERMISSION_MODE_OPTIONS, type SettingsRowCtx } from "./settingsRows.js";
import { OUTPUT_STYLE_REDIRECT } from "./OutputStylePicker.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import { userEchoLines, type RenderLine } from "./render.js";
import { compactSummaryLines, systemNoticeLines, isTranscriptOnlyNotice, COMPACT_SUMMARY_SPECIES, SYSTEM_INFO_SPECIES, LOCAL_OUTPUT_GUTTER } from "./species.js";
import { TranscriptDocument, type LocalTranscriptEvent, type TranscriptBootstrapEntry } from "./transcriptModel.js";
import { projectCompact, projectDetail, projectPending, streamOwnerKey as mintStreamOwnerKey, type ProjectionContext, type RenderItem } from "./toolRenderer.js";
import { mainWindowCap, selectLiveWindow, WINDOW_SLACK } from "./liveWindow.js";
import { paintedHeight } from "./wrapItems.js";
import { RESIZE_SETTLE_MS } from "./resizeRepaint.js";
import { LiveTurn, IDLE_METER, type SpinnerMeter } from "./liveTurn.js";
import { retryStatusFrom, provesApiAnswered, type RetryStatus } from "./retryStatus.js";
import { FoldPendingState, stampToolStarts } from "./foldPendingState.js";
import { HookPairTracker } from "./hookPairs.js";
import { ingestTaskFrame, stampAgentCalls, type AgentMeta } from "./agentProgress.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { BgMetaHarvest, type BgTaskRow } from "./bgTaskMeta.js";
import { createNotificationStore, type CcxNotification, type NotificationStore } from "./notifications.js";
import type { DesktopNotifier } from "./desktopNotify.js";
import { EFFORT_HINT_KEY, EFFORT_HINT_TIMEOUT_MS, EFFORT_LEVELS, effortHint, isEffortLevel, isPersistableEffortLevel, type EffortLevel } from "./modelPickerModel.js";
import { parseCommand, canonicalCommand, formatModel, formatModelSet, formatThink, formatEffortSet, formatEffortHelp, formatEffortCurrent, formatEffortInvalid, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, formatTuiUsage, formatTuiResult, TUI_SETTINGS, TUI_BUSY_REFUSAL, type TuiSetting, parseMcpArgs, formatMcpStatus, formatMcpUsage, formatAdvisorResult, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, CLIENT_SIDE_NOTES, formatClientSide, parseConfigArg, totalOutputTokens, type ParsedCommand, type InitialResume, type SessionUsage } from "./commands.js";
import { applyAdvisorChoice, canAdvise, supportsAdvisor, ADVISOR_NOTICE_KEY, ADVISOR_NOTICE_PAIRED_TEXT, ADVISOR_NOTICE_UNPAIRED_TEXT } from "./advisorModel.js";
import { rewindFailureHeading } from "./rewindModel.js";
import { truncateAtAnchor } from "./rewindRebuild.js";
import { formatUsage, usageWarning, usageSummaryLine, USAGE_WARNING_KEY } from "./usageFormat.js";
import { tokenWarning, TOKEN_WARNING_KEY, TOKEN_WARNING_TIMEOUT_MS } from "./tokenWarning.js";
import { mergeCommands, toCatalogEntry, type CommandEntry } from "./commandComplete.js";
import { parseThinkArg } from "./thinkLevels.js";
import { exportMarkdown, defaultExportName, filesInContext, formatFiles, formatStats, formatSessionInfo, EXPORT_HEADER } from "./sessionTools.js";
import { recentAssistantTexts, RECENT_ASSISTANT_CAP } from "../sessions/rows.js";
import type { ModelInfo } from "./ModelPicker.js";
import { replayDocument } from "./replay.js";
import { runBash as realRunBash, formatBashOutput, type BashResult } from "./bash.js";
import { copyToClipboard as realCopyToClipboard } from "./copy.js";
import { openInEditor } from "./externalEditor.js";
import { STARTER_KEYBINDINGS, userBindingsPath } from "./keys/userBindings.js";
import { useBindingLookup } from "./keys/KeymapProvider.js";
import { backgroundHintText, expandHintText } from "./keys/hints.js";
import { NARROWED_SCOPE, RESUME_CANCELLED, type PreviewLoad, type ResumeScope } from "./sessionPickerModel.js";
import { hasWorktrees as realHasWorktrees } from "./worktrees.js";
import { clearViewport } from "./clearViewport.js";
import { DEFAULTS, summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel, resolveModelAlias, renameSession as realRenameSession, tagSession as realTagSession, getSessionInfo as realGetSessionInfo } from "../index.js";
import type { RawContextUsage, ListSessionsOpts } from "../index.js";
import { type HistEntry, type HistoryScope } from "./historySearch.js";
import { appendHistory, hydrateEntry, readHistory } from "./promptHistory.js";
import { substituteChips, assembleSubmission } from "./pasteChips.js";
import { IMAGE_VERSION_SKEW_NOTICE } from "../client/chatAdapter.js";
import { isEditableQueueEntry, joinQueuedForComposer, type QueueEntry } from "./queue.js";
import { composerMode } from "./promptMode.js";
import { buildStatusLinePayload, createStatusLineDriver, runStatusLine as realRunStatusLine, STATUS_LINE_MOUNT_CONTEXT_BUDGET_MS, type StatusLineConfig, type StatusLineDriver, type StatusLineDriverDeps, type StatusLineSnapshot, type StatusLineUsage } from "./statusLine.js";
import type { PromptLatch } from "../hooks/promptLatch.js";
import type { ComposerSubmission, PastedMap } from "./editor.js";

/** What became of ONE `resolveDecision` call (BL6 review Important 1). Three outcomes, and only the first
 *  means "this client's answer is the one that settled the park":
 *    · `settled` — the host applied our outcome. A caller may now act on the turn (the question decline
 *      interrupts here, and only here).
 *    · `already_answered` — another attached client won the race; `by` is who. Our keystroke changed nothing,
 *      so anything it would have done to the turn belongs to THEIR answer, not ours.
 *    · `failed` — the answer never landed: the request rejected (host death, the 10s deadline), the host
 *      reported no such park, or there was nothing parked locally to answer. The park may still be live
 *      host-side and the dialog stays up, so the turn must be left alone.
 *  A discriminated result and not a boolean: the three arms are three different truths about the same
 *  keystroke, and the callers that ignore it (every dialog but the question one) keep ignoring it. */
export type DecisionAnswerResult =
  | { status: "settled" }
  | { status: "already_answered"; by: string }
  | { status: "failed" };

// F1 Task 2 role map: every line useChat itself emits is themed — failures `error`, the `! command`
// echo `bashBorder`, and (W-C T14) the two queue warnings: the context escalation is `error`, the plan-usage
// one `warning` — running out of context IS a failure of the turn, running low on plan quota is not.
// Read per emission so a mid-session /theme change colors the next line correctly.
const role = (name: "error" | "bashBorder" | "warning") => resolveThemeColor(themeTokens()[name]);
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
export interface ChatState { sessionId?: string; staticItems: readonly RenderItem[];
  /** FSW Task 3: the WHOLE compact projection, of which `staticItems` is the committed head. The tail
   *  (everything whose id is not in `staticItems`) is what the render-time live window selects from — see
   *  `reconcile`. Consumers that want "the finalized transcript" want THIS; `staticItems` answers the
   *  narrower question "what has already been written to scrollback and can never be repainted". */
  finalizedItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: RenderLine[]; /** F10 T-HOVER: the streaming tier's hover unit for the CURRENT `streaming` snapshot. */ streamOwnerKey: string; pending: PendingDecision | null; mode: string; busy: boolean; /** W-C T8 — the engine's ai-title, read from disk once after the first turn (probe (d)). */ aiTitle?: string; /** W-C T8 — a successful `/rename`, which outranks `aiTitle`. */ renameTitle?: string; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[]; hasWorktree: boolean }; tasks: TaskItem[]; bgTasks: BackgroundTaskInfo[]; bgRows: BgTaskRow[]; bgPanelOpen: boolean; thinkLevel: string; /** W-C T11 (EP-C6): the session's live effort level, and whether the live model has the axis at all (undefined = the catalog has not answered yet). */ effort?: EffortLevel; effortSupported?: boolean; /** What the picker's/dialog's `(default)` clause compares against — see `DEFAULT_EFFORT`. */ defaultEffort: EffortLevel; effortDialog: { open: boolean; level?: EffortLevel; levels?: readonly EffortLevel[]; supported?: boolean; modelName?: string }; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[]; current?: string; sessionModel?: string; activeModel?: string; outputTokens?: number; ackedAt?: number }; commandCatalog: CommandEntry[]; queue: QueueEntry[];
  /** The composer's placeholder ladder reads both (`placeholder.ts` rule 4 — upstream's `submitCount` /
   *  `hasMessages`): how many prompts THIS client has sent, and whether the transcript holds any
   *  conversation message at all (a resumed or attached session does before the user types anything). */
  submitCount: number; hasMessages: boolean;
  staticEpoch: number; turnMeter: SpinnerMeter; rewindPicker: { open: boolean; anchors: RewindAnchor[] }; composerPrefill: { text: string; token: number; mode?: "replace" | "prepend"; pastedContents?: PastedMap } | null; rewinding: boolean; shortcutsOpen: boolean; helpOpen: boolean; historyOpen: boolean; addDir: { open: boolean; prefill?: string }; themeDialog: { open: boolean };
  /** bl8 T-ADVCMD Task 3 — the standalone `/advisor` dialog's open state, snapshotted at open time exactly
   *  like `effortDialog` (`openAdvisorDialog` below): `current` is the ref value in force when it opened
   *  (a resolved id, or undefined for off) and `mainModel` is the live model, for the dialog's own
   *  unsupported-model warning row. */
  advisorDialog: { open: boolean; current?: string; mainModel?: string }; bypassConsent: { open: boolean }; settings: { open: boolean; tab?: string }; outputStyle: string; showTurnDuration: boolean; /** F8 T6 — the `prefersReducedMotion` setting half; `motion.ts`'s `reducedMotion()` is the OR against the screen-reader signal readers actually want. */ prefersReducedMotion: boolean; /** T-CH34 — the `terminalProgressBarEnabled` setting; `ChatApp`'s progress-bar effect ANDs it with `busy` (canon's `m6h`). */ terminalProgressBarEnabled: boolean; /** F9 T-MOUSE Task 7 — the `copyOnSelect` setting; ChatApp's auto-copy latch reads it live on every selection change, never captured once. */ copyOnSelect: boolean;
  /** W-C T12 (EP-C5): the follow-up suggestion's four-state slice (`suggester.ts`). It lives HERE and not in
   *  the composer for two reasons that are the same reason: the composer is unmounted behind every dialog,
   *  and Ctrl-C clears its buffer — a suggestion owned there would die of both, where upstream's survives
   *  both because it is app state rendered as a placeholder. */
  promptSuggestion: PromptSuggestion; promptSuggestionEnabled: boolean; permissions: { open: boolean; tab?: string }; denials: DenialEntry[];
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
  /** WAVE C TASK 10 (EP-C2b): the statusLine script's last output, ANSI and all (`Footer.tsx` does the
   *  dim-forcing). Undefined before the first run lands — and undefined AGAIN after any run that fails or
   *  prints nothing: W2 T6 / spec D-W6 made failure remove the row, which is what canon does
   *  (`onResult` writes the runner's `undefined` straight into state, L484883, and the slot collapses to
   *  `null`, L484981). `Footer.tsx`'s existing `!== undefined` guard is the whole render half. */
  statusLineText?: string; }

// Tab cycles these; bypassPermissions stays off-cycle (/yolo). Single source with settingsRows.ts's own
// permissionMode row (review finding 3) — importing it here instead of a second literal array means the
// Tab ladder and the /config cycle order can never independently drift.
const LADDER = PERMISSION_MODE_OPTIONS;
/** Next mode on the Tab ladder; any off-ladder mode (e.g. bypassPermissions/dontAsk) re-enters at "default". */
function ladderNext(mode: string): string { const i = LADDER.indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  opts: { initialMode?: string; initialModel?: string;
    /** bl7 T-ADVISOR Task 3 (spec D15) / bl8 T-ADVCMD (D16): the client's OWN `config.advisorModel`,
     *  threaded down the SAME static-launch-fact path `initialModel` rides (`main.ts`'s `hookOpts` →
     *  `chatMain.tsx` → `ChatApp.tsx`'s `hookOpts` prop, spread into these `opts`) — but only as the SEED
     *  of `advisorModelRef` below, not the value itself: bl8 shipped `/advisor`, which changes it live, so
     *  the bl7 "session-constant, read once" premise this comment used to make is false now (D16 plan
     *  review F4). Absent on `ccx attach` (the host it joins may have configured its own, which this
     *  client cannot see): `projectionContext()` then omits `advisorModel` entirely, which is canon-legal
     *  (§3.2: `Tp ? … : null`). */
    initialAdvisorModel?: string;
    cwd?: string; initialResume?: InitialResume; initialThink?: string; /** W-C T11: the launch effort (`--effort` ?? DEFAULTS.effort), so the §C6.2 hint can post at mount. */ initialEffort?: string; initialOutputStyle?: string; initialShowTurnDuration?: boolean;
    /** T2 (F9 T-AUTO §A2): the launch's account token source (`AccountFacts.tokenSource`), threaded
     *  unmodified from `main.ts`'s own `accountInfo()` race all the way through `ChatClientOpts.hookOpts` →
     *  `ChatApp` props → here — the SAME field the welcome banner's billing label already reads, just handed
     *  down a second path so the auto-mode notice can pick its variant without a second engine round-trip.
     *  Absent on `ccx attach` (no launch config exists for an attach client) and on a resume/continue launch
     *  (the banner race is skipped there too) — both fall into the notice's unknown arm, which keeps the
     *  cost sentence. */
    initialTokenSource?: string;
    /** W-C T12: the `promptSuggestionEnabled` pref, resolved by the caller (`chatMain.tsx`) exactly as
     *  `initialShowTurnDuration` is. DEFAULT FALSE — see `suggester.promptSuggestionEnabled` for the
     *  deliberate polarity flip away from upstream's absent-means-on. */
    initialPromptSuggestionEnabled?: boolean;
    /** F8 T6: the `prefersReducedMotion` pref, resolved by the caller (`chatMain.tsx`) exactly as
     *  `initialShowTurnDuration` is — DEFAULT FALSE, canon's own polarity (bundle L507998). */
    initialPrefersReducedMotion?: boolean;
    /** T-CH34: the `terminalProgressBarEnabled` pref, resolved by the caller (`chatMain.tsx`) exactly as
     *  `initialShowTurnDuration` is — DEFAULT TRUE, canon's own polarity (`Vd("terminalProgressBarEnabled",
     *  !0)`, L563441). */
    initialTerminalProgressBarEnabled?: boolean;
    /** F9 T-MOUSE Task 7: the `copyOnSelect` pref, resolved by the caller (`chatMain.tsx`) exactly as
     *  `initialShowTurnDuration` is — DEFAULT TRUE, canon's own polarity (research r1-mouse.md §2.5). */
    initialCopyOnSelect?: boolean; initialEntries?: readonly TranscriptBootstrapEntry[]; initialPrompt?: string; onExit?: () => void; detach?: () => void; clearStaticTranscript?: () => void; noticeBridge?: { bind(push: (text: string) => void): void };
    /** WAVE C TASK 10: the resolved `statusLine` setting, or undefined for "not configured". RESOLVED BY THE
     *  CALLER (`chatMain.tsx`, exactly as `initialOutputStyle` is seeded from `loadPrefs()`), and for a
     *  reason beyond symmetry: canon L154558 honours only the USER settings file, so resolving it here would
     *  mean every test that mounts this hook reading — and running the command out of — the developer's real
     *  `~/.claude/settings.json`. One production call site owns that read; nothing below ever touches disk. */
    statusLine?: StatusLineConfig;
    /** WAVE 2 TASK 6 (EP-D4): the `UserPromptSubmit` latch that carries `transcript_path`/`prompt_id` from
     *  the engine's hooks to the statusLine payload. Created and registered by whoever OWNS the engine —
     *  `runForegroundImpl`, which builds the host config — so `ccx attach` passes none and both keys stay
     *  absent. See `hooks/promptLatch.ts` for why a hook is the only route. */
    promptLatch?: PromptLatch;
    /** F10 T-MAINT item 1: the LATE channel for the same fact `initialTokenSource` carries early — the
     *  LIVE, unraced `accountInfo()` promise, so a cold handshake that missed the banner's 1500 ms budget
     *  can still reach the auto-mode notice before ITS OWN (later, normative) deadline. See accountBridge.ts. */
    accountBridge?: AccountBridge;
    /** FSW TASK 5 (F9): the renderer decided ONCE at boot, with the reason word `/status` prints. RESOLVED BY
     *  THE CALLER (`chatMain.tsx`), like `initialOutputStyle` and `statusLine`, and for the stronger version
     *  of the same reason: the decision reads the real TTY, the real env and the prefs file, and re-deciding
     *  it here would let a `/status` in a test — or in a second call site — name a renderer other than the
     *  one that is actually painting. Absent for a hook mounted outside chatMain, which has no decision.
     *    FSW T15: it is the LIVE choice now, not the boot one — `ChatApp` overrides this field with its
     *  `renderer` prop, which `/tui` flips. Everything below reads it as "the renderer painting right now",
     *  which is what `/status` has always claimed to print. */
    rendererChoice?: RendererChoice;
    /** FSW T15 — `/tui`'s flip, owned above the tree (`chatMain`'s `ChatRoot`). See `ChatApp`'s prop of the
     *  same name for what it does and why it cannot live in here: the guard's bytes and the process-level live
     *  mode are `runChatClient`'s, and a hook cannot own either. Absent = save the setting and say so. */
    switchRenderer?: (tui: "fullscreen" | "default") => RendererChoice;
    /** EXTERNAL REVIEW, FINDING 3 — THE SAME LADDER, ASKED WITHOUT THE SIDE EFFECT. `switchRenderer` answers
     *  "what would happen" only by MAKING it happen; the busy gate below has to know before it decides whether
     *  there is anything to refuse. This is `RendererSwitch.select` (chatMain), so the answer comes from the
     *  one ladder walk the flip itself would perform — no second copy of its inputs (the real TTY, the real
     *  env, the cached tmux probe) down here, where none of them belong. Absent = no ladder to ask, and the
     *  gate falls back to comparing the setting, which is what it always did. */
    selectRenderer?: (tui: "fullscreen" | "default") => RendererChoice } = {},
  // `home`/`platform` are injectable for the same reason `now`/`columns` are: the frame-capture fixture has
  // to pin the whole ProjectionContext, and `homedir()`/`process.platform` read live from the host — which
  // made a golden comparison depend on who ran it (a `/Users/…` home leaking into a `~`-shortened path) and
  // on the runner's OS (the active leader glyph is `⏺` on darwin and `●` everywhere else).
  // `rows` (FSW Task 3) is `columns`'s sibling and exists for the same two reasons: the terminal HEIGHT is
  // now an input to the rendering boundary (it sets the live window's budget), and `ink-testing-library`'s
  // stdout stub reports no `rows` at all — so without a seam every component test would silently reconcile
  // against the 24-row POSIX default and no test could pin the boundary at any other geometry.
  deps: { now?: () => number; columns?: () => number; rows?: () => number; home?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; scheduleRepaint?: (cb: () => void, ms: number) => () => void; listSessions?: (scope?: ResumeScope) => Promise<SessionInfo[]>; readSessions?: (opts: ListSessionsOpts) => Promise<SessionInfo[]>; hasWorktrees?: (cwd: string) => Promise<boolean>; getSessionMessages?: (id: string, dir?: string) => Promise<any[]>; runBash?: (cmd: string, cwd: string) => Promise<BashResult>; clearScreen?: () => void; clearViewport?: () => void; copyText?: (t: string) => Promise<void>; writeFile?: (path: string, text: string) => void; readFile?: (path: string) => string | null; renameSession?: (id: string, title: string, dir?: string) => Promise<void>; tagSession?: (id: string, tag: string | null) => Promise<void>; getSessionInfo?: (id: string, dir?: string) => Promise<any>; settingsFileDeps?: SettingsFileDeps; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; openEditor?: (file: string, prepare: () => void) => "no-editor" | "opened" | "failed"; rewindReplayRetry?: { attempts: number; delayMs: number };
    /** Wave C Task 1/2: the notification queue. Injected so a test can drive its timers synthetically. */
    notifications?: NotificationStore;
    /** Wave C Task 7: the duration row's verb. Upstream picks it uniformly at random (`SvH`), which would
     *  make every expected string in a test a regex — so the pick is a seam, exactly like `now`. */
    pickTurnVerb?: () => string;
    /** Wave C Task 12: how the follow-up suggester is built. Injected so a unit/tui test drives the whole
     *  turn-end trigger, the eligibility chain and the retire/respawn lifecycle without ever spawning an
     *  engine — the real factory (default) opens a warm Haiku-class session on first use. */
    createSuggester?: (o: { cwd: string }) => Suggester;
    /** TOOL-STREAM TASK 5: which renderer this hook's projections are painting into — a FUNCTION, sampled at
     *  projection time, because `/tui` moves the answer under a live conversation. Supplied by `ChatApp` from
     *  its own `renderer?.mode === "fullscreen"` derivation and absent everywhere else (embedders, the hook's
     *  own tests), where absent means classic and the whole fold policy stays frozen at what it shipped.
     *    DELIBERATELY NOT `opts.rendererChoice`, which this hook also receives. That field is assembled once
     *  in `runChatClient` and can be absent on a mount that is nonetheless painting fullscreen, while the
     *  ChatApp prop it comes from is the live value the fullscreen tree itself is mounted on. Two channels for
     *  one fact reads like an oversight, so: `rendererChoice` answers "/status, what did we boot as", this
     *  answers "what is on screen right now", and only the second may decide how a row folds. */
    isFullscreen?: () => boolean;
    /** WAVE C TASK 10: the statusLine driver's own seams — a fake runner (so a test never forks a shell) and
     *  the two timers its 300 ms debounce and its `refreshInterval` poll run on. Supplying `runStatusLine`
     *  REPLACES the wrapper below that carries cwd/env/COLUMNS/LINES, which is the point: the wrapper is the
     *  only thing between this hook and a real child process. */
    statusLine?: StatusLineDriverDeps;
    /** F8 T11: Task 10's OS-notification sender, wired to the two seams that mean "ccx wants you" — a
     *  permission park and an empty-queue settle. Absent everywhere but the real chatMain boot (every test
     *  here, every embedder), where absent means neither seam fires anything. */
    notifier?: DesktopNotifier } = {},
) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  const cwd = opts.cwd ?? process.cwd();
  // bl8 T-ADVCMD (D16, plan review F4): a REF now, not the bl7 plain const — `/advisor` (below) writes it
  // live, and `projectionContext()` is read by callbacks that outlive the render that created them (the
  // SAME reason `bashHintRef`/`expandHintRef`/`isFullscreenRef` above are refs and not their own bare
  // values): a mount-time closure over a plain const would keep rendering the LAUNCH advisor forever, no
  // matter how many times `/advisor` changed it. `applyAdvisor` writes this FIRST, then calls `reconcile()`
  // so the change repaints without waiting for a document revision (F4's other half is `toolRenderer.ts`'s
  // `knobKey`, which must include this value too — see its own comment).
  const advisorModelRef = useRef(opts.initialAdvisorModel);
  const nowFn = deps.now ?? (() => Date.now());
  const columnsFn = deps.columns ?? (() => process.stdout.columns ?? 80);
  const rowsFn = deps.rows ?? (() => process.stdout.rows ?? 24);
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
  // Same ref discipline, same reason (the projection is driven by callbacks that outlive the render that made
  // them) — and one more: a `/tui` flip moves this answer on a LIVE session without unmounting anything, so a
  // reader captured at mount would keep folding for the renderer the session started on.
  const isFullscreenFn = deps.isFullscreen ?? (() => false);
  const isFullscreenRef = useRef(isFullscreenFn); isFullscreenRef.current = isFullscreenFn;
  /** TOOL-STREAM TASK 5 — WHERE THE TWO HALVES OF THE FULLSCREEN SWITCH ARE SET, and the only place they are
   *  set together. `fullscreen` widens the FOLD POLICY (Task 3/4's classification, segmentation and clauses);
   *  `expandHint: ""` is the BLANKET CHIP SUPPRESSION, and it is one ternary because the three-state `""`
   *  contract in `keys/hints.ts` already does the rest — every consumer of the hint (the group row, the
   *  agent-progress `… +N tool uses` marker, the agent-batch header, the `Backgrounded agent` hint, the
   *  truncated-API-error offer) drops its clause on `""` rather than printing a dead chord. That is canon's
   *  own shape: the chip is killed once, in the `Ett` context the virtual list provides (2.1.234:506706,
   *  549824), and its consumer `Wv` returns null (511132) — not switched off at each site.
   *    IT REACHES `detailItems` TOO, so the ctrl+o pager loses the same clauses in fullscreen. Canon-faithful,
   *  not a leak: `Ett` wraps the overlay as well (grounding §7).
   *    THE OVERRIDE IS T5b's, AND IT IS THE ONLY CALLER THAT MAY PASS ONE. `/tui`'s re-fold has to project for
   *  the renderer that is about to be painting rather than the one that still is: the whole point of the
   *  ordering it runs under (see `refoldFor`) is that the re-projection lands on the side of the flip where
   *  the `<Static>` is holding nothing, which means it necessarily runs while the ref still answers the OLD
   *  screen. Absent — every other caller — the ref remains the sole authority. */
  const projectionContext = (fullscreenOverride?: boolean): ProjectionContext => {
    const fullscreen = fullscreenOverride ?? isFullscreenRef.current();
    return { cwd, home, platform, columns: columnsFn(), now: nowFn(), thoughtMs: thoughtMsRef.current, pending: pendingStateRef.current!, agentMeta: agentMetaRef.current, bashHint: bashHintRef.current, expandHint: fullscreen ? "" : expandHintRef.current, fullscreen, expandedFolds: expandedFoldsRef.current, expandedItems: expandedItemsRef.current, hookRuns: hookTrackerRef.current!.entries(), ...(advisorModelRef.current !== undefined ? { advisorModel: advisorModelRef.current } : {}) };
  };
  /** TOOL-STREAM TASK 8 — WHICH CLUSTERS THE READER HAS OPENED, keyed by fold ANCHOR (`FoldGroup.anchorId`,
   *  the run's earliest-issued call).
   *  A ref rather than state, on the same rule as `thoughtMs`/`agentMeta`: it is read at projection time by
   *  callbacks that outlive the render that made them, and a re-render is not what makes it visible —
   *  `reconcile()` is, and `toggleFold` calls it. Keyed on the anchor and not on the group's ITEM id because
   *  that id is derived from the whole membership: a cluster the turn is still growing would re-key on every
   *  absorbed call and close itself under the reader's cursor. E1 closed the other half of that same hole —
   *  membership also REORDERS as overlapping members settle, which is why the anchor is call order and not
   *  `memberIds[0]`. */
  const expandedFoldsRef = useRef<Set<string>>(new Set());
  /** Open a cluster, or close it. The re-projection is `reconcile()` and it must be — a still-growing run is
   *  WITHHELD from Static and lives in the pending projection, so re-projecting the finalized document alone
   *  would leave a live cluster collapsed with nothing left to correct it: once every member has settled and
   *  no breaker has closed the run, there is no further blink and no further append. `reconcile` re-projects
   *  both, which is exactly the pair a toggle can move. */
  function toggleFold(anchor: string): void {
    if (disposed.current) return;
    if (!expandedFoldsRef.current.delete(anchor)) expandedFoldsRef.current.add(anchor);
    reconcile();
  }
  /** T-CLICKGATE Task 3 — WHICH TOOL RESULTS THE READER HAS CLICKED OPEN, keyed by `toolOwnerKey(event.id)` —
   *  a SEPARATE set from `expandedFoldsRef` (`ProjectionOptions.expandedItems`'s own doc: an anchor names a
   *  RUN, an owner names one CALL, and the two affordances must not share a namespace). Same ref-not-state
   *  shape and the same `reconcile()` re-projection as `toggleFold`, and for the identical reasons: a
   *  still-growing pending region needs the SAME re-projection a settled Static row does, and nothing on
   *  screen renders differently for the ref itself, only for what `reconcile()` produces from it. */
  const expandedItemsRef = useRef<Set<string>>(new Set());
  function toggleItemExpand(ownerKey: string): void {
    if (disposed.current) return;
    if (!expandedItemsRef.current.delete(ownerKey)) expandedItemsRef.current.add(ownerKey);
    reconcile();
  }
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
  // bl7 T-HOOKBLOCK Task 1: the same live-only rule as `thoughtMsRef` above, for hook timing instead of
  // thinking duration — P116 found the wire carries no duration and no tool_use_id, so pairing/stamping
  // happens here at arrival and a rebuilt transcript (resume/rewind/attach) has no source to recover it
  // from. Lazily constructed for the same reason `pendingStateRef` below is.
  const hookTrackerRef = useRef<HookPairTracker | null>(null);
  if (hookTrackerRef.current === null) hookTrackerRef.current = new HookPairTracker();
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
  // ── FSW Task 3: the rendering boundary, in two phases ─────────────────────────────────────────────────
  /** The hard bound on the live (re-rendered) subtree, in physical rows: what the terminal has left once the
   *  dock is paid for, LESS `WINDOW_SLACK`. The subtraction is the whole safety margin — `mainWindowCap`
   *  measures the dock at its maximum, so a window filled to that cap under a maximal dock sums to exactly
   *  `rows` and takes Ink's tall-frame branch. Read live (never captured): commit is settle-driven, so the
   *  honest budget is the one the terminal has at the moment something settles. */
  const commitCap = (): number => Math.max(0, mainWindowCap(rowsFn()) - WINDOW_SLACK);
  /** …and the unit that budget is spent in (FSW backlog 3): PAINTED rows at the width the classic renderer
   *  is currently painting, not logical lines. This has to be the measure ChatApp's render-time window uses,
   *  because the two walks decide the same cut from opposite ends — a commit that counted a wrapped
   *  paragraph as one row would publish a different tail than the frame shows, and publication is a one-way
   *  write into `<Static>`. Read live, for the same reason `commitCap` is. */
  const commitHeightOf = (item: RenderItem): number => paintedHeight(item, columnsFn());
  /** The FULL compact projection, retained rather than discarded. It is what the render-time window is
   *  selected from (ChatApp), and `staticItems` is now strictly its committed HEAD rather than all of it. */
  const initialFinalized = useRef<readonly RenderItem[] | null>(null);
  if (initialFinalized.current === null) initialFinalized.current = projectCompact(documentRef.current!, projectionContext());
  const [finalizedItems, setFinalizedItems] = useState<readonly RenderItem[]>(initialFinalized.current);
  /** The same list as a ref, for `publishLiveWindow` below — it is called from a passive effect in ChatApp,
   *  which is one commit later than the render whose closure it would otherwise read. */
  const finalizedRef = useRef<readonly RenderItem[]>(initialFinalized.current);
  // THE MOUNT PUBLISH IS THE SAME SPLIT, not a special case: a resumed or attached session used to dump its
  // whole history into <Static> here, which put the tail out of reach of reflow before the first frame was
  // ever painted. Only what the window cannot hold is published; the rest is live from the start.
  const [staticItems, setStaticItems] = useState<readonly RenderItem[]>(() => {
    const cap = commitCap();
    const { commit } = selectLiveWindow(initialFinalized.current!, cap, cap, commitHeightOf);
    for (const item of commit) publishedIds.current.add(item.id);
    return commit;
  });
  const [pendingItems, setPendingItems] = useState<readonly RenderItem[]>(() => livePending());
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  // F10 T-HOVER: the streaming tier's hover unit — `LiveTurn.messageKey()` at the moment each snapshot was
  // taken, so hover survives every delta of one message and changes exactly when the message does.
  const [streamOwnerKey, setStreamOwnerKey] = useState(mintStreamOwnerKey("#0"));
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
  /** WAVE C FINAL REVIEW, finding 5 — the generation the latch above belongs to, bumped at every conversation
   *  boundary (`replaceDocument`). The fetch is a DISK READ of unbounded latency and the only thing it used to
   *  check on the way back was `disposed`, so a read started for the session we just left could land after a
   *  resume/clear had already published the NEW session's title and overwrite it — with the statusLine's
   *  `session_name` riding along. The idiom is the repo's own (`suggester.ts`'s `q1t`: capture at request,
   *  compare on return, drop on mismatch). */
  const titleGen = useRef(0);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  // WAVE C TASK 14 (spec D-C3): the plan-usage warning is a QUEUE entry now, not a status-bar chip — the bar
  // it lived on retired with Task 2. `usageFormat.usageWarning()` still mints the text; only the consumer
  // moved. A REF, not state: nothing renders it any more, and the only question at each refresh is whether
  // the text CHANGED — re-posting an unchanged warning every turn would restart its timer forever and pin
  // the slot against every other hint that wants it.
  const usageWarnRef = useRef<string | undefined>(undefined);
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
  //   …and whether that ONE call has come back AT ALL, either way. A latch and not `effortCaps.size > 0`,
  // because a catalog that answered with no models and a catalog that has not answered yet are both an empty
  // map and they mean opposite things. Set in BOTH arms of the fetch (see the effect): success settles it,
  // and so does failure — an unanswerable capability is UNKNOWN support, never absent support.
  const [effortCapsSettled, setEffortCapsSettled] = useState(false);
  //   Tri-state ON PURPOSE, and the three states are "the catalog has not answered yet" (undefined, treated
  //   as "assume it has one"), "the catalog answered and this model has the axis", and "the catalog answered
  //   and it does not".
  //   W2 T5 (s2qa4-06) CORRECTED WHICH ANSWER IS WHICH. The map holds an entry for every row the catalog
  //   returned, whether or not that row carried `supportsEffort` — so "no entry" is still not-yet-answered,
  //   but an entry WITHOUT the field is the catalog having answered by omission. Probe 103: live, every row
  //   states `supportsEffort: true` plus `supportedEffortLevels` except haiku, which carries neither. Hence
  //   `=== true` and not `!== false`: the old polarity read haiku's silence as consent and is what let the
  //   §C6.2 hint and the `/status` block claim an effort axis on a model that has none.
  //   DIVERGENCE, timing only: upstream answers this synchronously — `Fk(model)` (L76243) is a local model
  // registry, so a model without an effort axis never shows the hint for even one frame. ccx has no such
  // registry; the only authority is `capabilities().models[].supportsEffort`, one round-trip after mount.
  // ccx reaches upstream's OUTCOME by waiting for that round-trip (`effortCapsSettled` gates the hint's
  // effect) rather than by posting optimistically and withdrawing, which would have flashed a wrong hint for
  // a second or three on exactly the models upstream never hints on. The wait costs nothing on supported
  // models — the hint's ten-second clock is restarted by the catalog-landing render either way — and costs
  // nothing on a FAILED fetch either, because failure settles the latch too.
  const effortSupported: boolean | undefined = effortCap === undefined ? undefined : effortCap.supportsEffort === true;
  const effortLevels: readonly EffortLevel[] = effortCap?.levels ?? EFFORT_LEVELS;
  /** W2 T5 (review M2) — THE ONE CAPABILITY GATE EVERY REPORTING SURFACE READS. Both `/status` call sites
   *  spread this; the statusLine payload below applies the same rule inline (its shape is a flat `effort`
   *  key, not this pair). They disagreed before: the payload was gated and `/status` was not, so on a model
   *  the catalog says has no effort axis a script printed no block and `/status` printed a row.
   *  `effortSupported === false` is the ONLY thing that drops the row — an unanswered catalog is unknown
   *  support, and `formatStatus`'s own `default` fallback covers a session that has no level yet. */
  const statusEffort = (): { effort?: EffortLevel; effortSupported?: false } =>
    effortSupported === false ? { effortSupported: false } : (effort ? { effort } : {});
  /** FSW T5 — the same one-helper-two-surfaces rule `statusEffort` above exists for, applied to the renderer
   *  row: `/status` and the Settings dialog's Status tab both spread this, so neither can grow a reading the
   *  other lacks. A CONSTANT for the life of the process (the decision is made once at boot and a resize
   *  never re-runs it, spec §L2.1), so unlike `statusEffort` it closes over nothing that moves. */
  const statusRenderer = (): { renderer?: RendererChoice } => opts.rendererChoice ? { renderer: opts.rendererChoice } : {};
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
  // bl8 T-ADVCMD Task 3: /advisor overlay, snapshotted at open time exactly like `effortDialog`.
  const [advisorDialog, setAdvisorDialog] = useState<{ open: boolean; current?: string; mainModel?: string }>({ open: false });
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
  //   The third guard is ccx's, and it is the timing divergence `effortSupported` describes: upstream knows
  // the answer synchronously, ccx has to ask, so it says nothing until the asking is over. `effortCapsSettled`
  // is a one-way latch, so this delays only the FIRST post of a session — a later `/effort` re-posts at once.
  useEffect(() => {
    notifications.remove(EFFORT_HINT_KEY);
    if (!effortCapsSettled || !effort || effortSupported === false) return;
    notifications.add({ key: EFFORT_HINT_KEY, text: effortHint(effort), priority: "high", timeoutMs: EFFORT_HINT_TIMEOUT_MS });
  }, [effort, effortSupported, effortCapsSettled, notifications]);
  // bl8 T-ADVCMD Task 4 (spec §3.4, A12) — THE ADVISOR STARTUP NOTIFICATION. Unlike the effort hint above,
  // canon's own version (`jxe` @178890000) re-derives on every advisorModel/mainLoopModel change and
  // re-posts on a state FLIP; spec §3.4 narrows ccx's copy to a ONE-SHOT launch-time nudge off whatever
  // `initialAdvisorModel` seeded `advisorModelRef` — a later `/advisor` gets its own feedback line
  // (`applyAdvisorChoice`'s `message`), so this effect never re-arms. `[]` deps + the ref guard is the same
  // shape as the `noticeBridge` bind above: read once, off the mount-time closure over `model` (the launch
  // main model) and `advisorModelRef.current` (the launch advisor), never re-triggered by a later render.
  //   Follow-up fix (three-state gate): canon's `M8` gate — a main model with NO rank entry at all does not
  // support the advisor and must get no notice — was left to consuming code by design (advisorModel.ts's own
  // comment on `applyAdvisorChoice`); this is that wiring. The `supportsAdvisor` guard below closes it,
  // ahead of the `canAdvise` paired/unpaired branch so an unsupported main model short-circuits before
  // either text is chosen.
  const advisorNoticeShown = useRef(false);
  useEffect(() => {
    if (advisorNoticeShown.current) return;
    advisorNoticeShown.current = true;
    const advisor = advisorModelRef.current;
    if (!advisor) return;
    if (!supportsAdvisor(model ?? "")) return;
    const text = canAdvise(model ?? "", advisor) ? ADVISOR_NOTICE_PAIRED_TEXT : ADVISOR_NOTICE_UNPAIRED_TEXT;
    notifications.add({ key: ADVISOR_NOTICE_KEY, text, priority: "medium" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only, see comment above
  // Wave C Task 6: the spinner reads a METER, not a token count — the parenthetical needs the streamed
  // character target (for the eased estimate), the stream mode (for the arrow) and the tool/thinking
  // windows (for the phase ladder). All four come off the one `LiveTurn` that already consumes the frames.
  const [turnMeter, setTurnMeter] = useState<SpinnerMeter>(IDLE_METER);
  // Prompts/turns submitted while busy; drained FIFO on turn end, or ALL AT ONCE back into the composer on
  // Up/ctrl+p (F5 task 8, CM48). `QueueEntry` (queue.ts) is upstream's own record shape — the raw text with
  // its prefix, the mode that text implies, the priority rung, and the paste map an entry was composed with.
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef<QueueEntry[]>([]); queueRef.current = queue;
  const queueSeq = useRef(0);   // F10 T-HOVER (r3): mints each QueueEntry.id — monotonic, never reset
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
  // ── F8 Task 6: reduced motion ────────────────────────────────────────────────────────────────────────
  // Seeded by the caller exactly as `showTurnDuration` above is, and for the same reason: `chatMain` loads
  // the prefs file once, before the first render. Held in state from mount on: the /config row toggles this
  // and writes the file behind it, and `motion.ts`'s `reducedMotion()` OR's it against the screen-reader
  // env signal at every read site — this state carries only the setting half.
  const [prefersReducedMotion, setPrefersReducedMotionState] = useState<boolean>(opts.initialPrefersReducedMotion ?? false);
  // ── T-CH34: the terminal progress bar's setting ─────────────────────────────────────────────────────
  // `prefersReducedMotion`'s shape exactly, one polarity flipped: canon's own DEFAULT TRUE (`Vd(..., !0)`,
  // L563441). Held in state from mount on: the /config row toggles this and writes the file behind it, and
  // `ChatApp`'s progress-bar effect reads it live on every turn-lifecycle change — never captured once.
  const [terminalProgressBarEnabled, setTerminalProgressBarEnabledState] = useState<boolean>(opts.initialTerminalProgressBarEnabled ?? true);
  // ── F9 T-MOUSE Task 7: the `copyOnSelect` setting ───────────────────────────────────────────────────
  // `terminalProgressBarEnabled`'s shape exactly, same DEFAULT TRUE polarity: canon's own `ar().copyOnSelect
  // ?? !0` (research r1-mouse.md §2.5). Held in state from mount on: the /config row toggles this and writes
  // the file behind it, and `ChatApp`'s auto-copy latch reads it live on every selection change.
  const [copyOnSelect, setCopyOnSelectState] = useState<boolean>(opts.initialCopyOnSelect ?? true);
  const pickTurnVerb = deps.pickTurnVerb ?? realPickTurnVerb;
  // The turn's own wall clock, and its disqualifier. Both are REFS, not state: they are written and read
  // inside the `onSessionEvent` closure, which is created once per session — a state read there would be one
  // render stale, and `turnStartedAt` (the spinner's clock) is already exactly that shape for that reason.
  // `undefined` start = no turn is being clocked, which is what the bare-truncated idle follow tail leaves.
  const turnStartRef = useRef<number | undefined>(undefined);
  const turnDisqualifiedRef = useRef(false);
  // F8 T11 review finding B: the notification's own latch, on the SAME idiom as `turnStartRef` above
  // (armed at turn:start, consumed exactly once at turn:end) — but a DIFFERENT ref, because `turnStartRef`
  // is already legitimately `undefined` on a genuine first end that never got a clock (a mid-turn joiner's
  // replay-cleared start, or the bare-truncated idle follow tail) and reusing it here would wrongly swallow
  // the notification for those real cases, not just a redelivered one.
  const turnEndNotifiedRef = useRef(false);
  // ── Wave C Task 12 (EP-C5): the follow-up suggestion ─────────────────────────────────────────────────
  // Seeded by the caller for the same reason `showTurnDuration` above is, and OFF unless the caller says
  // otherwise (`suggester.promptSuggestionEnabled` owns the polarity). Everything else here is a ref, because
  // every reader is inside the `onSessionEvent` closure — created once per session, so a state read there
  // would be one render stale, which for the eligibility chain would mean generating against the setting the
  // session was mounted with rather than the one the user just toggled.
  const [promptSuggestionEnabled, setPromptSuggestionEnabledState] = useState<boolean>(opts.initialPromptSuggestionEnabled ?? false);
  const promptSuggestionEnabledRef = useRef(promptSuggestionEnabled); promptSuggestionEnabledRef.current = promptSuggestionEnabled;
  const [promptSuggestion, setPromptSuggestion] = useState<PromptSuggestion>(EMPTY_SUGGESTION);
  const promptSuggestionRef = useRef(promptSuggestion); promptSuggestionRef.current = promptSuggestion;
  /** ONE suggester per REPL session, built lazily on the first eligible turn end and retired at every
   *  conversation boundary — never at boot, so a session that never earns a suggestion never opens an
   *  engine (and with the setting off, `maybeRequestSuggestion` returns before this is ever called). */
  const suggesterRef = useRef<Suggester | null>(null);
  const makeSuggester = deps.createSuggester ?? ((o: { cwd: string }) => realCreateSuggester({ cwd: o.cwd }));
  /** What the request carries. Grown as this CLIENT sees the conversation — its own submitted prompts and the
   *  assistant text that came back — rather than harvested from the retained document, which would mean
   *  re-deriving roles out of raw SDK frames on a path that already has both facts in hand.
   *  RECORDED CONSEQUENCE: on a resumed or attached session the ring starts empty, so `assistantSeen` below
   *  counts from zero and the first suggestion waits for two fresh assistant turns. That is the honest
   *  reading — the tail we could send is likewise empty, and a suggestion generated from nothing is worse
   *  than none. */
  const suggestionTailRef = useRef<TailMessage[]>([]);
  const assistantSeenRef = useRef(0);
  function noteTail(role: TailMessage["role"], text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (role === "assistant") assistantSeenRef.current++;
    // Capped at the source: the ring is trimmed to the formatter's own per-message budget so a 200 KB pasted
    // prompt cannot sit in memory for the rest of the session waiting to be truncated at format time.
    suggestionTailRef.current = [...suggestionTailRef.current, { role, text: trimmed.slice(0, TAIL_MESSAGE_CHARS) }].slice(-12);
  }
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
  /** WAVE C FINAL REVIEW, finding 4 — `dir` is the row's OWN project directory, threaded exactly the way
   *  `getSessionMessages`/`renameSessionFn` above already thread it. The store is per-directory, so once
   *  Ctrl+A has widened the resume picker past this project a row read under `opts.cwd` simply is not there:
   *  the transcript was found under `/elsewhere`, the title lives under `/elsewhere`, and looking for it here
   *  found nothing and left the tab naming the session we had just left. */
  const getSessionInfoFn = deps.getSessionInfo ?? ((id: string, dir?: string) => realGetSessionInfo(id, { cwd: dir ?? opts.cwd }));
  /** WAVE C TASK 8 — the once-per-session read of the engine's ai-title, called from the first `turn:end`.
   *  Silent on failure by design: an unreadable session file must cost the terminal title nothing (and must
   *  certainly not become a transcript notice), so the tab simply keeps whatever it already said. The
   *  `fetched` latch is set BEFORE the await so two turn ends racing on the same tick cannot both read.
   *
   *  `sessionId` is a PARAMETER because `resumeInto`'s caller has the new id and this closure does not: inside
   *  that function `session` is still the object being swapped out, so an un-parameterized call there would
   *  read the title of the conversation we just left. `dir` rides with it for the same reason and one more
   *  (final review, finding 4): a cross-project pick names a directory this REPL's `opts.cwd` is not.
   *
   *  THE GENERATION GUARD (final review, finding 5) is what makes the two safe together: the id/dir pair is
   *  captured at fetch time and so is `titleGen`, and a read that returns after the boundary has moved on is
   *  dropped instead of publishing a dead conversation's title over the live one.
   *
   *  RETURNS ITS PROMISE (W2 A8) so the turn's one status-line refresh can wait for it — see
   *  `statusRefreshAfterTurn`. Every caller may still ignore it; a latched or id-less call is already
   *  settled. */
  const adoptAiTitle = (sessionId?: string, dir?: string): Promise<void> => {
    const id = sessionId ?? session.sessionId;
    if (aiTitleFetched.current || !id) return Promise.resolve();
    aiTitleFetched.current = true;
    const gen = titleGen.current;
    return getSessionInfoFn(id, dir).then(
      (info) => { if (disposed.current || gen !== titleGen.current) return; const t = (info as any)?.customTitle ?? (info as any)?.summary; if (typeof t === "string" && t.trim()) setAiTitle(t.trim()); },
      () => {},
    );
  };
  const lastAssistant = useRef<string[]>([]);    // recent assistant replies' text, NEWEST FIRST, for /copy [N] (ring, cap RECENT_ASSISTANT_CAP)
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
  /** WAVE 2 TASK 6 / SPEC D-W4 — `session_id`, MINT AND RECONCILE.
   *
   *  Canon's `session_id` is never null and never stale: `It()` reads a uuid minted into the initial state
   *  object at process start (L1667), and `/clear` ROTATES it (`UHi()`, L1685 — the `095baa0c… → a02ce69d…`
   *  the sweep watched). The id is therefore CLIENT-minted upstream, not engine-minted, which is why it can
   *  exist before any engine does.
   *
   *  ccx's engine id cannot do that job on its own: the SDK hands one back only at the first `system/init`
   *  frame (`session/session.ts`, mirrored by the adapter off the `state` event), and `/clear` deliberately
   *  NULLS the adapter's copy (`chatAdapter.ts`, so a discarded conversation's id never reaches `/export`,
   *  `/rename` or the wire). Reporting nothing at launch and nothing after a clear is the gap s2qa6-04
   *  filed; reporting the OLD id would be the Wave S measurement-dies-with-its-conversation violation.
   *
   *  So: this ref is a client uuid minted at mount and re-minted at every `replaceDocument`, and the
   *  snapshot below prefers the ENGINE's id whenever there is one. The observable sequence is a named
   *  identity swap — pre-turn the payload carries the minted id, post-turn the engine's — and it is pinned
   *  as such. WHAT IT MEANS TO A SCRIPT, stated plainly because it is a contract change: `session_id` is
   *  "the identity of the conversation on screen", which BECOMES the engine's session id once one exists.
   *  A script correlating the field with a `~/.claude/projects/**.jsonl` file should wait for a payload
   *  that also carries `transcript_path`. */
  const statusSessionIdRef = useRef<string>("");
  if (!statusSessionIdRef.current) statusSessionIdRef.current = randomUUID();
  /** model id → the catalog's display name, harvested from the ONE `capabilities()` call the command palette
   *  already makes (below). Without it `display_name` could only repeat the id; with it the payload carries
   *  what a status line actually wants to print. Empty until that fetch lands, and empty forever if it fails. */
  const modelNamesRef = useRef<Map<string, string>>(new Map());
  const statusDriverRef = useRef<StatusLineDriver | null>(null);
  const pokeStatusLine = (reason: string): void => { statusDriverRef.current?.poke(reason); };
  /** ccx state → the snapshot the payload builder reshapes. Rebuilt per RUN (the driver calls it inside
   *  `execute`), so a run always carries the state at its own moment. */
  function statusSnapshot(): StatusLineSnapshot {
    // W2 T6: the two hook-fed facts. Absent before the first prompt of the conversation and absent again
    // after a boundary clears the latch — `buildStatusLinePayload` spreads them conditionally, so the keys
    // are genuinely missing rather than present-and-null.
    const prompt = opts.promptLatch?.read() ?? {};
    return {
      // D-W4, mint and reconcile: the engine's id the moment there is one, this client's minted identity
      // until then. Never the previous conversation's — `replaceDocument` re-mints on the same line it
      // nulls the readings.
      sessionId: session.sessionId ?? statusSessionIdRef.current,
      ...(prompt.transcriptPath ? { transcriptPath: prompt.transcriptPath } : {}),
      ...(prompt.promptId ? { promptId: prompt.promptId } : {}),
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
      // has SAID has no effort axis reports no block at all — same rule the hint follows one screen up, and
      // (since review M2) the same rule `/status` follows through `statusEffort`, so the row a script prints
      // and the row the user reads can never disagree.
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
    // WAVE 2 TASK 6 / SPEC D-W8 — THE MOUNT-TIME CONTEXT READING, and the ONE extra read this task adds.
    //
    // `context_window_size` was 0 on every payload until the first turn ended, because `statusCtxRef` had
    // exactly two writers (turn end and `/compact`) and a zero window nulls both percentages too. Canon
    // reports the real window from frame one — for it the number is a MODEL PROPERTY (`XS(y, OA())`), not a
    // measurement, and no SDK surface exposes that property to ccx: `ModelInfo` carries no context-window
    // field, and `usage()`'s `contextWindow` only exists after a turn. The one route left is to MEASURE
    // early, which probe 103 (`probes/probes/103-preturn-context-and-model-caps.ts`, run live) proved is
    // available: `getContextUsage()` RESOLVES before the first turn with a real `maxTokens` and a
    // near-zero `totalTokens`. The alternative — hardcoding 1000000 — would be a guess on the wire.
    //
    // AT MOUNT ONLY, and the boundary is deliberately NOT a second site. Wave S's rule stands: after
    // `replaceDocument` the number stays hidden until the next turn measures a real one, because a
    // conversation swap is exactly when a reading describes something that is gone — and a call issued at
    // the boundary races the engine swap that boundary exists to perform, so it could answer for either
    // conversation. s2qa5-10 (the post-`/clear` zero) stays in the backlog with that as its answer.
    //
    // THE BOOT RUN WAITS FOR THAT READ, RACED AGAINST A CAP (Task 6 review MAJOR 1, spec D-W11). Shipping
    // the read as a fire-and-forget beside an already-debounced `mountRun()` was not enough: the review timed
    // `getContextUsage()` at ~1.2 s warm, four times the 300 ms window, so a live boot ran the script TWICE
    // and the first payload carried the `context_window_size: 0` this whole step exists to remove. Gating the
    // boot run on the read gives back the one-run cadence AND a real window; racing the gate against
    // `STATUS_LINE_MOUNT_CONTEXT_BUDGET_MS` is what stops a control call that never answers from suppressing
    // the row for the rest of the session — the cap losing means the boot run goes out with the zero window
    // it used to have, and the first turn end corrects it. Canon needs none of this because its window size
    // is a client-side model constant; that difference is the recorded divergence, and its price is a first
    // status row up to ~1.5 s after mount.
    //   THE DRIVER IS PUBLISHED AT THE SAME MOMENT, and that is what makes "one boot run" true rather than
    // merely likely. `statusDriverRef` is what `pokeStatusLine` writes through, and ccx's boot deltas — the
    // catalog settling `effortSupported`, the host's first `state` frame moving `mode` — each poke on their
    // own schedule. Left attached during a 1.2 s read, any one of them opens a 300 ms window of its own and
    // fires the very run (zero window, then corrected) this gate exists to prevent. Dropped instead: the
    // boot run that follows is built from the snapshot at ITS moment, so every delta that landed while the
    // gate was shut is already in it, and nothing is lost but the row appearing a few hundred ms sooner.
    const armCap = deps.statusLine?.setTimeout ?? ((fn: () => void, ms: number): unknown => { const h = setTimeout(fn, ms); h.unref?.(); return h; });
    const disarmCap = deps.statusLine?.clearTimeout ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });
    let capTimer: unknown, unmounted = false;
    const capped = new Promise<void>((resolve) => { capTimer = armCap(() => { capTimer = undefined; resolve(); }, STATUS_LINE_MOUNT_CONTEXT_BUDGET_MS); });
    //   AND THE READ IS QUIET, WHICHEVER SIDE WINS (external review, finding A). `refreshCtx`'s own poke is
    // dropped while the gate is shut (the driver is not published yet), but the CAP publishes it — so a read
    // that answers after the cap poked the driver it had just been handed, and the boot the gate exists to
    // hold to one run went out as two: the zero-window row, then its correction. The reading is still kept;
    // it reaches the payload through the next trigger, exactly as the cap's own comment above promises.
    void Promise.race([refreshCtx({ quiet: true }), capped]).then(() => {
      if (capTimer !== undefined) { disarmCap(capTimer); capTimer = undefined; }
      if (unmounted) return;                              // a hook torn down mid-read leaves the ref null
      statusDriverRef.current = driver;                   // the gate opens: pokes reach the driver from here
      driver.mountRun();                                  // §C2.4 trigger 1 — see `mountRun`'s own doc (W2 T6)
    });
    // Because `refreshCtx` is the shared wrapper, the launch frame's `ctx N%` chip becomes honest at the same
    // time — but ONLY in a session that configures a status line, which used to be a visible asymmetry. It no
    // longer is: `/status` measures for itself (D-W11's companion, at the command switch below), so the one
    // surface that shows the number pre-first-turn shows it either way.
    return () => { unmounted = true; if (capTimer !== undefined) { disarmCap(capTimer); capTimer = undefined; } driver.dispose(); statusDriverRef.current = null; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // §C2.4 trigger 2, as upstream states it: ONE effect over the delta list (`L484891`), not a poke wired into
  // each setter. Same reason upstream chose it — `mode` alone has three writers (Shift+Tab, `/config`, the
  // host's own `state` frame) and a per-setter poke would have to be remembered at each of them forever.
  // First render is skipped (`W.current`), because `mountRun` above already covers it.
  //   THE LIST IS UPSTREAM'S, MINUS WHAT CCX HAS NO PRODUCER FOR: `vimMode`, `fastMode` and `prStatus` do not
  // exist here, and `effortValue` arrives with TASK 11 (its payload block does too). `tokenUsage` and
  // `lastAssistantMessageId` are not React state in ccx at all — they are the two refresher refs above, which
  // poke explicitly from their own completion. `outputStyle`/`renameTitle` are ccx additions to the list:
  // both are payload fields here, and both can change with no turn in sight.
  //   `aiTitle` IS DELIBERATELY NOT ON IT (W2 A8, and it is the half the live re-run caught). Unlike
  // `renameTitle` it has exactly one producer, `adoptAiTitle`, and exactly one moment — the first turn's
  // end. Left on the list it poked there on its own, ~300 ms after a local disk read and so a whole run
  // ahead of the second-scale control readings: the first turn of every conversation ran the user's script
  // twice however well the readings were gated. `statusRefreshAfterTurn` AWAITS the same promise instead,
  // which is what puts `session_name` in the turn's one run rather than in a run of its own.
  const statusFirstRender = useRef(true);
  useEffect(() => {
    if (statusFirstRender.current) { statusFirstRender.current = false; return; }
    pokeStatusLine("state-delta");
    // W-C T11: `effort` IS upstream's `effortValue` delta, and `effortSupported` rides with it because the
    // catalog landing is the moment the block appears or disappears from the payload.
  }, [mode, model, thinkLevel, outputStyle, renameTitle, effort, effortSupported]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ranInitial = useRef(false);
  const ranInitialPrompt = useRef(false);
  // Set for the whole window in which THIS client's own rewind/clear is in flight, so the host's `rewound`
  // broadcast — which every follower receives, the confirming client included — does not trigger a second
  // rebuild on top of confirmRewind's/clear's own. NOT a blanket boolean (final review R8): a local op that
  // is REFUSED (a /clear the host busy-refuses) produces no echo, and a blanket flag suppressed a DIFFERENT
  // client's rewound that happened to arrive in that window, stranding the UI on stale history. Instead it
  // carries the EXPECTED echo shape — a clear expects `{cleared:true}`, a rewind expects its `prevUuid` —
  // and the follower arm below suppresses only a rewound matching it, so a distinguishable foreign one
  // passes through even mid-refusal. Bounded by the same try/finally that owns `rewinding`.
  const selfRewind = useRef<{ cleared: boolean; prevUuid?: string | null } | null>(null);
  /** Does this incoming `rewound` match the local op's expected echo (final review R8)? A clear's echo is
   *  `{cleared:true}`; a rewind's is `{prevUuid}` with no `cleared`. Two clears are genuinely
   *  indistinguishable on the wire, so a foreign clear during a local clear is the one residual — every
   *  other cross-shape foreign rewound (a rewind during a clear, a rewind to a different anchor) passes. */
  const isSelfRewindEcho = (self: { cleared: boolean; prevUuid?: string | null }, ev: { prevUuid?: string; cleared?: boolean }): boolean =>
    self.cleared ? ev.cleared === true : (!ev.cleared && ev.prevUuid === self.prevUuid);

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
  /** FSW Task 3 — THE COMMIT PHASE, and only that. What used to happen here (every unseen finalized item
   *  goes straight into Static) is now split in two, because "this row is settled" and "this row has
   *  scrolled out of reach" are different facts that become true at different moments:
   *    · here, at SETTLE: an item is published once the live window can no longer hold it. Publication is
   *      irreversible — it is a write into Ink's append-only <Static> — so it must never ride a transient
   *      geometry. Reconcile runs when the DOCUMENT moves, which is the one cadence that is not a drag.
   *    · in ChatApp, at RENDER: which of the still-unpublished tail is on screen this frame. That one is
   *      cheap, reversible, and has to keep up with a resize, so it is a derivation and not a commit.
   *  The filter order is what makes the ratchet automatic (`liveWindow.ts`'s input contract): published
   *  items are removed BEFORE the selector sees them, so nothing already in Static can be re-selected into
   *  the live subtree and printed a second time. `publishedIds` remains the sole authority. */
  function reconcile(): void {
    if (disposed.current) return;
    // BEFORE the projection, not after: a group row's item id is derived from its membership alone, so a
    // run published into append-only Static with a stale (or missing) duration could never be corrected.
    mergeThoughtMs();
    const context = projectionContext();
    const finalized = projectCompact(documentRef.current!, context);
    setFinalizedItems(finalized); finalizedRef.current = finalized;
    const unpublished = finalized.filter((item) => !publishedIds.current.has(item.id));
    const cap = commitCap();
    const { commit } = selectLiveWindow(unpublished, cap, cap, commitHeightOf);
    if (commit.length) {
      for (const item of commit) publishedIds.current.add(item.id);
      setStaticItems((s) => [...s, ...commit]);
    }
    setPendingItems(livePending(context));
  }
  /** TOOL-STREAM T5b — THE FLIP RE-FOLDS WHAT IT IS ABOUT TO REPLAY, and this is the whole of the repair.
   *
   *  Task 5 made the fold policy RENDERER-DEPENDENT (`projectionContext().fullscreen`): the same run of
   *  non-read shell calls is one cluster row in fullscreen and one row per call in classic. `staticItems` and
   *  `publishedIds` are the record of what has already been PAINTED, and both were minted under whichever
   *  policy happened to be in force at the time — so a flip left the app holding one policy's committed rows
   *  while every later projection spoke the other's. Two consequences, both measured on main: the classic
   *  arm's `<Static>` replayed the fullscreen-shaped rows on the way back (they were committed while the
   *  alternate screen was up and therefore never painted), and the very next projection found the per-call
   *  ids unspent and appended THOSE below them — both shapes, same two calls, one screen. That is precisely
   *  the second copy `ChatApp.tsx:1154-1156` pins as unacceptable, and Ink's `fullStaticOutput` only grows.
   *
   *  THE REPAIR RE-PROJECTS AND REPLACES; IT NEVER CLEARS. The document is untouched — this is not
   *  `replaceDocument`, which is the CONVERSATION boundary and drops a dozen measurements with it. Only the
   *  two derived facts are re-derived, from the same document, under the new policy: the whole compact
   *  projection, and the commit ratchet re-run over it from zero. Re-running the ratchet is what makes the
   *  two agree again — `selectLiveWindow` cuts a PREFIX by height, so "committed" is a pure function of the
   *  document, the width and the row budget. Where the accumulated set was ratcheted by SETTLE ALONE at the
   *  geometry in force now, recomputing therefore reproduces it item for item on a policy that did not
   *  change; two things break that equality, and neither is a reason not to re-fold:
   *    · `publishLiveWindow` (below) publishes the WHOLE live window on a dialog opening, geometry ignored;
   *    · `commitCap()` is read live, so a terminal that has GROWN since a commit budgets a longer tail.
   *  Both make the recomputed prefix the shorter one, i.e. the re-fold UN-publishes rows that were already
   *  written into `<Static>`. That is survivable rather than free: the un-published rows fall back into the
   *  live subtree, so the screen shows them in both tiers until the flip's own once-per-flip replay lands
   *  each of them exactly once. What must not be built on the stronger claim is a caller that re-folds when
   *  nothing changed — see `/tui`'s no-op arm, which is pinned precisely because this equality is not one.
   *  ChatApp's render-time window subtracts `staticItems` from `finalizedItems` by id, so the two tiers stay
   *  disjoint by construction and every row the ratchet did publish is on screen once.
   *
   *  THE ORDERING IS THE OTHER HALF, and it is why the caller (`/tui`) reads oddly rather than symmetrically:
   *  this must run on the FULLSCREEN side of the flip, both ways. In fullscreen `Transcript` is handed
   *  `EMPTY_ITEMS` (ChatApp:1185), so replacing `staticItems` there paints nothing at all — Ink's `<Static>`
   *  never sees the swap. Entering, that means flip first and re-fold second; leaving, re-fold first and flip
   *  second, so the classic arm's first sight of the list is already the new shape. Get it backwards and the
   *  intervening render publishes the stale one: Ink marks the static node dirty on any update beneath it and
   *  takes an IMMEDIATE, unthrottled render for it (`reconciler.js:73-80`), so an intermediate render is a
   *  write to the terminal, not a frame that can be superseded.
   *    AND IT NEEDS NO REMOUNT, which is what keeps T17's crash fix (ChatApp:1157-1167) untouched: `<Static>`
   *  resets its index whenever `items.length` moves (`Static.js:20-22`), and the length the classic arm sees
   *  moves `0 → M` across the flip whatever we did to the list underneath. The `staticEpoch` key stays for the
   *  conversation boundaries that own it; nothing here unmounts anything. */
  function refoldFor(fullscreen: boolean): void {
    if (disposed.current) return;
    // TOOL-STREAM T8 — A RENDERER FLIP CLOSES EVERY CLUSTER, and this is the second and last place the
    // expansion set is cleared. The affordance that opens one is the fullscreen renderer's alone, so leaving
    // the set standing across a flip would carry an invisible expansion into a screen with no way to close
    // it — and `reconcile()` publishes into append-only `<Static>` even in fullscreen, so rows committed
    // while a cluster was open persist into the classic replay whatever we do (recorded in the spec, Task
    // 13). Clearing here bounds that to what was already committed instead of letting it keep accruing.
    expandedFoldsRef.current.clear();
    // T-CLICKGATE Task 3 — the same boundary and the same class: a clicked-open result is the fullscreen
    // renderer's own affordance too, with nothing on a classic screen to close it.
    expandedItemsRef.current.clear();
    mergeThoughtMs();
    const context = projectionContext(fullscreen);
    const finalized = projectCompact(documentRef.current!, context);
    setFinalizedItems(finalized); finalizedRef.current = finalized;
    const cap = commitCap();
    const { commit } = selectLiveWindow(finalized, cap, cap, commitHeightOf);
    publishedIds.current = new Set(commit.map((item) => item.id));
    setStaticItems(commit);
    setPendingItems(livePending(context));
  }
  /** FSW T3 FIX ROUND (review I2) — publish the WHOLE live window, geometry ignored. The one caller is
   *  ChatApp, on a pane-owning surface going up: the live subtree is blanked for as long as a dialog owns
   *  the screen, and hiding those rows meant the last `rows − 16` of transcript disappeared for the life of
   *  the dialog instead of sitting readable in scrollback above it, which is where they were before this
   *  task. A dialog opening is a settled event, so the commit ratchet applies honestly — that is what makes
   *  this a publish and not a second kind of hiding. The accepted cost is that the ratchet is now driven by
   *  a UI event as well as by the document: rows committed this way are frozen at the width they were
   *  projected at, exactly as any other committed row is. */
  function publishLiveWindow(): void {
    if (disposed.current) return;
    const unpublished = finalizedRef.current.filter((item) => !publishedIds.current.has(item.id));
    if (!unpublished.length) return;
    for (const item of unpublished) publishedIds.current.add(item.id);
    setStaticItems((s) => [...s, ...unpublished]);
  }
  /** FSW TASK 4 — THE SECOND THING THAT MAKES A PROJECTION STALE, and the only one this hook could not see.
   *  Every row below is projected AT A WIDTH (`projectionContext().columns`): a user echo is a band padded to
   *  `width − 1`, a tool result is folded and clipped to `columns`, a table is fitted to it. Reconcile ran on
   *  DOCUMENT movement alone, so after a resize every one of those rows kept the wrapping of a terminal that
   *  no longer exists — and the render-time window (ChatApp) cannot repair it, because it SELECTS from these
   *  items and does not re-make them. A rows-only change needs nothing here (the selector re-runs at render
   *  time and the projection does not depend on height); a COLUMNS change invalidates the projection itself.
   *
   *  AND IT WAITS FOR THE DRAG TO STOP, which is the same rule the commit phase already lives by. Re-running
   *  reconcile is not free of consequence: it can COMMIT (a narrowing makes the tail taller, so rows fall out
   *  of the budget), and a commit is irreversible — publishing rows at a width the drag is passing through
   *  would freeze them at a geometry the user never stopped on. `RESIZE_SETTLE_MS` is `resizeRepaint`'s own
   *  settle window, reused rather than re-chosen: it is the number this codebase already means by "the drag
   *  has stopped", and the two repairs should not disagree about when that is.
   *
   *  THE TRIGGER IS A RENDER, not a subscription, and that is deliberate: the terminal size is ChatApp's React
   *  state (`ChatApp.tsx`'s `size`), so a SIGWINCH the app acts on IS a re-render of this hook — this effect
   *  has no dep array and therefore gets to ask "did the width move?" at every one of them, for the cost of a
   *  comparison. A second subscription here would need its own listener ordering against Ink's, which
   *  `chatMain`'s resize chain already owns and which nothing about a re-projection needs. */
  const reflowWidth = useRef(columnsFn());
  const reflowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const width = columnsFn();
    if (width === reflowWidth.current) return;
    reflowWidth.current = width;
    if (reflowTimer.current !== undefined) clearTimeout(reflowTimer.current);
    const handle = setTimeout(() => { reflowTimer.current = undefined; reconcile(); }, RESIZE_SETTLE_MS);
    handle.unref?.();                    // a drag in flight at exit must not hold the process open
    reflowTimer.current = handle;
  });
  useEffect(() => () => { if (reflowTimer.current !== undefined) clearTimeout(reflowTimer.current); }, []);
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
    if (m?.type === "assistant" && !m.parent_tool_use_id)
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
    hookTrackerRef.current!.clear();    // bl7 T-HOOKBLOCK: a rebuilt transcript has no hook source — show none
    // Same rule for the latched counters and the held hint (F3 Task 4): a rebuilt transcript reuses the very
    // same tool-use ids as anchors, so a maximum latched before the swap would ride onto a run re-read from disk.
    pendingStateRef.current!.reset();
    // TOOL-STREAM T8, THE SAME BOUNDARY AND THE SAME CLASS as the latched counters directly above: an
    // expansion names a fold ANCHOR, which is a tool-use id, and a rebuilt transcript (a resume, a rewind)
    // reuses those ids for calls the reader never opened. Left standing, a `/clear` followed by a resume
    // would open an unrelated cluster on sight.
    expandedFoldsRef.current.clear();
    // T-CLICKGATE Task 3 — the same boundary and the same class: an owner names a tool-use id too, and a
    // rebuilt transcript reuses those ids for calls the reader never clicked open.
    expandedItemsRef.current.clear();
    setCtxPct(undefined);               // W-S5, see above: measured against a conversation that is gone
    // THE SAME BOUNDARY AND THE SAME CLASS for /copy's ring: every entry in it was measured against a
    // conversation that is gone, so `/clear` followed by `/copy` was putting the wiped text on the system
    // clipboard. `resumeInto` and the rewind rebuild both assign this ref AFTER their swap, so they keep
    // their seed by construction and only `/clear` (and the empty-rewind arm) newly reset.
    lastAssistant.current = [];
    // WAVE S T12, THE SAME BOUNDARY AND THE SAME CLASS AS W-S5/Task 8: the ack is a number measured against
    // a conversation that no longer exists. `/clear` swaps the ENGINE (host `clear` op), so `usage()`
    // restarts at zero — an ack of 500 carried across would sit above every count the new conversation
    // produces for a long while, and (before the strict-equality fix, and still for any count that happens
    // to land on it) suppress the cache warning in a conversation it was never given for. Resume and rewind
    // come through here too and inherit the same reset.
    cacheMissAckedAtOutputTokens.current = undefined;
    // WAVE C T14 REVIEW, THE SAME BOUNDARY AND THE SAME CLASS AGAIN: the `token-warning` row is a five-hour
    // queue entry (`TOKEN_WARNING_TIMEOUT_MS`) that describes ONE conversation's context. Cleared, resumed and
    // rewound all arrive here having swapped that conversation out, so a row left standing says
    // `Context low (0% remaining) · Run /compact…` about a transcript that is gone — until the next COMPLETED
    // turn happens to re-measure and re-post. Down with `ctxPct`, for the identical reason.
    // NOT the plan-usage warning: that one is an account-level fact about the rate-limit window, and clearing
    // the screen does not refill your quota.
    notifications.remove(TOKEN_WARNING_KEY);
    // WAVE C T12, THE SAME BOUNDARY AGAIN and the same principle: everything the suggester knows was measured
    // against a conversation that no longer exists. `/clear`, a resume and a rewind all land here, and all
    // three must (a) drop whatever suggestion is pending — it answers a question the user can no longer see
    // — (b) empty the tail and its assistant count, and (c) RETIRE the suggester itself, because its warm
    // session is warm with the OLD conversation: reusing it would leak the cleared context into the next
    // suggestion, which is precisely what `/clear` was asked to prevent. The next eligible turn end spawns a
    // fresh one (`ensureSuggester`).
    setPromptSuggestion(EMPTY_SUGGESTION);
    suggestionTailRef.current = []; assistantSeenRef.current = 0;
    retireSuggester();
    // FINAL REVIEW, FINDING 2 — THE SAME BOUNDARY AND THE SAME CLASS ONCE MORE, now for the two readings the
    // statusLine payload's `cost` and `context_window` blocks are built from. They are refs written by the
    // turn-end refreshers, and until now only their RENDERED sibling (`ctxPct`, W-S5 above) was dropped here:
    // `/clear` swaps the engine, so `usage()` restarts at zero, and the very next run of the script — a
    // `/config` flip, the refresh poll, anything at all — put the NEW session identity on the wire beside the
    // OLD conversation's dollars, durations and token counts. Nulled, they report the honest "no reading yet"
    // shape the payload already has words for (`current_usage: null`, a zeroed `cost` block).
    statusCtxRef.current = undefined; statusUsageRef.current = undefined;
    // W2 T6, THE SAME BOUNDARY AND THE SAME CLASS, for the three identity fields. `/clear` ROTATES the id
    // upstream (`UHi()`, L1685) rather than dropping it, so a fresh mint here is canon's own behaviour and
    // not a ccx invention — and it is what stops the adapter's now-null `sessionId` from leaving the field
    // absent, or (worse) from falling back to the conversation the user just wiped. The latch goes with it
    // because canon's `/clear` chain ends `Ot.promptId = null`: the prompt id and the JSONL path both
    // describe a conversation that no longer exists. Both keys stay absent until the next prompt.
    statusSessionIdRef.current = randomUUID();
    opts.promptLatch?.clear();
    // FINAL REVIEW, FINDING 3 — and the title dies here too, not only in `resumeInto`. W-C T8's review put the
    // reset trio at the `/resume` swap, which is ONE of the four paths through this boundary; `/clear` came
    // through here without it, so the tab kept naming the conversation the user had just wiped and the
    // once-per-session latch — still standing — blocked the new engine's title from ever being adopted.
    // Hoisting it to the boundary is Wave S's own rule (`replaceDocument` IS the shared boundary): a fifth
    // path inherits the reset by construction instead of having to remember it.
    //   A REWIND lands here too and so loses both rungs, which is the honest reading and not a regression:
    // the latch reopens with them, so the next turn end re-reads the same session's title straight back — and
    // a `/rename` is written to disk as that session's `customTitle`, which is the very field the re-read
    // returns. `resumeInto` still calls `adoptAiTitle` itself, because only IT has the new id and dir.
    setAiTitle(undefined); setRenameTitle(undefined); aiTitleFetched.current = false;
    titleGen.current++;                 // finding 5: whatever read is in flight belongs to the old conversation
    // FINDING 2, THE OTHER HALF. Nulling the refs changes no React state, so nothing on the delta list moves
    // and an idle session would keep displaying the stale line until some unrelated setting changed. This is
    // the one boundary that has to announce itself.
    pokeStatusLine("conversation-boundary");

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
  useEffect(() => () => { disposed.current = true; retireSuggester(); }, []);
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
        turnStartRef.current = nowFn(); turnDisqualifiedRef.current = false; turnEndNotifiedRef.current = false;
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
          if (partial) { partial.ingest(data); setStreaming(partial.snapshot()); setStreamOwnerKey(mintStreamOwnerKey(partial.messageKey())); setTurnMeter(partial.meter()); if (partial.model) setModel(partial.model); }
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
          // The `species` tag is what lets PROJECTION own the hint clause — `NAr = !iRe && …` (L422289) in the
          // detail views, and §3.4's fullscreen blanket in the compact one: the tag is how a projection knows
          // which notice this is, and since E2 the whole row is rebuilt from it rather than replayed.
          const divider: LocalTranscriptEvent = {
            // TOOL-STREAM T5 / E2 — THE OVEN NO LONGER ANSWERS THE RENDERER QUESTION. It used to ask
            // `projectionContext()`'s ternary a second time here, which put the answer in the dough: whichever
            // renderer was painting when `/compact` landed was frozen into the stored line, and a later `/tui`
            // could correct it in neither direction (canon's `Ett` — 2.1.234:506706, consumer `Wv` at 511132 —
            // kills the chip for everything in its virtual list, so a survivor inside fullscreen is a divergence;
            // and a boundary baked under fullscreen owed classic a chip it could never get back). Asking at the
            // oven was right; STORING the answer is what made it stale, so `projectLocalEvent` now re-derives the
            // whole row off the `COMPACT_SUMMARY_SPECIES` tag in both projections. What is baked is only the
            // never-projected default for a reader holding the raw lines: the live chord, with no renderer
            // opinion in it.
            kind: "notice", lines: compactSummaryLines(expandHintRef.current, platform),
            data: { species: COMPACT_SUMMARY_SPECIES },
          };
          if (nonEmptyString(data.uuid)) appendLocalIdentified(divider, `compact-divider:${data.uuid}`); else appendNewLocal(divider);
        }
        // bl7 T-HOOKBLOCK Task 1 (spec D2/D14). A hook frame never enters the document (`appendSdk` rejects
        // every system frame already) and never paints as a notice — canon absorbs it into the tool-cluster's
        // own expanded block (a later task), not a standalone line. `return`s unconditionally, BEFORE the
        // system-notice arm below: `systemNoticeLines` has no branch for these subtypes anyway, but falling
        // through would also skip this arm's own reconcile and instead rely on the generic message path's
        // `reconcile()` at the bottom of this handler — which never runs for a hook frame, since nothing here
        // mutates the document for it to react to. `!ev.replay`-guarded on the SAME rule as `stampToolStarts`
        // below: a replayed hook's arrival is the moment this client attached, not the moment it ran, so a
        // replay reports no timing rather than a fabricated one, and never re-pairs a hook the tracker cannot
        // have seen before (a fresh tracker on a fresh mount).
        if (data?.type === "system" && (data.subtype === "hook_started" || data.subtype === "hook_response")) {
          if (!ev.replay) {
            if (data.subtype === "hook_started") hookTrackerRef.current!.started(data, nowFn());
            // D14: `response()` returns true only when it just completed a retained PreToolUse pair — that is
            // the one moment a hook's arrival can change what an already-open run's expanded block would show,
            // and nothing else here will ever re-project for it, so this reconcile is the whole of the fix.
            else if (hookTrackerRef.current!.response(data, nowFn(), documentRef.current!.lastSequence())) reconcile();
          }
          return;
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
          // Same ingest-time ternary as the compact boundary above, and recorded as INERT TODAY rather than
          // guarded: `systemNoticeLines` forwards `expandHint` nowhere — none of its branches reach `foldBody`,
          // the only consumer on `SpeciesOptions` — so no cell can tell the two answers apart. It is threaded
          // because the value it hands over is a baked row's hint and the rule for those is one rule.
          const lines = systemNoticeLines(data, { width: columnsFn(), platform, expandHint: isFullscreenRef.current() ? "" : expandHintRef.current, verbose: true });
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
        // The fold ticker's per-member start (TS T11) is the SAME arrival stamp on the same guard: every
        // `tool_use` the frame carries, whether or not any projection ever renders that member as the
        // cluster's anchor. `FoldPendingState` reads `nowFn` itself, so both halves share one clock.
        if (!ev.replay) { stampAgentCalls(agentMetaRef.current, data, nowFn()); stampToolStarts(pendingStateRef.current!, data); }
        const appended = documentRef.current!.appendSdk("host", data);
        // FALSINESS, not `=== undefined`: a top-level frame carries `parent_tool_use_id: null` on the wire
        // (SDK type `string | null`), so a strict-undefined test matches only a fixture that omits the field
        // — it was never true for a real reply, and /copy therefore never advanced. Every other nested-frame
        // reader in the tree (transcriptModel, toolRenderer, liveTurn, host, router) already tests this way.
        if (appended && data?.type === "assistant" && !data.parent_tool_use_id) {
          // T-COPY decision 1: blocks join with a BLANK LINE ("\n\n"), matching canon's `xd(o, "\n\n")`
          // (tjh/xd, R1 §1.6.4) — both this live join and the disk-side `recentAssistantTexts` must agree.
          const t = (data.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n\n");
          // …and NOT an api_error frame. A failed turn's terminal message is `type:"assistant"` with
          // `parent_tool_use_id:null` and ordinary text — it differs from a reply only by
          // `is_api_error_message:true` (probe 96's terminal shape, pinned in useChat-error.test.tsx). Canon's
          // /copy rule is "the newest NON-ERROR assistant message", so it neither sources the clipboard nor
          // displaces the ring's head. The suggester tail below is deliberately NOT filtered: it wants
          // every turn the conversation actually had, failures included.
          // T-COPY decision 2: bare truthiness on `t` (canon's `if(i)`), not `.trim()` — a lone-whitespace
          // reply still qualifies. T-COPY: unshift-and-cap turns the old single-slot overwrite into the
          // NEWEST-FIRST ring `/copy N` indexes into (see `recentAssistantTexts`'s twin walk on the disk side).
          if (t && data.is_api_error_message !== true) lastAssistant.current = [t, ...lastAssistant.current].slice(0, RECENT_ASSISTANT_CAP);
          // W-C T12: the same text, into the suggester's tail — behind the `appended` guard, so a redelivered
          // or replayed frame neither doubles the tail nor inflates the `early_conversation` count.
          noteTail("assistant", t);
        }
        const l = liveTurnRef.current;
        if (l) { l.ingest(ev.data); setStreaming(l.snapshot()); setStreamOwnerKey(mintStreamOwnerKey(l.messageKey())); setTurnMeter(l.meter()); if (l.model) setModel(l.model); }
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
        // W-C T8: the one read of the engine's ai-title. At turn END rather than `turn:start` because the row
        // it reads is written mid-turn (probe (d) saw it land at row 6 of 20, before the first assistant
        // frame) — a fetch at start would race the engine's own write. Latched, so it is a no-op from the
        // second turn on. Its PROMISE goes to the status-line refresh below (W2 A8): the title lands in
        // `session_name`, so the turn's one run has to be later than the read rather than racing it.
        // W-C T10 / W2 A8: the two refreshers AND the status line's one refresh for this turn — see
        // `statusRefreshAfterTurn`, which owns the ordering that makes it one run rather than two.
        setStreaming([]); setBusy(false); clearRetry(); clearCompacting(); disarmStall(); void statusRefreshAfterTurn(adoptAiTitle());
        // F8 T11: the QUEUE is the condition, not the turn — `drainNext()` below may start another turn
        // immediately, and a notification fired between two queued turns tells the user ccx wants them when
        // it does not. Read BEFORE `drainNext()` mutates it: that call pops `queueRef.current` synchronously
        // for a non-empty queue (its own dispatch is deferred to a macrotask), so reading after would see an
        // already-emptied ref and fire even though a queued prompt is about to run.
        // Review finding B: latched against a REDELIVERED `turn:end` for the same turn, same idiom as the
        // duration row's `turnStartRef` consumption above — a second delivery must not earn a second notice.
        const alreadyNotified = turnEndNotifiedRef.current; turnEndNotifiedRef.current = true;
        if (!alreadyNotified && queueRef.current.length === 0) deps.notifier?.notify("idle_prompt", "ccx is waiting for your input");
        drainNext();
        // W-C T12 (EP-C5), annex §C5.2: `acd(d, c?.lastResult)` — FIRE AND FORGET, at the end of an assistant
        // turn, after the last tool round-trip. Not a `useEffect`, not idle-based, no debounce and no
        // cooldown; the eligibility chain inside is the only thing that declines.
        maybeRequestSuggestion(!!ev.error);
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
      // not our prompt). Our OWN op's echoed broadcast is skipped: confirmRewind/clear already runs its own
      // rebuild, and a second one re-reads disk and re-mints the composer prefill. The suppression is
      // CORRELATED to the local op's expected echo (final review R8), so a foreign rewound arriving while a
      // local op is in flight — including a local op the host then refuses — still rebuilds the UI.
      else if (ev.kind === "rewound") {
        const self = selfRewind.current;
        if (!(self && isSelfRewindEcho(self, ev))) void rebuildAfterRewind({ prevUuid: ev.prevUuid, cleared: ev.cleared });
      }
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
        // W-C T11 rev: the latch settles AFTER the rows it is a latch for, and the order is load-bearing
        // rather than tidy. These two commits are batched into one render today, but if they ever aren't,
        // settling first would give the hint's effect exactly the frame it is meant to prevent — settled,
        // caps still empty, support reading "unknown", hint posted on a model that has no effort axis.
        // This way round the intermediate render is the harmless one (caps known, latch still shut).
        setEffortCapsSettled(true);
        const catalog = (caps.commands as unknown[]).map(toCatalogEntry).filter((e): e is CommandEntry => !!e);
        catalogNames.current = new Set(catalog.map((c) => c.name));
        setCommandCatalog(mergeCommands(LOCAL_COMMAND_ENTRIES, catalog));
      } catch {
        // Keep the local-only catalog — and settle the effort latch anyway. A capability call that never
        // answers leaves support UNKNOWN, and unknown support is the case the hint is supposed to show on.
        if (!cancelled && !disposed.current) setEffortCapsSettled(true);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  /** RETURNS THE PERCENTAGE IT JUST MEASURED (W2 T6 fix, D-W11), because `setCtxPct` cannot answer a caller
   *  in the same tick — React state is read from the render that follows, and `/status` builds its lines
   *  inside the awaiting call. `undefined` for every non-answer there is: a failed read, a reading with no
   *  window, and a hook that has been disposed under it. */
  async function refreshCtx(opts: { quiet?: boolean } = {}): Promise<number | undefined> {
    // …AND IT ANSWERS FOR THE CONVERSATION IT ASKED ABOUT, OR NOT AT ALL (external review, finding A). This is
    // a control round-trip measured at ~1.2 s, and the boundary can land inside it: the mount read (D-W11
    // below) races `--resume`/`--continue`, and a turn-end read races `/clear`. Every write below is one
    // `replaceDocument` has just cleared for the W-S5 reason — the chip, the payload's `context_window`, the
    // `token-warning` row — so a late answer re-posts them ABOUT A CONVERSATION THAT IS GONE, which is the same
    // rule inverted rather than a new one. The document generation is the boundary's own counter, so every
    // caller inherits the check and a fifth one cannot forget it.
    const gen = docEpoch.current;
    try {
      const u = (await session.getContextUsage()) as { totalTokens?: number; maxTokens?: number };
      if (disposed.current || docEpoch.current !== gen) return undefined;
      const pct = u?.maxTokens ? Math.round(((u.totalTokens ?? 0) / u.maxTokens) * 100) : undefined;
      if (pct !== undefined) setCtxPct(pct);
      // W-C T10: the same reading is the status line's `context_window`, and the poke is upstream's
      // `tokenUsage` delta by another name — this is the moment the number ccx reports actually moved.
      // `quiet` is the turn-end caller alone (`statusRefreshAfterTurn`), which pokes once for both readings.
      if (u) { statusCtxRef.current = { totalTokens: u.totalTokens, maxTokens: u.maxTokens }; if (!opts.quiet) pokeStatusLine("context"); }
      postTokenWarning(u?.totalTokens, u?.maxTokens);
      return pct;
    } catch { /* best-effort */ return undefined; }
  }
  /** WAVE C TASK 14 (spec D-C3): the context-pressure ladder, posted HERE because this is the one place the
   *  number is re-measured — turn end, and the `/compact` arm which awaits this same function. `ctx N%` and
   *  `⚠ auto-compact soon` used to be always-on chips on the bar Task 2 retired; upstream carries the same
   *  fact as one `token-warning` queue entry and nothing else.
   *
   *  A re-post FOLDS on the key (`notifications.ts`: same-key replace, timer restarted), so a session that
   *  keeps filling up updates the row in place instead of stacking rows. The REMOVE arm is upstream's too, not
   *  an invention of this port: its effect posts in one branch and calls `Tjt("token-warning")`
   *  (`removeNotification`, `L489326`) in the other — the same callback the external-editor hint removes
   *  itself with at `L489315`. What differs is only the trigger. Upstream re-runs that effect whenever its
   *  token counts change; ccx re-runs it at the turn-end refresh, so a `/compact` that empties the context
   *  takes the row down at the next measurement rather than immediately. The document-swap paths (`/clear`,
   *  resume, rewind) don't wait for that at all — `replaceDocument` removes the key directly.
   *
   *  UPSTREAM'S `fold: GLb` IS DELIBERATELY OMITTED. `GLb` (`L489273`) is literally `(_, arrival) => arrival`
   *  — take the newcomer whole — and this port's same-key `add` already replaces rather than merges
   *  (`notifications.ts` divergence 4). Carrying the field would encode the default as if it were a choice. */
  function postTokenWarning(used: number | undefined, window: number | undefined) {
    const w = tokenWarning(used, window);
    if (!w) { notifications.remove(TOKEN_WARNING_KEY); return; }
    notifications.add({
      key: TOKEN_WARNING_KEY, text: w.text, priority: "medium", timeoutMs: TOKEN_WARNING_TIMEOUT_MS,
      // No colour on the warn rung ON PURPOSE: `$Rr` renders a colourless entry dim, which is the paint
      // upstream's own auto-compact-enabled arm uses. Only the escalation earns `error`.
      ...(w.error ? { color: role("error") } : {}),
    });
  }
  // Fire-and-forget at turn-end only — never poll (spec's no-polling rule). Drives the plan-usage warning;
  // /status and /usage fetch usage() directly themselves and don't route through this.
  async function refreshUsage(opts: { quiet?: boolean } = {}) {
    try {
      const u = await session.usage();
      if (!disposed.current) { postUsageWarning(usageWarning(u)); statusUsageRef.current = u as StatusLineUsage; if (!opts.quiet) pokeStatusLine("usage"); }   // W-C T10: `cost` + `current_usage`
      return u;
    }
    catch { return undefined; }
  }
  /** WAVE 2 ACCEPTANCE A8 — a turn's ONE status-line refresh, and the reason the two refreshers above have
   *  a `quiet` arm at all.
   *
   *  EP-D4 asked for "a boot produces one run and a turn one refresh". The boot half landed in W2 T6; the
   *  turn half did not, and the measurement says why: the turn-end poke and the two readings it wants were
   *  fired in the same statement, so the 300 ms debounce expired long before either control round-trip
   *  answered (~1.2 s warm, the same number that forced the boot gate). Every turn therefore ran the user's
   *  script TWICE — once carrying the PREVIOUS turn's `cost`/`context_window`, once with the real ones. The
   *  unit fakes could not see it because their readings resolve in the same microtask as the poke.
   *
   *  So the poke WAITS for both readings and the readings stay quiet until it does. `allSettled`, because a
   *  reading that fails is not a reason to withhold the turn's refresh — the payload simply carries the last
   *  numbers it had, which is what it did before either call existed. No cap here (unlike the boot gate): a
   *  control call that never answers costs this turn its refresh and nothing else — the poke is local to this
   *  function, every other trigger still reaches the driver, and the next turn end tries again.
   *
   *  `titleAdopted` IS THE THIRD FACT, and the live re-run is what added it: the FIRST turn of a conversation
   *  still ran twice after the readings were gated, because `adoptAiTitle` lands `session_name` at that same
   *  turn end and `aiTitle` was on the delta list — a poke of its own, ~300 ms after a local disk read, well
   *  ahead of the second-scale control calls. It is awaited here and off that list instead (see the delta
   *  effect), so the title reaches the payload through the turn's one run rather than through a run of its
   *  own. Latched, so from the second turn on this promise is already settled. */
  async function statusRefreshAfterTurn(titleAdopted: Promise<void> = Promise.resolve()): Promise<void> {
    await Promise.allSettled([refreshCtx({ quiet: true }), refreshUsage({ quiet: true }), titleAdopted]);
    pokeStatusLine("turn-end");
  }
  /** WAVE C TASK 14 (spec D-C3): `usageWarning()`'s text, on the queue instead of on the retired bar. ONLY ON
   *  CHANGE — see `usageWarnRef`. `undefined` means the warning stopped applying (a rolled-over window), and
   *  that has to take the entry down rather than leave a stale percentage sitting in the slot.
   *
   *  THE LONG TIMEOUT IS LOAD-BEARING (T14 review, finding 3). This is a STANDING condition — "you are 91%
   *  through your five-hour window" stays true for hours — and the post is change-gated, so the queue's 8 s
   *  default would show it once and never again while the percentage held: a permanent fact rendered as a
   *  blink, which is strictly less than the always-on bar chip it replaced. Five hours is upstream's own
   *  "until something replaces or removes it" (`L489324`), and removal here is the rollover branch above.
   *  Unlike the context warning this one does NOT come down at a document swap: it describes the account, not
   *  the conversation.
   *
   *  RECORDED INTERACTION, not resolved here: the slot holds ONE entry, and both five-hour rows sit at
   *  `priority:"medium"`, so whichever of `token-warning` / `usage-warning` lands first owns the slot for up
   *  to five hours and the other waits behind it (only `priority:"immediate"` preempts). Both are standing
   *  conditions, so neither is wrong to hold — but a user near both limits sees only one of them. Whether the
   *  pair should alternate, coexist as `pinned`, or rank against each other is an owner-taste call. */
  function postUsageWarning(text: string | undefined) {
    if (text === usageWarnRef.current) return;
    usageWarnRef.current = text;
    if (text === undefined) { notifications.remove(USAGE_WARNING_KEY); return; }
    // Same constant as the context row on purpose: upstream has one "until replaced" value, not one per row.
    notifications.add({ key: USAGE_WARNING_KEY, text, color: role("warning"), priority: "medium", timeoutMs: TOKEN_WARNING_TIMEOUT_MS });
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
    // F10 T-MAINT item 1 — THE COLD-START RACE. `opts.initialTokenSource` is a value main.ts may have
    // LOST: its banner race is bounded at 1500 ms and a cold handshake measured ~1152 ms on average, so
    // a slow boot left it undefined and this notice told a subscription user their sessions cost extra,
    // for the whole session, with nothing to correct it. `opts.accountBridge` carries the SAME
    // `accountInfo()` promise unraced; the callback awaits it under the wave's second, normative
    // deadline. The 800 ms already spent in the delay counts against ACCOUNT_NOTICE_DEADLINE_MS, so the
    // remaining budget is the difference and the two together are exactly 3000 ms from this arming.
    // The banner's own budget is untouched — chrome still never costs first paint.
    // `cancelled` (review finding P2) — `disposed.current` alone only catches UNMOUNT, but this effect's
    // own cleanup fires on every mode CHANGE too (it is keyed on `[mode]`), and leaving auto while the
    // account-facts promise below is still in flight is exactly that: the component stays mounted, so
    // `disposed.current` stays false throughout. Without a per-invocation flag the cleanup's own
    // `settleRace?.(undefined)` unblocks the `await` with a plain `undefined` and the callback sails past
    // the `disposed.current` checks straight into `notice(...)`, telling a thread that is by then back in
    // "default" mode that it is in auto — and burning the once-only ref doing it.
    let cancelled = false;
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    let settleRace: ((f: AccountFacts | undefined) => void) | undefined;
    const id = setTimeout(async () => {
      if (disposed.current || cancelled) return;
      if (!shouldShowAutoModeNotice(loadPrefs(historyEnv))) { autoNoticeShown.current = true; return; }
      const facts = await new Promise<AccountFacts | undefined>((resolve) => {
        settleRace = resolve;
        const bridge = opts.accountBridge;
        if (!bridge) { resolve(undefined); return; }        // `ccx attach`: no launch handshake to wait for
        raceTimer = setTimeout(() => resolve(undefined), ACCOUNT_NOTICE_DEADLINE_MS - AUTO_MODE_NOTICE_DELAY_MS);
        // The bridge never rejects (it swallows at `offer`), so a credential-less engine simply arrives
        // as `undefined` — the same unknown arm a missed deadline lands on.
        bridge.read().then((f) => { clearTimeout(raceTimer); resolve(f); });
      });
      // Unmounted, OR mode already moved on, while we waited: the cleanup already settled the race so
      // nothing is parked, and this is what keeps the append out of a disposed tree or a stale mode.
      if (disposed.current || cancelled) return;
      // Only a genuine, uncancelled fire ever burns the once-per-process guard (review finding P2) — set
      // HERE, after the cancellation check above, never at the top of the callback: a stale attempt that
      // gets cancelled mid-flight must leave the session still eligible for the next real auto-mode entry.
      autoNoticeShown.current = true;
      // T2's rule, unchanged: oauth is true iff the token source is LITERALLY the subscription one, and
      // both false and UNKNOWN keep the cost sentence. The bridge is only ever a LATER, better answer
      // than the launch value — when the banner won its race the two agree by construction.
      const tokenSource = facts?.tokenSource ?? opts.initialTokenSource;
      notice(autoModeNoticeText({ oauth: tokenSource === "CLAUDE_CODE_OAUTH_TOKEN" }));
      // Best-effort, mirrors theme's/output-style's own silent persistence (:1094) — see the F9 comment
      // this replaces: a bare timer callback has no error boundary above it, and on a read-only home an
      // unguarded throw here would take down an interactive session over a cosmetic flag.
      try { savePrefsFn({ hasSeenAutoModeEntryWarning: true }, historyEnv); } catch { /* best-effort */ }
    }, AUTO_MODE_NOTICE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(id); clearTimeout(raceTimer); settleRace?.(undefined); };
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
    // F8 T11: ONE FIFO, FOUR KINDS. `PendingDecision` carries permission, question, plan and elicitation
    // parks through this single function, so an unguarded notify here would announce a plan approval as a
    // permission prompt. Only the permission kind gets the permission copy.
    if (entry.kind === "permission") deps.notifier?.notify("permission_prompt", `ccx needs your permission to use ${entry.toolName}`);
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
          // W2 T6 FIX / SPEC D-W11 — `/status` MEASURES FOR ITSELF, beside the `usage()` call it already
          // makes. `ctxPct` has one other writer, the turn-end refresh, so before the first turn (and after
          // every `/clear`, resume and rewind, which drop it by Wave S's rule) the context row was simply
          // missing from a command whose entire job is to answer "what is the state of this session right
          // now" — and it was missing or not depending on whether a status line happened to be configured,
          // since that mount effect was the only other reader. This is MEASURE-THEN-SHOW and therefore
          // Wave S's rule rather than an exception to it: what W-S5 forbids is a number that outlived the
          // conversation it described, and this is a fresh reading of the conversation on screen. It costs
          // one control round-trip on an explicitly-typed command.
          //   The Settings dialog's Status tab (`fetchSettingsStatus`) still renders the last measurement
          // instead of taking its own; only `/status` was the filed surface, and the divergence is recorded
          // there rather than fixed by drive-by.
          const [u, measured] = await Promise.all([session.usage().catch(() => undefined), refreshCtx()]);
          append(formatStatus({ model, mode, thinkLevel, ...statusEffort(), ...statusRenderer(), ctxPct: measured ?? ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined }));
          break;
        }
        case "usage": append(formatUsage(await session.usage())); break;
        // Live-feedback fix (2026-08-06): /clear was UI-only — screen wiped, document replaced, ENGINE
        // CONTEXT KEPT — so the model still remembered everything, which read as "/clear doesn't work".
        // The engine half is a fresh-conversation swap (host `clear` op, busy-gated like resume). It runs
        // FIRST: if the host refuses (mid-turn) or predates the op, the screen is left alone and the
        // refusal is printed — a wiped screen over a kept context is exactly the lie this fixes.
        // SELF-SWAP GUARD (M3 §1a-a review, Important 1). The host announces EVERY engine swap now, and
        // /clear rides the very connection this client follows — so its own `rewound {cleared:true}` is
        // routed here before the op reply resolves, and the follower arm would run `rebuildAfterRewind`,
        // whose wipe is the 2J/3J scrollback erase only a rewind may use (W-R t7 gave /clear the
        // viewport-only arm on purpose). `selfRewind` is the ref that already exists for exactly this —
        // confirmRewind sets it for the same reason — and a swap this client asked for repaints through
        // its OWN path, `clear()` on the next line. A FOREIGN client's rewound still rebuilds: the ref is
        // set only across our own op.
        case "clear": {
          selfRewind.current = { cleared: true };   // R8: this op's echo is `{cleared:true}` — suppress only that
          try { await session.clearSession?.(); } catch (e) {
            append([{ text: `clear: ${e instanceof Error ? e.message : String(e)} — screen left as is (engine context unchanged)`, dim: true }]);
            break;
          } finally { selfRewind.current = null; }
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
        // W-C T11 (EP-C6). No arg = upstream's shape, the dialog (`local-jsx`, L423072). An arg is the only
        // keyboard route to the domain gate — a dialog cannot produce an invalid level.
        // W2 T5 (fold s2qa4-10): the arg form now says what it did. The `⎿` row is the ARGUMENT form's
        // alone — the dialog's Enter has the row on screen as its own feedback, and the picker's commit
        // rides out with `formatModelSet`'s notice.
        // T-EFFORT Arm 2 — canon's own branch ORDER (`T2w`, R2 §1.1): help → current/status → bare → level.
        // ccx's old `if (cmd.args) … else …` inverted that (level-or-dialog, nothing else), which is why the
        // two sub-verbs have to be tested INSIDE the non-empty-arg branch, ahead of `applyEffort` — a typed
        // `help`/`current`/`status` must never reach the level parser and be refused as a bogus level.
        case "effort": {
          const arg = cmd.args;                 // parseCommand already trims (commands.ts's parseCommand)
          if (arg === "help" || arg === "-h" || arg === "--help") { append(formatEffortHelp()); break; }
          if (arg === "current" || arg === "status") { append(formatEffortCurrent(effort, DEFAULT_EFFORT)); break; }
          if (!arg) { openEffortDialog(); break; }
          const applied = applyEffort(arg);
          if (applied) append(formatEffortSet(applied, isPersistableEffortLevel(applied)));
          break;
        }
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
        // T-COPY: `/copy N` indexes the ring, N=1 (or bare /copy) = newest, matching canon's `lHw`
        // (R1 §1.4) — validation is `Number(arg)`, integer, >= 1; anything else is the usage string.
        // `cmd.args` arrives already trimmed (commands.ts parseCommand:19), matching canon's `r?.trim()`.
        case "copy": {
          const ring = lastAssistant.current;
          if (ring.length === 0) { notice("No assistant message to copy"); break; }
          let idx = 0;
          const arg = cmd.args;
          if (arg) {
            const n = Number(arg);
            if (!Number.isInteger(n) || n < 1) { notice(`Usage: /copy [N] where N is 1 (latest), 2, 3, … Got: ${arg}`); break; }
            if (n > ring.length) { notice(`Only ${ring.length} assistant ${ring.length === 1 ? "message" : "messages"} available to copy`); break; }
            idx = n - 1;
          }
          const t = ring[idx];
          await copyText(t);
          // Canon's `Sp(e,"\n")+1` (R1 §1.8): count of "\n" occurrences in the copied text, plus one — a
          // line count, not a paragraph count, so the "\n\n" block separator counts double as it should.
          const lines = (t.match(/\n/g)?.length ?? 0) + 1;
          notice(`Copied to clipboard (${t.length} characters, ${lines} lines)`);
          break;
        }
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
        // bl8 T-ADVCMD (spec §3.3): no arg opens the dialog (`openAdvisorDialog` below snapshots the
        // current ref + live model); an arg runs `applyAdvisorChoice` immediately, the SAME choke point
        // the dialog's Enter uses (`applyAdvisor`, T-EFFORT's `applyEffort` precedent — one function, every
        // caller).
        case "advisor": { if (cmd.args) await applyAdvisor(cmd.args); else openAdvisorDialog(); break; }
        // FSW T15 (canon `fTb`, bundle L482580-482620) — SWAP THE RENDERER UNDER A LIVE CONVERSATION.
        // Canon's own order of business, kept: parse, refuse if busy, SAVE, then switch. Two of those
        // deserve a word here.
        //   THE REFUSAL IS GATED ON AN ACTUAL CHANGE (canon's `if (!l)` at L482601). `/tui fullscreen` while
        // already fullscreen changes no screen, so background work is no reason to decline it — and the
        // refusal names waiting for that work, which would be nonsense advice for a no-op. Why background
        // work forbids the flip at all: a task's output lands in the transcript through the renderer that is
        // up, and swapping the surface out from under an in-flight write is the one moment the two cannot
        // agree about what is on screen.
        //   THE SAVE HAPPENS EVEN WHEN THE LADDER OVERRULES THE REQUEST, also canon's shape (L482605 saves
        // before it decides anything about applying). The setting is a preference, not an assertion about
        // this terminal: a user who asks for fullscreen inside a pipe today means it for the next launch.
        case "tui": {
          const arg = cmd.args.trim().toLowerCase();
          const before = opts.rendererChoice?.mode ?? "classic";
          if (!TUI_SETTINGS.includes(arg as TuiSetting)) { append(formatTuiUsage(arg, before)); break; }
          const want = arg as TuiSetting;
          // EXTERNAL REVIEW, FINDING 3 — "ACTUAL CHANGE" IS THE SCREEN'S ANSWER, NOT THE SETTING'S.
          // The gate used to compare the requested SETTING against the LIVE mode, which are different
          // questions the moment a rung ABOVE the settings rung is holding the mode down — a screen reader, an
          // env lever, tmux `-CC`, Windows over SSH. There `/tui fullscreen` transitions nothing (the ladder
          // returns the same classic mode either way), yet background work made it refuse — advising the user
          // to wait for a task before a flip that was never going to happen, and skipping the SAVE on the way
          // out, so the preference they set for their next launch was silently dropped. Asking the ladder what
          // it would select is the same question canon's `if (!l)` asks; ours simply has a ladder to ask.
          const after = opts.selectRenderer ? opts.selectRenderer(want).mode : (want === "fullscreen" ? "fullscreen" : "classic");
          if (after !== before && bgTasksRef.current.length > 0) { append([{ text: TUI_BUSY_REFUSAL, dim: true }]); break; }
          try { savePrefsFn({ tui: want }, historyEnv); } catch { /* best-effort, like every other pref write here */ }
          // Outside `chatMain` there is nobody to flip: no guard, no live mode, no state above this tree.
          // The setting is still the user's to set, and saying so is the honest end of the command.
          if (!opts.switchRenderer) { append([{ text: `Saved. The ${want} renderer will apply at the next launch.`, dim: true }]); break; }
          // TOOL-STREAM T5b — THE FLIP AND THE RE-FOLD, IN THE ORDER THE SCREEN ALLOWS. `refoldFor`'s header
          // carries the mechanism; what belongs here is the shape of the two arms. Both re-folds happen while
          // the FULLSCREEN renderer is the one painting, because that is the only side on which the
          // `<Static>` is holding nothing and a replacement of its list therefore writes no bytes — so
          // entering flips first, leaving flips last, and neither ever exposes a classic frame to a list
          // projected for the other screen. A `/tui` that changes no screen re-folds nothing: replacing the
          // list under a LIVE `<Static>` costs bytes the moment the recomputed prefix is not the accumulated
          // one (`refoldFor`'s header names the two ways that happens), i.e. it can replay a stretch of the
          // conversation for a command that did nothing.
          //   WHICH IS WHY THE ENTERING ARM ASKS THE FLIP WHAT HAPPENED RATHER THAN TRUSTING `after`.
          // `after` is a PREDICTION — the ladder's answer where `selectRenderer` was supplied, a guess at the
          // setting's own shape where it was not — while `choice` is the screen's. They agree everywhere in
          // the product today, and a disagreement is exactly the case that must not re-fold: a REFUSED entry
          // leaves a live classic `<Static>` holding the list, which is the one arrangement in which a
          // pointless re-fold writes. Leaving keeps its pre-flip ordering (it has no post-answer to gate on)
          // and needs none: its re-fold runs while the alternate screen is still up, where nothing paints.
          let choice: RendererChoice;
          if (after === before) choice = opts.switchRenderer(want);
          else if (after === "fullscreen") { choice = opts.switchRenderer(want); if (choice.mode !== before) refoldFor(choice.mode === "fullscreen"); }
          else { refoldFor(false); choice = opts.switchRenderer(want); }
          append(formatTuiResult(want, choice, before));
          break;
        }
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
            case "reduceMotion": setPrefersReducedMotion(result.value !== "false"); break;
            case "progressBar": setTerminalProgressBarEnabled(result.value !== "false"); break;
            case "promptSuggestionEnabled": setPromptSuggestionEnabled(result.value !== "false"); break;
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
  /** `messages`, when supplied (T-RESUME T2), is the picker's preview stage's ALREADY-LOADED payload — see
   *  `pickSession` below. It bypasses BOTH the read and the empty-guard: a re-read would violate spec R-1
   *  ("resume must not re-read the file and reject an empty result after a successful preview"), and a
   *  loaded-but-genuinely-empty session is not the same failure the guard exists to catch (a rejecting
   *  read) — it is a legitimate transcript the preview view already showed with nothing above its footer.
   *  Every OTHER caller (`doContinue`, the initial `--resume`/`--continue` launch, a list-stage Enter with
   *  no preview opened) passes no third argument and keeps the original read-and-guard behaviour unchanged. */
  async function resumeInto(id: string, dir?: string, messages?: unknown[]) {
    if (disposed.current) return;
    if (busy) { notice("cannot resume mid-turn — wait for the turn to finish or press Esc to interrupt"); return; }
    let msgs: any[];
    if (messages !== undefined) {
      msgs = messages as any[];
    } else {
      try { msgs = await getSessionMessages(id, dir); } catch { msgs = []; }
      if (disposed.current) return;
      if (!msgs.length) { append([{ text: `⚠ couldn't resume ${id.slice(0, 8)} — no history found`, dim: true }]); return; }
    }
    const sameSession = session.sessionId === id;
    setSession(makeSession(id));                                   // [session] effect disposes the old
    clearLiveOpen();                                               // the old engine's in-flight calls died with it — nothing of ours is live now
    // Same conversation: APPEND the raw persisted rows into the EXISTING document and reconcile only the
    // ids nobody has seen. Replacing it with disk-only rows would erase every prior local notice and
    // command output from later Ctrl-O detail — a real session change is the only terminal boundary.
    if (sameSession) { for (const m of msgs) documentRef.current!.appendSdk("disk", m); setStreaming([]); reconcile(); }
    else replaceDocument(replayDocument(msgs, { id, width: columnsFn() }));
    lastAssistant.current = recentAssistantTexts(msgs);         // /copy [N] follows what is ON SCREEN, whole ring seeded, not just live turns
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
    // (t8 review, Medium + Low). THE RESET ITSELF MOVED to `replaceDocument` (final review, finding 3) — which
    // is called on this very line's `else` branch and nowhere in the sameSession one, so the gating is
    // unchanged: resuming a session into itself keeps its own `/rename`, a user action on this conversation.
    // What stays here is the RE-READ, because only this function has the new id and the row's directory.
    // It is IMMEDIATE rather than deferred to the first `turn:end`: a resumed session's ai-title is already on
    // disk (probes annex §(d)), so waiting for a turn would show `ccx` for a conversation the engine has
    // already named. Launch `--resume`/`--continue` route through here too, so they inherit the mount read.
    // `dir` is finding 4: a cross-project row's title lives under ITS directory, never under `opts.cwd`.
    if (!sameSession) adoptAiTitle(id, dir);
  }
  async function doContinue() {
    try {
      const sessions = await listSessions();
      const id = pickMostRecent(sessions);
      if (!id) { append([{ text: "No sessions to continue here", dim: true }]); return; }
      await resumeInto(id);
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  /** `messages` (T-RESUME T2): the picker's preview-stage confirm (`ResumeTranscriptView`'s Enter/`y`) hands
   *  back the SAME array it rendered from — see `resumeInto`'s doc comment for why that bypasses the read. A
   *  list-stage pick (Enter with no preview opened) still calls this with one argument, unchanged. */
  function pickSession(info: SessionInfo, messages?: unknown[]) {
    if (disposed.current) return;
    setPicker({ open: false, sessions: [], hasWorktree: false });   // NOT closePicker: a pick is not a cancel
    // The row's OWN directory, not this REPL's: after Ctrl+A the list spans every project, and reading the
    // chosen transcript under `opts.cwd` found nothing and refused with `no history found` (external review,
    // finding 2). A narrowed row carries this very cwd, so the ordinary path is unchanged. What is NOT
    // changed is the engine: `makeSession` resumes in the host's own directory, so a cross-project resume
    // replays that transcript here rather than moving the working directory to it.
    void resumeInto(info.sessionId, info.cwd, messages);
  }
  // F6 T11: the resume picker's two extra verbs. They are the SAME two session calls `/resume` and `/rename`
  // already use — routed out to the picker rather than duplicated in it, so the reader stays the one in
  // `deps` (a test swaps it once and both surfaces follow). `dir` is the picker's row's own directory
  // (finding 2 again) — the pane and the rename field must not act on a different project than the one the
  // highlighted row names.
  //
  // T-RESUME T1: this used to be `.catch(() => [])`, which collapsed a genuine read failure into the exact
  // same shape as a successfully-loaded EMPTY session — `failed` was unreachable in production, and the
  // picker had no way to tell "nothing here" from "couldn't read this." The seam now resolves the tagged
  // `PreviewLoad` (never rejects itself — a caller that wants to react to failure reads `.state`, it does
  // not catch): `loaded` on success, `failed` with the error's message on rejection. `loading` has no arm
  // here on purpose — it is the CONSUMER's own state before this promise settles, not something the reader
  // ever produces.
  const previewSession = (id: string, dir?: string): Promise<PreviewLoad> =>
    getSessionMessages(id, dir).then(
      (messages): PreviewLoad => ({ state: "loaded", messages }),
      (e): PreviewLoad => ({ state: "failed", error: (e as Error).message }),
    );
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
        // W-C T13 (review finding 3): the row's own target id rides along so §C8.6's default-row rewrite can
        // name the sibling the CATALOG points at rather than the one our alias table would derive.
        ...(typeof m?.resolvedModel === "string" ? { resolvedModel: m.resolvedModel } : {}),
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
  function pickModel(m: ModelInfo, opts: { saveDefault?: boolean; confirmed?: boolean; effort?: EffortLevel } = {}) {
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
    //   W2 T5 (review L4): `opts.effort` is the level that rode out WITH this pick — `nvn`'s `mOH`, already
    // APPLIED by the picker through `onEffortChange`/`applyEffort` before it called us. It reaches here only
    // so the sentence can name it (L471428-471429); a pick that carried none appends no clause.
    if (!fromSettings) append(formatModelSet(m.displayName ?? m.value, saveDefault, opts.effort));
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
   *  the old level.
   *
   *  W2 T5: RETURNS the level it applied, or `undefined` when it refused (or the hook is torn down). Only
   *  the `/effort <level>` arm reads it — that surface, and only that surface, prints a result row, and the
   *  refusal below already prints its own (T-EFFORT: now `formatEffortInvalid`, canon's `Invalid argument:
   *  … Valid options are: …` behind the `⎿` gutter, not a bare error-coloured line). Reporting it back
   *  beats an `announce` flag because the domain gate stays in one place and no caller can print a
   *  confirmation for a level that never applied.
   *
   *  T-EFFORT: THE SINGLE PERSISTENCE CHOKE POINT. Every surface that can set a level — the dialog's Enter
   *  (`confirmEffort` below), a typed `/effort <level>` (the dispatch arm), and the `/model` picker's effort
   *  row (`ChatApp`'s `onEffortChange={applyEffort}`) — already funnels through this one function, which is
   *  canon's own shape (`Z5t`, R2 §2.2: one shared thunk under the dialog, the direct-set arm, AND the
   *  picker's commit). So one write here covers all three call sites for free; nothing per-caller was added
   *  to any of them. Persistence is unconditional on "is this interactive" (canon's real gate, R2 §2.2) —
   *  ccx has no headless `/effort` twin, so every reachable caller already IS interactive. */
  function applyEffort(level: string): EffortLevel | undefined {
    if (disposed.current) return undefined;
    if (!isEffortLevel(level)) {
      append(formatEffortInvalid(level));
      return undefined;
    }
    setEffortState(level);
    // Feature-tested like every other SettingsOps verb: a lib Session (whose config is fixed at construction)
    // has no flag layer to write, and the local state above is still the truthful thing to show.
    if (hasSettingsOps(session)) void session.setEffort(level).catch(() => {});
    // Only low|medium|high|xhigh persist (`isPersistableEffortLevel`, canon's `Qdt`) — `max` is deliberately
    // excluded and stays session-only; `formatEffortSet`'s suffix (the dispatch arm below) reads the SAME
    // gate so the confirmation text and the file on disk can never disagree about what just happened.
    if (isPersistableEffortLevel(level)) { try { savePrefsFn({ effort: level }, historyEnv); } catch { /* best-effort, like every other pref write here */ } }
    return level;
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
  /** T-EFFORT Arm 3 — Esc's own path, canon's single word `Cancelled` (R2 §3.1) through the SAME `⎿` gutter
   *  channel every other `/effort` arm uses. SPLIT from `closeEffortDialog` on purpose: `confirmEffort`
   *  below ALSO calls `closeEffortDialog` on a successful Enter, and a naive append inside the shared close
   *  would print `Cancelled` after every confirm too (the trap the brief names). Wiring THIS function to
   *  `onCancel` — not `closeEffortDialog` — is what keeps Enter silent on this specific line. */
  function cancelEffortDialog(): void { closeEffortDialog(); append([{ text: "Cancelled", gutter: { text: LOCAL_OUTPUT_GUTTER, dim: true } }]); }
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

  // bl8 T-ADVCMD Task 3: /advisor. Unlike ThemeDialog, this dialog does no engine work itself — Enter
  // reports a plain string choice (`AdvisorDialog`'s `onChoose`), and the round-trip lives here, in
  // `applyAdvisor`, so both the dialog's Enter and a typed `/advisor <arg>` share the one choke point
  // (`applyEffort`'s own precedent). Snapshot at open time, exactly as `openEffortDialog` does.
  function openAdvisorDialog(): void {
    if (disposed.current) return;
    setAdvisorDialog({ open: true, current: advisorModelRef.current, ...(model ? { mainModel: model } : {}) });
  }
  function closeAdvisorDialog(): void { if (!disposed.current) setAdvisorDialog({ open: false }); }
  function chooseAdvisor(choice: string): void { closeAdvisorDialog(); void applyAdvisor(choice); }
  /** THE SINGLE CHOKE POINT for `/advisor`'s three outcomes (spec §3.3) — the dialog's Enter and a typed
   *  `/advisor <arg>` both funnel through this, exactly as `applyEffort` is `/effort`'s one choke point.
   *  Validation is Task 1's pure `applyAdvisorChoice` (P119: the server never reports a bad value, so an
   *  "invalid" verdict never reaches the engine at all). `setAdvisorModel` lives on the SAME `SettingsOps`
   *  bundle `setEffort` does, so `hasSettingsOps` is the feature-detect for both — a session predating it
   *  (an older attached host) gets the honest refusal rather than a silent no-op.
   *    ORDER (Global Constraints): engine call → persist pref → write the ref (D16/F4 — the value
   *  `projectionContext()` and every long-lived closure read; a bare `useState` would leave them all on
   *  the launch model) → `reconcile()` so the change repaints without waiting for a document revision →
   *  the result line. A `setAdvisorModel` rejection prints `advisor: <message>` (the existing mcp toggle
   *  arm's own "verb: detail" line shape) and skips BOTH the persist and the ref write — a refused engine
   *  call must not have the pref or the live row claim it happened. */
  async function applyAdvisor(choice: string): Promise<void> {
    if (disposed.current) return;
    const result = applyAdvisorChoice(choice, model ?? "", advisorModelRef.current);
    if (result.action === "invalid") { append(formatAdvisorResult(result.message)); return; }
    if (!hasSettingsOps(session)) { notice("advisor: not supported by this host"); return; }
    const nextModel = result.action === "set" ? result.model : null;
    try {
      await session.setAdvisorModel(nextModel);
    } catch (e) {
      if (!disposed.current) notice(`advisor: ${(e as Error).message}`);
      return;
    }
    if (disposed.current) return;
    savePrefsFn(nextModel !== null ? { advisorModel: nextModel } : { advisorModel: undefined }, historyEnv);
    advisorModelRef.current = nextModel ?? undefined;
    reconcile();
    append(formatAdvisorResult(result.message));
  }

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
  function currentSettingsCtx(): SettingsRowCtx { return { theme: currentTheme(), model, outputStyle, mode, thinkLevel, showTurnDuration, reduceMotion: prefersReducedMotion, progressBar: terminalProgressBarEnabled, promptSuggestionEnabled, copyOnSelect }; }
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
  /** The `Reduce motion` row's toggle (F8 T6) — `setShowTurnDuration`'s shape exactly: client-side, commit
   *  then persist, write swallowed. */
  function setPrefersReducedMotion(next: boolean): void {
    if (disposed.current) return;
    setPrefersReducedMotionState(next);
    try { savePrefsFn({ prefersReducedMotion: next }, historyEnv); } catch { /* best-effort */ }
  }
  /** The `Terminal progress bar` row's toggle (T-CH34) — `setPrefersReducedMotion`'s shape exactly:
   *  client-side, commit then persist, write swallowed. */
  function setTerminalProgressBarEnabled(next: boolean): void {
    if (disposed.current) return;
    setTerminalProgressBarEnabledState(next);
    try { savePrefsFn({ terminalProgressBarEnabled: next }, historyEnv); } catch { /* best-effort */ }
  }
  /** The `Copy on select` row's toggle (F9 T-MOUSE Task 7) — `setTerminalProgressBarEnabled`'s shape exactly:
   *  client-side, commit then persist, write swallowed. */
  function setCopyOnSelect(next: boolean): void {
    if (disposed.current) return;
    setCopyOnSelectState(next);
    try { savePrefsFn({ copyOnSelect: next }, historyEnv); } catch { /* best-effort */ }
  }
  // ── W-C T12 (EP-C5): the suggestion's five operations ────────────────────────────────────────────────
  /** The `Prompt suggestions` row's toggle — `setShowTurnDuration`'s shape exactly (client-side, commit then
   *  persist, write swallowed). BOTH polarities are written explicitly, where upstream deletes the key to
   *  mean "on": with absent meaning OFF here (`suggester.promptSuggestionEnabled`), a `void 0` write would
   *  silently turn the feature back off. Turning it OFF also drops whatever is on screen and retires the
   *  session — "off" must mean no engine and no ghost text, not "off from the next turn". */
  function setPromptSuggestionEnabled(next: boolean): void {
    if (disposed.current) return;
    setPromptSuggestionEnabledState(next);
    if (!next) { setPromptSuggestion(EMPTY_SUGGESTION); retireSuggester(); }
    try { savePrefsFn({ promptSuggestionEnabled: next }, historyEnv); } catch { /* best-effort */ }
  }
  function retireSuggester(): void { const s = suggesterRef.current; suggesterRef.current = null; s?.retire(); }
  /** `acd` (L235165) minus its focus/attachment arms, which have no ccx equivalent (this client is either
   *  attached and rendering or it is not running at all). Fire-and-forget by construction: nothing awaits it,
   *  a rejection cannot happen (`request` resolves null on every failure), and a suggestion that lands after
   *  the user has moved on is dropped by the render step rather than by anything here. */
  function maybeRequestSuggestion(turnErrored: boolean): void {
    const reason = suggestionSuppression({
      assistantMessages: assistantSeenRef.current,
      lastTurnError: turnErrored,
      enabled: promptSuggestionEnabledRef.current,
      // ccx has ONE decision queue where upstream has two gates (`pendingWorkerRequest`/`pendingSandboxRequest`
      // and `elicitation.queue`): a parked permission and a parked question are both `pendingRef`. So
      // `elicitation_active` is transcribed in the chain but is never the reason reported here.
      pendingPermission: pendingRef.current !== null,
      mode: modeRef.current,
      // `rate_limit` (`Vie().status !== "allowed"`) has NO ccx equivalent to wire: the harness surfaces plan
      // usage as a WARNING (the `usage-warning` queue entry), which is not the same fact as "this account may
      // not spend right now". Left unwired rather than approximated with a warning that would suppress while
      // spending is in fact still allowed.
    });
    if (reason !== null) return;
    if (suggesterRef.current === null) suggesterRef.current = makeSuggester({ cwd });
    const suggester = suggesterRef.current;
    void suggester.request({ transcriptTail: formatTranscriptTail(suggestionTailRef.current) }).then((text) => {
      // The suggester may have been retired between the request and its answer — `request` already resolves
      // null in that case, so a landed suggestion belongs to the conversation that is still on screen.
      if (!disposed.current && text) setPromptSuggestion({ status: "generated", text });
    });
  }
  /** The composer's slot report (annex §C5.4's `b9` / the `timing` reset). Runs the pure step; the state is
   *  identity-stable when nothing changes, so this can be called on every composer render without churn. */
  function noteSuggestionSlot(canShow: boolean): void {
    if (disposed.current) return;
    setPromptSuggestion((s) => suggestionRenderStep(s, { canShow, now: nowFn() }).next);
  }
  /** Tab/Right accepted it — the buffer write already happened in the composer, this is only the stamp. */
  function acceptSuggestion(): void {
    if (disposed.current) return;
    setPromptSuggestion((s) => markSuggestionAccepted(s, nowFn()));
  }
  /** `scd()` (L235125), which upstream's composer calls on EVERY keystroke: kill the in-flight generation so
   *  nothing generated before the user started typing can land after it. */
  function abortSuggestion(): void { suggesterRef.current?.abort(); }
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
  // The Settings dialog's Status/Usage/Stats tabs — mirror the /status, /usage, /stats cases
  // (formatStatus/formatUsage/formatStats), just returning lines instead of appending them: the dialog
  // renders them itself, read-only.
  //   ONE DIFFERENCE SINCE W2 T6's FIX ROUND: `/status` re-measures the context (D-W11) and this tab does
  // not — it renders whatever `ctxPct` last measured, so pre-first-turn its context row is absent where
  // `/status`' is present. `/status` was the filed surface and the only one adjudicated; extending the extra
  // round-trip to the dialog is a decision of its own, not a consistency chore to do in passing.
  async function fetchSettingsStatus(): Promise<RenderLine[]> {
    const u = await session.usage().catch(() => undefined);
    return formatStatus({ model, mode, thinkLevel, ...statusEffort(), ...statusRenderer(), ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined });
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
    lastAssistant.current = recentAssistantTexts(rows);     // /copy [N] follows what is on screen, whole ring seeded
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
    // R8: this op's echo shape — a first-message rewind CLEARS (`{cleared:true}`), any other resumes at
    // `prevUuid`. Only a matching rewound is suppressed; a foreign one still rebuilds. A code-only rewind
    // provokes no `rewound` broadcast at all, so the descriptor is harmless on that arm.
    selfRewind.current = { cleared: !anchor.prevUuid, prevUuid: anchor.prevUuid };
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
      finally { selfRewind.current = null; if (!disposed.current) setRewinding(false); }
    })();
  }

  // The command channel: echo the prompt, then hand it to the session. ALL rendering (busy/streaming/
  // tasks/model/lines) comes from the event effect above, not from this call — a turn started by another
  // attached client renders identically (spec A2b acceptance 7). onMessage is a deliberate no-op: the
  // events, not the submit callback, own the render.
  // F9 T-IMAGE Task 5 (I3b): `pastedContents` is what turns a plain prompt string into structural
  // content — `assembleSubmission` (pasteChips.ts) resolves any `image-failed` label to its failure text
  // in place and pulls every ready `image` entry into an appended block, or returns the bare string
  // unchanged when the map is empty/absent, so a text-only turn pays nothing extra.
  function runTurn(prompt: string, pastedContents?: PastedMap) {
    // THE live prompt echo. It shares `userEchoLines` with replay and the queued list so the band a prompt
    // wears cannot depend on which surface minted it. Baked at the width of the moment: a local entry's lines
    // project verbatim (`projectLocalEvent`), so an already-echoed prompt keeps its band across a resize.
    appendNewLocal({ kind: "user-echo", lines: userEchoLines(prompt, { width: columnsFn() }) });
    noteTail("user", prompt);        // W-C T12: the user half of the suggester's tail (the assistant half rides the message arm)
    const content = assembleSubmission(prompt, pastedContents ?? {});
    session.submit(content, () => {}).catch((e) => {
      const message = (e as Error).message;
      // F9 T-IMAGE Task 5 (I3b): version skew is LOUD, not a turn failure — the adapter never sent a
      // prompt frame at all (spec v3.1), so this reads as a capability notice (the same idiom
      // clearSession's pre-upgrade degrade uses below), not an error line.
      if (message === IMAGE_VERSION_SKEW_NOTICE) notice(message);
      else append([{ text: `✗ ${message}`, color: role("error") }]);
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
    // F9 T-IMAGE Task 5 (I3b): `entry.pastedContents` rides along the SAME drain — before this task the
    // drain pulled `.value` alone (the flattened text) and a queued image turn's bytes died right here,
    // never reaching `dispatch`/`runTurn` even though `makeQueueEntry` had carried the map this far.
    const entry = q[0], rest = q.slice(1); queueRef.current = rest; setQueue(rest);
    const gen = drainGen.current;
    setTimeout(() => { if (disposed.current || drainGen.current !== gen) return; if (!dispatch(entry.value, entry.pastedContents)) drainNext(); }, 0);
  }
  // ! bash mode — echo the command, run it locally in cwd, append its output (no model turn; CC's shell escape).
  async function runBashMode(command: string) {
    if (disposed.current || !command) return;
    appendNewLocal({ kind: "command-echo", lines: [{ text: `! ${command}`, color: role("bashBorder") }] });   // immediate echo
    try { const r = await runBash(command, cwd); if (!disposed.current) append(formatBashOutput(r)); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: role("error") }]); }
  }
  /** Route one prompt: ! bash · /local-command · /catalog-or-prompt turn. Returns true iff it started a turn
   *  (whose finally re-drains the queue); false for non-turn ops (drainNext must re-drain).
   *
   *  WAVE C TASK 14: a `#` arm stood beside the `!` one and appended the rest of the line to the project
   *  CLAUDE.md (`memoryMode`, `src/tui/memory.ts`). Both are gone — the spec's owner-decision section removed
   *  the mode, upstream's resolver knows only `prompt | bash`, and a `#` line is now an ordinary prompt that
   *  reaches the model verbatim. The `## Memories` sections users already accumulated stay on disk untouched;
   *  only the entry affordance went.
   *
   *  F9 T-IMAGE Task 5 (I3b): `pastedContents` is a new OPTIONAL trailing parameter — every existing
   *  caller (bash, local commands, unknown commands) never had images to carry and stays unaffected; only
   *  the catalog/plain-turn arms below, which actually reach `runTurn`, forward it. */
  function dispatch(prompt: string, pastedContents?: PastedMap): boolean {
    if (prompt.startsWith("!")) { void runBashMode(prompt.slice(1).trim()); return false; }
    const cmd = parseCommand(prompt);
    if (cmd) {
      if (LOCAL_NAMES.has(cmd.name)) { void handleCommand(cmd); return false; }   // local → engine switch
      // U1: a catalogued client-side control gets an honest message, never a prompt the model can't act
      // on. hasOwn, not `in`: a bare object's prototype chain would match "/toString" etc.
      if (Object.hasOwn(CLIENT_SIDE_NOTES, cmd.name)) { append([...userEchoLines(`/${cmd.name}${cmd.args ? " " + cmd.args : ""}`, { width: columnsFn() }), ...formatClientSide(cmd.name)]); return false; }
      if (catalogNames.current.has(cmd.name)) { runTurn(prompt, pastedContents); return true; }   // catalog → run "/name …" as a turn (probe 31)
      void handleCommand(cmd); return false;                                       // unknown → formatUnknown (switch default)
    }
    runTurn(prompt, pastedContents); return true;
  }
  // While a turn runs, regular prompts + catalog commands QUEUE (drained FIFO on turn end); local commands and
  // `!` run immediately (control-channel / local — safe mid-turn). Type-ahead while Claude works (CC parity).
  // Wave C Task 14 took `#` out of that exemption with the memory mode: a `#` line is a model turn now, so it
  // queues like any other prompt instead of jumping the running turn.
  // F9 T-IMAGE (I2): `sub` widened to the structural carrier. Every EXISTING string caller (slash commands,
  // `executeHistory`, the inline `command:*` chord, a queued text drain) stays source-compatible — `prompt`/
  // `pastedContents` below just normalize the one new shape down to the same two locals the string arm
  // always had. What is genuinely new: an image/image-failed entry now survives as far as the QUEUE (see
  // `makeQueueEntry`) instead of dying at the flatten this task removed from `editor.ts`. Actually DELIVERING
  // it to the model — widening `dispatch`/`runTurn`/`session.submit` to accept the block array — is Task 4's
  // transport widening (spec v3.1 scope cut); until then `dispatch` still runs on `prompt` alone, which is
  // exactly `submitText` — the same string this function always dispatched, image labels literal inside it.
  function submit(sub: ComposerSubmission | string) {
    const prompt = typeof sub === "string" ? sub : sub.submitText;
    const pastedContents = typeof sub === "string" ? undefined : sub.pastedContents;
    if (disposed.current || !prompt.trim()) return;
    setSubmitCount((n) => n + 1);
    // W-C T12: `logOutcomeAtSubmission`'s reset (L489800/L495609) — every submit clears the slice, whether the
    // suggestion was accepted, ignored or never shown. Here rather than in `runTurn` because upstream resets
    // at the SUBMIT, and a `/help` or a queued prompt is still the user answering the composer.
    setPromptSuggestion(EMPTY_SUGGESTION);
    // F9 T-IMAGE Task 5 (I3b): `pastedContents` now rides the IMMEDIATE (not-busy) dispatch too — before
    // this task only the QUEUE arm below carried it, so a not-busy image submit reached `dispatch` with
    // its map already dropped and no image ever left the composer.
    if (!busy) { dispatch(prompt, pastedContents); return; }
    if (prompt.startsWith("!")) { dispatch(prompt, pastedContents); return; }
    const cmd = parseCommand(prompt);
    if (cmd && LOCAL_NAMES.has(cmd.name)) { dispatch(prompt, pastedContents); return; }
    setQueue((q) => [...q, makeQueueEntry(prompt, pastedContents)]);            // turn while busy → enqueue
  }
  /** CM51. The mode is DERIVED from the text's own prefix, the one derivation `composerMode` owns for the
   *  whole port — so a queued `!git status` re-enters the composer in bash mode when the drain hands it back
   *  (queue.ts's divergence 1). Nothing reaching this line today can be bash (`submit` dispatches `!`
   *  immediately, above), which is why the mapping is written out rather than hardcoded to `"prompt"`.
   *  The `=== "bash"` ternary IS the rename Wave C Task 14 folded `modeOfDisplay` down to: the queue entry
   *  carries upstream's `prompt | bash` wire spelling, the reducer carries `normal | bash`, and this is the
   *  one site where the two vocabularies meet. */
  // F9 T-IMAGE (I2): `pastedContents` is a new optional parameter, not a new required one — every existing
  // caller (there were none besides `submit`'s own enqueue arm) is unaffected, and a plain-string submit
  // still mints an entry with the field absent, exactly as before.
  function makeQueueEntry(prompt: string, pastedContents?: PastedMap): QueueEntry {
    // F10 T-HOVER (r3): monotonic and never reset — a counter that restarts can hand a live entry a dead
    // entry's key. Per-hook, so two sessions in one process cannot collide either — nothing compares across them.
    return { id: `q${queueSeq.current++}`, value: prompt, mode: composerMode(prompt) === "bash" ? "bash" : "prompt", priority: "now", origin: "user", ...(pastedContents ? { pastedContents } : {}) };
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
  // Returns WHAT BECAME OF THIS CLIENT'S ANSWER (BL6 + its review) so a caller that must act after the answer
  // can both sequence on it and know whether it landed. The question dialog's Esc answers and then interrupts,
  // and the two ops must reach the host in that order or the interrupt's park sweep settles the visible
  // question before its real outcome arrives — but it must interrupt ONLY on `settled`: a lost race means
  // another attached client legitimately answered and their turn must survive our keystroke, and a failed
  // answer means the park is still live host-side with the dialog still up. The promise never rejects (the
  // catch below is inside the chain), so an ignoring caller stays exactly as it was.
  function resolveDecision(outcome: DecisionOutcome): Promise<DecisionAnswerResult> {
    const entry = pendingRef.current;
    if (!entry || !hasDecisionFeed(session)) return Promise.resolve({ status: "failed" });
    answeredIds.current.add(entry.toolUseID);
    return session.answerDecision(entry.toolUseID, outcome).then((r): DecisionAnswerResult => {
      if (r.alreadyAnsweredBy) { notice(`answered by ${r.alreadyAnsweredBy}`); return { status: "already_answered", by: r.alreadyAnsweredBy }; }
      // `{ok:false}` is the host's "no parked request" (host.ts:860) — the park was gone before we arrived,
      // so nothing of ours settled it. Silent, as it has always been; only the classification is new.
      return r.ok === false ? { status: "failed" } : { status: "settled" };
    })
      .catch((e): DecisionAnswerResult => {
        // A designed-for rejection path (host death mid-dialog, or the 10s request deadline on a wedged
        // host) — never leave this unhandled (F1: it used to crash the whole REPL). Un-mark it as ours so
        // a LATER settle of the same entry (the park is still live host-side — never cleared here) still
        // renders correctly instead of being mistaken for our own already-applied answer.
        answeredIds.current.delete(entry.toolUseID);
        notice(`✗ answer failed: ${(e as Error).message}`);
        return { status: "failed" };
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

  return { state: { sessionId: session.sessionId, staticItems, finalizedItems, pendingItems, streaming, streamOwnerKey, pending, mode, busy, aiTitle, renameTitle, ctxPct, model, picker, tasks, bgTasks, bgRows: bgHarvest.current.rows(bgTasks), bgPanelOpen, thinkLevel, effort, effortSupported, defaultEffort: DEFAULT_EFFORT, effortDialog, turnStartedAt, modelPicker, commandCatalog, queue, submitCount, hasMessages: documentRef.current!.messageCount > 0, staticEpoch, turnMeter, rewindPicker, composerPrefill, rewinding, shortcutsOpen, helpOpen, historyOpen, addDir, themeDialog, advisorDialog, bypassConsent, settings, outputStyle, showTurnDuration, prefersReducedMotion, terminalProgressBarEnabled, copyOnSelect, promptSuggestion, promptSuggestionEnabled, permissions, denials, workDirs, retryStatus, compacting, notification, statusLineText } as ChatState, detailItems, publishLiveWindow, toggleFold, toggleItemExpand, submit, popQueueToComposer, resolveDecision, cycleMode, interrupt, clear, closePicker, pickSession, reloadSessions, previewSession, renamePickedSession, closeModelPicker, pickModel, openModelPicker, openEffortDialog, closeEffortDialog, cancelEffortDialog, applyEffort, confirmEffort, notice, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, openHelp, closeHelp, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, closeAdvisorDialog, chooseAdvisor, acceptBypassConsent, refuseBypassConsent, applyMode, setThink, setShowTurnDuration, setPrefersReducedMotion, setTerminalProgressBarEnabled, setCopyOnSelect, setPromptSuggestionEnabled, noteSuggestionSlot, acceptSuggestion, abortSuggestion, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir, notifications, notify, dismissNotification };
}
