// tui/src/bypassConsent.tsx — the bypass-permissions consent gate (Wave-T T15). Transcribed from 2.1.220's
// `SAm` (L554034-79): the frame `nr` (L184045) in the `error` colour, three body paragraphs, and `_a`
// (L406547) — a two-option `Select` with the CANCEL row rendered first and focused. Upstream mounts it from
// its own startup at L554501-04, `if ((mode === "bypassPermissions" || flag) && !M8())`, through a DYNAMIC
// import; ours is reached the same way, from `cli/main.ts`'s `showBypassConsent` seam and from `/yolo`.
//
// THREE THINGS THIS FILE DELIBERATELY DECIDES:
//
//  1. `onRefuse(code)` rather than an exit call. A dialog that reaches for `process.exit` cannot be tested and
//     cannot be reused: `/yolo` refuses by staying in the mode it is already in, and only the LAUNCH path
//     turns a refusal into an exit. The code is upstream's for that refusal — 1 for the explicit "No, exit"
//     row (`Lu(1)`, L554056), 0 for Escape (`Lu(0)`, L554063-64) — and the launch wrapper passes it straight
//     to the injected `exit`.
//
//  2. Escape is wired to the FRAME's cancel (code 0), not to the Select's. Upstream wires BOTH — `nr` binds
//     `confirm:no` to `Lu(0)` while `_a` hands `jr` an `onCancel` of `TOn("decline")` (`Lu(1)`) — and its
//     context stack resolves `escape` to `select:cancel` in the INNER `Select` context, which outranks the
//     outer `Confirmation` (the same precedence this package records at dialogs/BashPermission.tsx:14). By
//     that reading upstream's `Lu(0)` is unreachable and Escape declines with 1. We take the spec's reading
//     instead (EP-T5: "Escape (L554063-64) exits with code 0") because it is the frame's stated intent and
//     both paths refuse bypass either way — the only difference is what a script sees. To make that reading
//     real we push NO `Confirmation` scope: `escape` reaches the Select's `onCancel`, which IS the frame's
//     cancel here, and the "No, exit" ROW (chosen with Enter) is the only thing that declines with 1.
//
//  3. Persisting is the DIALOG's job, exactly as it is upstream (`yi("userSettings", …)` immediately before
//     `bAm()`, L554052-53) — so every route into bypass records the acceptance and no caller can forget to.
//     The writer is injected for the reason every prefs writer in this package is: a test must never touch
//     the real `~/.claude/ccx/prefs.json`.
import React, { useRef } from "react";
import { Box, Newline, Text, render } from "ink";
import { KeymapProvider } from "./keys/KeymapProvider.js";
import { Select } from "./select/Select.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import { savePrefs as realSavePrefs, type CcxPrefs } from "./prefs.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

/** L554075. */
export const BYPASS_TITLE = "WARNING: Claude Code running in Bypass Permissions mode";
/** L554070, first paragraph. `1A` and `1B` are ONE `<Text>` split by upstream's `j5` — `Newline` with its
 *  default `count: 1` (L182573-77), i.e. a line BREAK, not a blank line; the blank lines in this dialog all
 *  come from the body column's `gap: 1`. */
export const BYPASS_PARA_1A = "In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.";
export const BYPASS_PARA_1B = "This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.";
/** L554070, second paragraph. */
export const BYPASS_PARA_2 = "By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.";
/** L554070, third paragraph — upstream's `Ro` (L181857) renders the bare url as an `ink-link` where the
 *  terminal supports one and as the plain url everywhere else. We print the url unconditionally, the same
 *  reading HelpDialog's `HELP_DOCS_URL` already ships. */
export const BYPASS_DOCS_URL = "https://code.claude.com/docs/en/security";
/** L554075. */
export const BYPASS_CONFIRM_LABEL = "Yes, I accept";
export const BYPASS_CANCEL_LABEL = "No, exit";

/** Upstream's `M8()` (L43492), which ORs the flag across four settings scopes; ccx has one prefs file, so it
 *  is one read. Explicit `true` only — a hand-edited `"skipDangerousModePermissionPrompt": 1` must not pass
 *  a safety gate. */
export function hasAcceptedBypass(prefs: CcxPrefs): boolean { return prefs.skipDangerousModePermissionPrompt === true; }

/** `nr` (L184045-184120) reduced to what this dialog uses — the same local-frame treatment `RewindPicker`'s
 *  `RewindFrame` and `SessionPicker`'s `PickerFrame` give it, and for the same reason (the shared
 *  `DialogFrame` is `Ed`, a different frame). `zu` (L184012) is a coloured rule above a padded column. */
function ConsentFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={role("error")}
         borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text bold color={role("error")}>{BYPASS_TITLE}</Text>
        {children}
      </Box>
    </Box>
  );
}

export interface BypassConsentProps {
  /** The warning was accepted; the acceptance has ALREADY been persisted when this runs. */
  onAccept: () => void;
  /** Refused. `1` is the explicit "No, exit" row, `0` is Escape — upstream's own exit codes for the two
   *  paths, which the launch wrapper passes to `process.exit` and `/yolo` ignores. */
  onRefuse: (code: 0 | 1) => void;
  savePrefs?: typeof realSavePrefs;
  /** Threaded into `savePrefs` so `CCX_FLEET_ROOT` redirection actually reaches the write. */
  env?: NodeJS.ProcessEnv;
}

export function BypassConsent({ onAccept, onRefuse, savePrefs = realSavePrefs, env }: BypassConsentProps) {
  // `EAm` (L554051): the dialog answers exactly once. Two keys can land in the same tick while the caller is
  // still tearing the tree down, and "exit 1" arriving after "accepted" would be the worst possible race on
  // this particular surface.
  const answered = useRef(false);
  function answer(what: "accept" | "decline" | "escape") {
    if (answered.current) return;
    answered.current = true;
    if (what !== "accept") { onRefuse(what === "decline" ? 1 : 0); return; }
    // Best-effort, like every other prefs write in this package (useChat's auto-mode flag says why): a
    // read-only home must not turn a consent the user just gave into a crash. Worst case it asks again.
    try { savePrefs({ skipDangerousModePermissionPrompt: true }, env); } catch { /* best-effort */ }
    onAccept();
  }
  return (
    <ConsentFrame>
      <Box flexDirection="column" gap={1}>
        <Text>{BYPASS_PARA_1A}<Newline />{BYPASS_PARA_1B}</Text>
        <Text>{BYPASS_PARA_2}</Text>
        <Text>{BYPASS_DOCS_URL}</Text>
      </Box>
      <Select
        options={[{ value: "cancel", label: BYPASS_CANCEL_LABEL }, { value: "confirm", label: BYPASS_CONFIRM_LABEL }]}
        defaultFocusValue="cancel"
        onChange={(v) => answer(v === "confirm" ? "accept" : "decline")}
        onCancel={() => answer("escape")}
      />
    </ConsentFrame>
  );
}

/** The mounted tree, as little of it as this module needs. Injected so a test can drive the real component
 *  through `ink-testing-library` without this file importing a test library or writing to a real terminal. */
export interface ConsentMount { unmount(): void }

/** The LAUNCH path (`cli/main.ts`'s `showBypassConsent` seam). Resolves only when the warning is accepted —
 *  every other outcome ends the process through the injected `exit`, so there is nothing to resolve to. */
export async function showBypassConsent(o: {
  exit?: (code: number) => void;
  env?: NodeJS.ProcessEnv;
  mount?: (node: React.ReactElement) => ConsentMount;
} = {}): Promise<void> {
  const exit = o.exit ?? ((code: number) => process.exit(code));
  // `exitOnCtrlC: false` for the reason chatMain passes it: the keymap owns raw stdin for this tree.
  const mount = o.mount ?? ((node: React.ReactElement) => render(node, { exitOnCtrlC: false }));
  let app!: ConsentMount;
  await new Promise<void>((resolve) => {
    app = mount(
      <KeymapProvider>
        <BypassConsent onAccept={resolve} onRefuse={exit} {...(o.env ? { env: o.env } : {})} />
      </KeymapProvider>,
    );
  });
  app.unmount();
}
