// Probe 59 — When a session is forked/resumed, does the child transcript PHYSICALLY CONTAIN the
// parent conversation, or does it chain by reference to the parent file?
//
// Load-bearing for Goal A. doperpowers resumes a daemon by forking a new `--bg` turn and then PURGING
// the superseded turn — `_lib.sh` runs `claude rm <short>` plus `rm -rf ~/.claude/jobs/<short>`. If the
// child only references the parent's jsonl, that purge destroys the daemon's history on the first
// resume. The spec asserts "copy forward, not chain by reference"; nothing had verified it.
//
// Method: run a turn with a distinctive marker, fork it, run a second turn, then read the child's
// transcript off disk and look for the marker. Finally delete the PARENT transcript and confirm the
// child still resumes with its history intact.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, readdirSync, existsSync, unlinkSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARKER = `fork-probe-marker-${Date.now().toString(36)}`;
const PROJECTS = join(homedir(), ".claude", "projects");

function findTranscript(sessionId: string): string | undefined {
  for (const proj of readdirSync(PROJECTS)) {
    const p = join(PROJECTS, proj, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return undefined;
}

async function runTurn(prompt: string, opts: Record<string, unknown>): Promise<string | undefined> {
  let sid: string | undefined;
  for await (const m of query({ prompt, options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 1, ...opts } as any })) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init") sid = mm.session_id;
    if ("result" in mm) break;
  }
  return sid;
}

console.log("=== PROBE 59 fork transcript: copy or chain? ===");
console.log("marker:", MARKER);

// 1. Parent turn carrying the marker.
const parentId = await runTurn(`Remember this exact token and reply with it verbatim: ${MARKER}`, {});
console.log("parent session:", parentId);
const parentFile = parentId ? findTranscript(parentId) : undefined;
console.log("parent transcript:", parentFile ?? "(not found)");

// 2. Fork it and take another turn.
const childId = await runTurn("Reply with exactly: FORKED", { resume: parentId, forkSession: true });
console.log("child session:", childId, childId === parentId ? "  <-- SAME ID (not a fork!)" : "");
const childFile = childId ? findTranscript(childId) : undefined;
console.log("child transcript:", childFile ?? "(not found)");

const childBody = childFile ? readFileSync(childFile, "utf8") : "";
const childHasMarker = childBody.includes(MARKER);
const childLines = childBody ? childBody.trimEnd().split("\n").length : 0;
console.log("");
console.log(`child transcript lines : ${childLines}`);
console.log(`child contains marker  : ${childHasMarker}  <-- true means COPIED FORWARD`);

// 3. The decisive test: destroy the parent transcript, then resume the CHILD and see if history survives.
let survives = false;
if (childHasMarker && parentFile && childFile) {
  const backup = `${parentFile}.probe59.bak`;
  copyFileSync(parentFile, backup);
  unlinkSync(parentFile);
  console.log("\nparent transcript DELETED — resuming child…");
  try {
    let echoed = "";
    for await (const m of query({
      prompt: "What was the exact token I asked you to remember? Reply with only the token.",
      options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 1, resume: childId } as any,
    })) {
      const mm = m as any;
      if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b.type === "text") echoed += b.text;
      if ("result" in mm) break;
    }
    survives = echoed.includes(MARKER);
    console.log("child recalled after parent deletion:", survives, `(${echoed.trim().slice(0, 80)})`);
  } catch (e: any) {
    console.log("child resume THREW after parent deletion:", e?.message);
  }
  copyFileSync(backup, parentFile); unlinkSync(backup); // restore, leave no litter
  console.log("(parent transcript restored)");
}

console.log("");
const pass = childId !== parentId && childHasMarker && survives;
console.log(pass
  ? "VERDICT: fork COPIES the conversation forward — purging the parent is safe"
  : childHasMarker
    ? "VERDICT: PARTIAL — child file holds the history but did not survive parent deletion"
    : "VERDICT: fork CHAINS by reference — doperpowers' purge WOULD destroy daemon history");
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
