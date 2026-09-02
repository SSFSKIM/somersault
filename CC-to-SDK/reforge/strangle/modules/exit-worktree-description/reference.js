// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// Zero free variables, like its sibling. The two worktree tools are the belt's
// clearest case for owning description text at all: the tool's `call` relocates
// the session cwd and the permission root (a C9/W6 edge), and this prose is the
// only part of it any recorded scenario has ever observed.
export function exitWorktreeDescription() {return`Exit a worktree session created by EnterWorktree and return the session to the original working directory.

## Scope

This tool ONLY operates on worktrees created by EnterWorktree in this session. It will NOT touch:
- Worktrees you created manually with \`git worktree add\`
- Worktrees from a previous session (even if created by EnterWorktree then)
- The directory you're in if EnterWorktree was never called

If called outside an EnterWorktree session, the tool is a **no-op**: it reports that no worktree session is active and takes no action. Filesystem state is unchanged.

## When to Use

- The user explicitly asks to "exit the worktree", "leave the worktree", "go back", or otherwise end the worktree session
- Do NOT call this proactively \u2014 only when the user asks

## Parameters

- \`action\` (required): \`"keep"\` or \`"remove"\`
  - \`"keep"\` \u2014 leave the worktree directory and branch intact on disk. Use this if the user wants to come back to the work later, or if there are changes to preserve.
  - \`"remove"\` \u2014 delete the worktree directory and its branch. Use this for a clean exit when the work is done or abandoned.
- \`discard_changes\` (optional, default false): only meaningful with \`action: "remove"\`. If the worktree has uncommitted files or commits not on the original branch, the tool will REFUSE to remove it unless this is set to \`true\`. If the tool returns an error listing changes, confirm with the user before re-invoking with \`discard_changes: true\`.

## Behavior

- Restores the session's working directory to where it was before EnterWorktree
- Clears CWD-dependent caches (system prompt sections, memory files, plans directory) so the session state reflects the original directory
- If a tmux session was attached to the worktree: killed on \`remove\`, left running on \`keep\` (its name is returned so the user can reattach)
- Once exited, EnterWorktree can be called again to create a fresh worktree
`}
