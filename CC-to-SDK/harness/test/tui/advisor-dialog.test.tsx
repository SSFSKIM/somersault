// tui/test/advisor-dialog.test.tsx — bl8 T-ADVCMD Task 3: the `/advisor` command, its dialog, and the live
// advisor state in useChat (spec §3.1/§3.3). Two halves, mirroring `effort.test.tsx`'s own split: the
// standalone `AdvisorDialog` component (mounted bare through `renderWithKeymap`, exactly like
// `EffortDialog`'s own `mountDialog`), then the REPL wiring through a full `ChatApp` + `fakeRemote` mount
// (`runCommand`, `effort.test.tsx`'s exact two-step "wait for the echo, then submit" discipline — a
// `stdin.write` issued before Ink's passive input effect attaches is dropped silently).
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { AdvisorDialog } from "../../src/tui/AdvisorDialog.js";
import {
  ADVISOR_TITLE, ADVISOR_BLURB, ADVISOR_RECOMMEND_PREFIX, ADVISOR_RECOMMEND_BODY, ADVISOR_LINK,
  ADVISOR_OFF_LABEL, ADVISOR_NOTICE_KEY, ADVISOR_NOTICE_PAIRED_TEXT, ADVISOR_NOTICE_UNPAIRED_TEXT,
  advisorCatalog, advisorDisplayName, advisorUnsupportedWarning,
} from "../../src/tui/advisorModel.js";
import { COMMANDS } from "../../src/tui/commands.js";
import { resolveModelAlias } from "../../src/config/models.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { projectPending, type RenderItem } from "../../src/tui/toolRenderer.js";
import { createNotificationStore } from "../../src/tui/notifications.js";

// `flat`/`frame` strip ANSI colour codes AND the round-border box-drawing characters before joining lines:
// `AdvisorDialog`'s bordered box hard-wraps its blurb/recommendation paragraphs at the pane width, and each
// wrapped visual row carries its own `│ … │` border pair (`permissions-dialog.test.tsx`'s `rowsOf` pattern)
// — a join that keeps those characters would splice a stray `│` into the middle of a sentence a naive
// substring check straddles.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const stripBorder = (l: string) => l.replace(/[│╭╮╰╯─]/g, "");
const frame = (f: () => string | undefined) => plain(f() ?? "").split("\n").map(stripBorder).join(" ");
const flat = (f: () => string | undefined) => frame(f).replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Type a slash command, WAIT for the composer to echo it, then submit — `effort.test.tsx`'s own helper,
 *  copied rather than shared (the two files predate a common home for it and this ticket does not own
 *  consolidating them). */
async function runCommand(r: { stdin: { write(s: string): void }; lastFrame: () => string | undefined }, cmd: string) {
  await tick();
  r.stdin.write(cmd);
  await waitFor(() => flat(r.lastFrame).includes(`❯ ${cmd}`));
  r.stdin.write("\r");
}

const SONNET = resolveModelAlias("sonnet")!;
const OPUS = resolveModelAlias("opus")!;
const UNKNOWN = "claude-nonexistent-9";

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// commands.ts's catalog entry
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("commands.ts — the /advisor row", () => {
  it("is registered, aliases ordered as advisorCatalog() returns them, summary lower-cased", () => {
    expect(advisorCatalog()).toEqual(["fable", "opus", "sonnet"]);
    const row = COMMANDS.find((c) => c.name === "advisor");
    expect(row?.summary).toBe("[fable|opus|sonnet|off] — let Claude consult a stronger model at key moments");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// Step 1 — the standalone dialog
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
function mountDialog(props: Partial<React.ComponentProps<typeof AdvisorDialog>> = {}) {
  const chosen: string[] = [];
  let cancelled = false;
  const r = renderWithKeymap(
    <AdvisorDialog
      {...(props.current !== undefined ? { current: props.current } : {})}
      {...(props.mainModel !== undefined ? { mainModel: props.mainModel } : {})}
      onChoose={(v) => chosen.push(v)}
      onCancel={() => { cancelled = true; }}
    />,
  );
  return { ...r, chosen, wasCancelled: () => cancelled };
}

describe("AdvisorDialog", () => {
  it("(a) renders the title, blurb, three catalog rows with display names, recommendation, link, and 'No advisor' last", async () => {
    const r = mountDialog();
    await waitFor(() => frame(r.lastFrame).length > 0);
    // `flat`, not `frame`: the blurb/recommendation are long enough to hard-wrap at the pane width, and
    // `effort.test.tsx`'s own comment on this exact helper explains why a wrap point must not fail a
    // content assertion — `flat` collapses whitespace runs, `frame` only join lines with a single space.
    const text = flat(r.lastFrame);
    expect(text).toContain(ADVISOR_TITLE);
    expect(text).toContain(ADVISOR_BLURB);
    for (const alias of advisorCatalog()) expect(text).toContain(advisorDisplayName(alias));
    expect(text).toContain(ADVISOR_OFF_LABEL);
    expect(text).toContain(ADVISOR_RECOMMEND_PREFIX);
    expect(text).toContain(ADVISOR_RECOMMEND_BODY);
    expect(text).toContain(ADVISOR_LINK);
    const offAt = text.indexOf(ADVISOR_OFF_LABEL);
    for (const alias of advisorCatalog()) expect(text.indexOf(advisorDisplayName(alias))).toBeLessThan(offAt);
  });

  it("(b) shows the unsupported-main-model warning only when the main model has no rank entry", async () => {
    const supported = mountDialog({ mainModel: SONNET });
    await waitFor(() => frame(supported.lastFrame).length > 0);
    expect(frame(supported.lastFrame)).not.toContain("does not support the advisor");

    const unsupported = mountDialog({ mainModel: UNKNOWN });
    await waitFor(() => frame(unsupported.lastFrame).includes("does not support the advisor"));
    expect(frame(unsupported.lastFrame)).toContain(advisorUnsupportedWarning(advisorDisplayName(UNKNOWN)));
  });

  it("(c) Esc cancels without choosing", async () => {
    const r = mountDialog();
    await tick();
    r.stdin.write("\x1b");
    await waitFor(() => r.wasCancelled());
    expect(r.chosen).toEqual([]);
  });

  it("(d) Enter on the focused row reports the alias — default focus is 'off' with no current advisor", async () => {
    const r = mountDialog();
    await tick();
    r.stdin.write("\r");
    await waitFor(() => r.chosen.length > 0);
    expect(r.chosen).toEqual(["off"]);
  });

  it("(d) a current catalog alias focuses its OWN row on Enter", async () => {
    const r = mountDialog({ current: OPUS });
    await tick();
    r.stdin.write("\r");
    await waitFor(() => r.chosen.length > 0);
    expect(r.chosen).toEqual(["opus"]);
  });

  it("(e) a current custom id NOT in the catalog renders as a pinned row and focuses it", async () => {
    const custom = "claude-custom-advisor-9";
    const r = mountDialog({ current: custom });
    await waitFor(() => frame(r.lastFrame).length > 0);
    expect(frame(r.lastFrame)).toContain(advisorDisplayName(custom));   // no display-name entry — falls back to the raw id
    await tick();
    r.stdin.write("\r");
    await waitFor(() => r.chosen.length > 0);
    expect(r.chosen).toEqual([custom]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// Step 3 — the REPL wiring: /advisor dispatch, through a real ChatApp + fakeRemote mount
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** `fakeRemote()` extended onto the SettingsOps surface (`setEffort.test.tsx`'s `fakeEffortRemote`'s own
 *  shape) plus the `setAdvisorModel` spy this file needs. */
function fakeAdvisorRemote(advisorCalls: (string | null)[], remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return {
    ...base,
    getSettings: async () => ({}),
    listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }],
    addDir: async () => {}, removeDir: async () => {},
    setOutputStyle: async () => {}, addRule: async () => {}, removeRule: async () => {},
    setEffort: async () => {},
    setAdvisorModel: async (model: string | null) => { advisorCalls.push(model); },
  };
}

function mountApp(opts: { fake: ReturnType<typeof fakeRemote>; initialModel?: string; initialAdvisorModel?: string; store?: ReturnType<typeof createNotificationStore> }) {
  // Same injected `savePrefs` sink `effort.test.tsx`'s `mountApp` uses — without it every test here would
  // fall through to the real `savePrefs` and write to this machine's actual `~/.claude/ccx/prefs.json`.
  const saves: Record<string, unknown>[] = [];
  const r = renderWithKeymap(
    <ChatApp makeSession={() => opts.fake} client={{ kind: "loopback" }} cwd={process.cwd()}
      hookOpts={{ initialModel: opts.initialModel ?? SONNET, ...(opts.initialAdvisorModel ? { initialAdvisorModel: opts.initialAdvisorModel } : {}) }}
      deps={{ ...(opts.store ? { notifications: opts.store } : {}), savePrefs: (patch) => { saves.push(patch); } }} />,
  );
  return { ...r, saves };
}

describe("the REPL wiring: /advisor dispatch", () => {
  it("(a) no arg opens the dialog", async () => {
    const fake = fakeAdvisorRemote([]);
    const r = mountApp({ fake });
    await runCommand(r, "/advisor");
    await waitFor(() => frame(r.lastFrame).includes(ADVISOR_TITLE));
    expect(frame(r.lastFrame)).toContain(ADVISOR_TITLE);
  });

  it("(b) /advisor opus calls setAdvisorModel with the resolved id, saves the pref, and appends the set confirmation", async () => {
    const advisorCalls: (string | null)[] = [];
    const fake = fakeAdvisorRemote(advisorCalls);
    const r = mountApp({ fake, initialModel: SONNET });
    await runCommand(r, "/advisor opus");
    await waitFor(() => advisorCalls.length > 0);
    expect(advisorCalls).toEqual([OPUS]);
    await waitFor(() => r.saves.length > 0);
    expect(r.saves.at(-1)).toEqual({ advisorModel: OPUS });
    await waitFor(() => frame(r.lastFrame).includes(`Advisor set to ${advisorDisplayName(OPUS)}`));
  });

  it("(c) /advisor garbage appends the invalid message and calls setAdvisorModel nothing", async () => {
    const advisorCalls: (string | null)[] = [];
    const fake = fakeAdvisorRemote(advisorCalls);
    const r = mountApp({ fake, initialModel: SONNET });
    await runCommand(r, "/advisor garbage");
    await waitFor(() => frame(r.lastFrame).includes("cannot be used as an advisor"));
    expect(advisorCalls).toEqual([]);
    expect(r.saves).toEqual([]);
  });

  it("(d) /advisor off clears the ref and the pref", async () => {
    const advisorCalls: (string | null)[] = [];
    const fake = fakeAdvisorRemote(advisorCalls);
    const r = mountApp({ fake, initialModel: SONNET, initialAdvisorModel: OPUS });
    await runCommand(r, "/advisor off");
    await waitFor(() => advisorCalls.length > 0);
    expect(advisorCalls).toEqual([null]);
    await waitFor(() => r.saves.length > 0);
    expect(r.saves.at(-1)).toEqual({ advisorModel: undefined });
    await waitFor(() => frame(r.lastFrame).includes("Advisor disabled"));
  });

  it("(f) a session without setAdvisorModel gets the not-supported line", async () => {
    const fake = fakeRemote();   // no SettingsOps at all — the pre-upgrade-host shape
    const r = mountApp({ fake, initialModel: SONNET });
    await runCommand(r, "/advisor opus");
    await waitFor(() => frame(r.lastFrame).includes("advisor: not supported by this host"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// Step 3(e) — the F4/D16 regression shape, in its two independently-failing halves.
//
// The two halves are NOT one assertion: `applyAdvisor`'s own result-line append is itself a document
// mutation, so by the time a black-box `ChatApp` frame is read after `/advisor` finishes, that append has
// already bumped `document.revision()` and forced a fresh (correctly-keyed) rebuild regardless of whether
// `knobKey` includes `advisorModel` — React's automatic batching means the intermediate (stale-cache)
// paint this fix guards against is never independently observable through a full mount. So the REF half
// is exercised end-to-end (a real `ChatApp`, `/advisor` THEN a live frame), and the `knobKey` half is
// exercised directly against `toolRenderer.tsx`'s own cache, at the SAME document revision, which is
// exactly the shape a future caller (a blink repaint, a fold toggle) that reconciles WITHOUT an
// accompanying append could actually hit.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("F4 (D16), half 1 — projectionContext reads the LIVE ref, not a value captured at mount", () => {
  it("/advisor opus, THEN a synthetic advisor server_tool_use frame arriving live, renders using the NEW model", async () => {
    const advisorCalls: (string | null)[] = [];
    const fake = fakeAdvisorRemote(advisorCalls);
    const r = mountApp({ fake, initialModel: SONNET });
    await tick();   // the host-event subscription is mounted BEFORE anything below happens
    await runCommand(r, "/advisor opus");
    await waitFor(() => advisorCalls.length > 0);
    // A consult that starts AFTER the apply — a bare `const`/`useState` seeded once from
    // `opts.initialAdvisorModel` (bl7's shape) would never see this change at all, no matter how many
    // renders followed, because that value is a launch-time PROP `/advisor` has nowhere to write into.
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null,
      message: { id: "m-adv", content: [{ type: "server_tool_use", id: "srv1", name: "advisor", input: {} }] } } });
    // The clause prints the RESOLVED id verbatim (render.ts's own recorded divergence — no client-side
    // catalog to prettify it with), so the value to look for is `OPUS`, not a display name.
    await waitFor(() => frame(r.lastFrame).includes(`Advising using ${OPUS}`));
  });
});

describe("F4 (D16), half 2 — the anchored-entries cache keys on advisorModel, not just revision/theme/agents", () => {
  it("re-querying the SAME document at the SAME revision with a different advisorModel returns the NEW model's row, never the first call's cached one", () => {
    const doc = new TranscriptDocument();
    doc.appendSdk("host", { type: "assistant", parent_tool_use_id: null,
      message: { id: "m-adv", content: [{ type: "server_tool_use", id: "srv1", name: "advisor", input: {} }] } });
    const FS = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0, fullscreen: true, expandHint: "" };
    const textOf = (items: readonly RenderItem[]): string =>
      items.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.body.map((l) => l.text))).join("|");

    const first = projectPending(doc, { ...FS, advisorModel: OPUS });
    expect(textOf(first)).toContain(`Advising using ${OPUS}`);
    // Same `doc` instance — NO append happened, so `doc.revision()` is identical to the call above. Only
    // `advisorModel` moved. Without it in `knobKey` this returns the FIRST call's cached array untouched.
    const second = projectPending(doc, { ...FS, advisorModel: SONNET });
    expect(textOf(second)).toContain(`Advising using ${SONNET}`);
    expect(textOf(second)).not.toContain(OPUS);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// Task 4 (spec §3.4, A12) — the launch-time startup notification
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("the advisor startup notification (A12)", () => {
  it("(a) a paired initialAdvisorModel posts the experimental notice once, medium priority, key advisor-experimental", async () => {
    const store = createNotificationStore();
    const r = mountApp({ fake: fakeRemote(), initialModel: SONNET, initialAdvisorModel: OPUS, store });
    await waitFor(() => store.state().current?.key === ADVISOR_NOTICE_KEY);
    expect(store.state().current).toMatchObject({ key: ADVISOR_NOTICE_KEY, text: ADVISOR_NOTICE_PAIRED_TEXT, priority: "medium" });
    expect(frame(r.lastFrame)).toContain(ADVISOR_NOTICE_PAIRED_TEXT);
  });

  it("(b) an unpaired initialAdvisorModel (less capable than the main model) posts the sibling text", async () => {
    const store = createNotificationStore();
    // OPUS main (rank 4), SONNET advisor (rank 3): canAdvise(OPUS, SONNET) is false.
    mountApp({ fake: fakeRemote(), initialModel: OPUS, initialAdvisorModel: SONNET, store });
    await waitFor(() => store.state().current?.key === ADVISOR_NOTICE_KEY);
    expect(store.state().current?.text).toBe(ADVISOR_NOTICE_UNPAIRED_TEXT);
  });

  it("(c) no initialAdvisorModel posts nothing", async () => {
    const store = createNotificationStore();
    mountApp({ fake: fakeRemote(), initialModel: SONNET, store });
    await tick(); await tick();
    expect(store.state().current).toBeNull();
  });

  it("(d) does not re-post on a later re-render", async () => {
    const store = createNotificationStore();
    const r = mountApp({ fake: fakeRemote(), initialModel: SONNET, initialAdvisorModel: OPUS, store });
    await waitFor(() => store.state().current?.key === ADVISOR_NOTICE_KEY);
    const first = store.state().current;
    r.stdin.write("x");   // forces a re-render (composer text change) unrelated to the advisor state
    await tick();
    // Entries are stored BY IDENTITY (notifications.ts's own contract) — a same-key re-add would swap in a
    // NEW object even with identical text, so reference equality is what proves the effect did not re-fire.
    expect(store.state().current).toBe(first);
  });
});
