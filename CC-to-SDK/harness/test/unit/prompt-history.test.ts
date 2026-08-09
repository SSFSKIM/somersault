// test/unit/prompt-history.test.ts — F5 task 6, the persisted prompt history. Every pin below is a
// transcription from the 2.1.220 bundle, not an invention:
//  · `uu_`  (L317596) the entry — `{ ...t, pastedContents, timestamp: Date.now(), project, sessionId }`
//  · `uu_`  (L317601) the paste split — `content.length <= nu_` inlines `content`, else `contentHash`
//  · `nu_`  (L317645) the threshold — 1024
//  · `cgr`  (L317622) the gate — `Yt(process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY)`, and `Yt` (L1562) is
//                     `1|true|yes|on`, so `=0` is NOT a skip
//  · `UUd`  (L317460) the read walk — validity guard, scope filter, dedup by display, cap at `gDo`
//  · `gDo`  (L317645) the cap — 100
//  · `iu_`  (L317513) the resolve — `e.content || (e.contentHash ? load(e.contentHash) : null)`
//  · `hon`/`mP`/`LV` (L236123/L236131/L236136) mode ⇄ display's `!` prefix
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pastePath, pasteHash } from "../../src/tui/pasteCache.js";
import {
  HISTORY_CAP, PASTE_INLINE_MAX, appendHistory, composerMode, displayForMode, historyPath,
  readHistory, resolvePastedContent, stripModePrefix, type HistoryEntry,
} from "../../src/tui/promptHistory.js";

let env: NodeJS.ProcessEnv;
const PROJ = "/w/proj";
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-hist-")) }; });
afterEach(() => { rmSync(env.CCX_FLEET_ROOT!, { recursive: true, force: true }); });

/** Raw line injection — the only way to test the reader's tolerance of files it did not write. */
function rawLines(...lines: string[]): void {
  mkdirSync(env.CCX_FLEET_ROOT!, { recursive: true });
  appendFileSync(historyPath(env), lines.map((l) => `${l}\n`).join(""));
}

describe("historyPath — the location divergence", () => {
  it("is `history.jsonl` at the fleet root, not `~/.claude`", () => {
    expect(historyPath(env)).toBe(join(env.CCX_FLEET_ROOT!, "history.jsonl"));
  });
});

describe("appendHistory — uu_", () => {
  it("round-trips a prompt through the file", () => {
    appendHistory({ display: "hello", project: PROJ, sessionId: "s1" }, env);
    expect(readHistory({ scope: "project", project: PROJ }, env)).toEqual([
      { display: "hello", timestamp: expect.any(Number), project: PROJ, sessionId: "s1", pastedContents: {} },
    ]);
  });

  it("stamps a millisecond epoch, not an ISO string — `timestamp: Date.now()`", () => {
    const before = Date.now();
    appendHistory({ display: "x", project: PROJ }, env);
    const ts = readHistory({ scope: "project", project: PROJ }, env)[0].timestamp;
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
    // The wire form is a bare number, so nothing downstream can start Date.parse-ing it.
    expect(readFileSync(historyPath(env), "utf8")).toMatch(/"timestamp":\d+/);
  });

  it("writes exactly one JSON line per call, append-only", () => {
    appendHistory({ display: "one", project: PROJ, timestamp: 1 }, env);
    appendHistory({ display: "two", project: PROJ, timestamp: 2 }, env);
    const lines = readFileSync(historyPath(env), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).display).toBe("one");   // oldest first ON DISK
    expect(JSON.parse(lines[1]).display).toBe("two");
  });

  it("creates the file 0o600 — a prompt log is as sensitive as the paste cache", () => {
    appendHistory({ display: "secret", project: PROJ }, env);
    if (process.platform === "win32") return;
    expect(statSync(historyPath(env)).mode & 0o777).toBe(0o600);
  });

  it("defaults `project` to the cwd so an entry can never be born unreadable", () => {
    appendHistory({ display: "no-project-given" }, env);
    const line = JSON.parse(readFileSync(historyPath(env), "utf8").trim());
    expect(line.project).toBe(process.cwd());
  });
});

describe("CLAUDE_CODE_SKIP_PROMPT_HISTORY — cgr + Yt", () => {
  it("writes nothing at all when set", () => {
    appendHistory({ display: "hi", project: PROJ }, { ...env, CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" });
    expect(existsSync(historyPath(env))).toBe(false);
    expect(readHistory({ scope: "everywhere" }, env)).toEqual([]);
  });

  it("accepts Yt's whole vocabulary — 1/true/yes/on, case- and space-insensitive", () => {
    for (const v of ["1", "true", "TRUE", "yes", " on "]) {
      appendHistory({ display: v, project: PROJ }, { ...env, CLAUDE_CODE_SKIP_PROMPT_HISTORY: v });
    }
    expect(existsSync(historyPath(env))).toBe(false);
  });

  it("is NOT a skip for `0`, `false`, or the empty string — Yt is a vocabulary, not a presence check", () => {
    for (const v of ["0", "false", "", "off"]) {
      appendHistory({ display: v, project: PROJ }, { ...env, CLAUDE_CODE_SKIP_PROMPT_HISTORY: v });
    }
    expect(readHistory({ scope: "project", project: PROJ }, env).map((e) => e.display)).toEqual(["off", "", "false", "0"]);
  });

  it("suppresses the paste-cache write too — the gate wraps the whole append", () => {
    const body = "P".repeat(PASTE_INLINE_MAX + 1);
    appendHistory({ display: "[Pasted text #1 +9 lines]", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: body, lineCount: 9 } } },
      { ...env, CLAUDE_CODE_SKIP_PROMPT_HISTORY: "yes" });
    expect(existsSync(pastePath(pasteHash(body), env))).toBe(false);
  });
});

describe("readHistory — UUd's walk", () => {
  it("returns newest-first", () => {
    for (const d of ["a", "b", "c"]) appendHistory({ display: d, project: PROJ }, env);
    expect(readHistory({ scope: "project", project: PROJ }, env).map((e) => e.display)).toEqual(["c", "b", "a"]);
  });

  it("dedups by exact display, NEWEST wins", () => {
    appendHistory({ display: "dup", project: PROJ, timestamp: 1000 }, env);
    appendHistory({ display: "other", project: PROJ, timestamp: 2000 }, env);
    appendHistory({ display: "dup", project: PROJ, timestamp: 3000 }, env);
    const out = readHistory({ scope: "project", project: PROJ }, env);
    expect(out.map((e) => e.display)).toEqual(["dup", "other"]);
    expect(out[0].timestamp).toBe(3000);        // the SABOTAGE pin: keep-oldest yields 1000 here
  });

  it("dedups on exact text — a trailing space is a different prompt", () => {
    appendHistory({ display: "ls", project: PROJ }, env);
    appendHistory({ display: "ls ", project: PROJ }, env);
    expect(readHistory({ scope: "project", project: PROJ }, env).map((e) => e.display)).toEqual(["ls ", "ls"]);
  });

  it("filters by scope BEFORE dedup, so a shadowed entry from another project still surfaces", () => {
    appendHistory({ display: "shared", project: "/w/other", sessionId: "s2", timestamp: 1 }, env);
    appendHistory({ display: "shared", project: PROJ, sessionId: "s1", timestamp: 2 }, env);
    expect(readHistory({ scope: "project", project: "/w/other" }, env).map((e) => e.timestamp)).toEqual([1]);
    expect(readHistory({ scope: "project", project: PROJ }, env).map((e) => e.timestamp)).toEqual([2]);
    // everywhere sees both lines but dedups them to the newest
    expect(readHistory({ scope: "everywhere" }, env).map((e) => e.timestamp)).toEqual([2]);
  });

  it("scopes to a session by sessionId alone — upstream's session arm does NOT also filter project", () => {
    appendHistory({ display: "p1", project: PROJ, sessionId: "s1" }, env);
    appendHistory({ display: "p2", project: "/w/other", sessionId: "s1" }, env);
    appendHistory({ display: "p3", project: PROJ, sessionId: "s2" }, env);
    expect(readHistory({ scope: "session", sessionId: "s1" }, env).map((e) => e.display)).toEqual(["p2", "p1"]);
  });

  it("skips a corrupt middle line and keeps both neighbours", () => {
    appendHistory({ display: "before", project: PROJ }, env);
    rawLines("{not json at all");
    appendHistory({ display: "after", project: PROJ }, env);
    expect(readHistory({ scope: "everywhere" }, env).map((e) => e.display)).toEqual(["after", "before"]);
  });

  it("skips a line whose `project` is not a string — UUd's validity guard, at every scope", () => {
    rawLines(JSON.stringify({ display: "orphan", timestamp: 5 }), JSON.stringify({ display: "typed", timestamp: 6, project: PROJ }));
    expect(readHistory({ scope: "everywhere" }, env).map((e) => e.display)).toEqual(["typed"]);
  });

  it("survives a `null` line and a bare JSON scalar without throwing", () => {
    rawLines("null", "42", '"a string"', JSON.stringify({ display: "ok", timestamp: 1, project: PROJ }));
    expect(readHistory({ scope: "everywhere" }, env).map((e) => e.display)).toEqual(["ok"]);
  });

  it("is [] when the file does not exist", () => { expect(readHistory({ scope: "everywhere" }, env)).toEqual([]); });

  it("caps at gDo = 100 post-dedup, and honours an explicit smaller limit", () => {
    expect(HISTORY_CAP).toBe(100);
    for (let i = 0; i < 150; i++) appendHistory({ display: `p${i}`, project: PROJ, timestamp: i }, env);
    const out = readHistory({ scope: "project", project: PROJ }, env);
    expect(out).toHaveLength(100);
    expect(out[0].display).toBe("p149");
    expect(out[99].display).toBe("p50");
    expect(readHistory({ scope: "project", project: PROJ, limit: 3 }, env).map((e) => e.display)).toEqual(["p149", "p148", "p147"]);
  });

  it("counts the cap in DEDUPED entries, not scanned lines", () => {
    for (let i = 0; i < 150; i++) appendHistory({ display: "same", project: PROJ, timestamp: i }, env);
    appendHistory({ display: "unique", project: PROJ, timestamp: 999 }, env);
    expect(readHistory({ scope: "project", project: PROJ }, env).map((e) => e.display)).toEqual(["unique", "same"]);
  });
});

describe("pastedContents — the nu_ split", () => {
  const small = "s".repeat(PASTE_INLINE_MAX);
  const big = "b".repeat(PASTE_INLINE_MAX + 1);

  it("threshold is 1024 and it is inclusive", () => { expect(PASTE_INLINE_MAX).toBe(1024); });

  it("inlines a payload at or under the threshold and writes NO cache file", () => {
    appendHistory({ display: "[Pasted text #1 +2 lines]", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: small, lineCount: 2 } } }, env);
    const rec = readHistory({ scope: "everywhere" }, env)[0].pastedContents![1];
    expect(rec).toEqual({ id: 1, type: "text", content: small, lineCount: 2 });
    expect(rec.contentHash).toBeUndefined();
    expect(existsSync(pastePath(pasteHash(small), env))).toBe(false);
  });

  it("hashes a payload over the threshold and stores the body in the paste cache", () => {
    appendHistory({ display: "[Pasted text #1 +2 lines]", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: big, lineCount: 2 } } }, env);
    const rec = readHistory({ scope: "everywhere" }, env)[0].pastedContents![1];
    expect(rec).toEqual({ id: 1, type: "text", contentHash: pasteHash(big), lineCount: 2 });
    expect(rec.content).toBeUndefined();
    expect(readFileSync(pastePath(pasteHash(big), env), "utf8")).toBe(big);
    // The big body must not be duplicated into the history line.
    expect(readFileSync(historyPath(env), "utf8")).not.toContain(big);
  });

  it("keys the record by number and handles a mixed map", () => {
    appendHistory({ display: "d", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: small, lineCount: 1 }, 2: { id: 2, type: "text", content: big, lineCount: 9 } } }, env);
    const map = readHistory({ scope: "everywhere" }, env)[0].pastedContents!;
    expect(Object.keys(map)).toEqual(["1", "2"]);
    expect(map[1].content).toBe(small);
    expect(map[2].contentHash).toBe(pasteHash(big));
  });

  it("carries upstream's optional mediaType/filename through untouched", () => {
    appendHistory({ display: "d", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: "x", lineCount: 0, mediaType: "text/plain", filename: "n.txt" } } }, env);
    expect(readHistory({ scope: "everywhere" }, env)[0].pastedContents![1]).toMatchObject({ mediaType: "text/plain", filename: "n.txt" });
  });

  it("an entry with no pastes persists an empty map, never undefined", () => {
    appendHistory({ display: "plain", project: PROJ }, env);
    expect(JSON.parse(readFileSync(historyPath(env), "utf8").trim()).pastedContents).toEqual({});
  });
});

describe("resolvePastedContent — iu_", () => {
  it("prefers the inlined content", () => {
    expect(resolvePastedContent({ id: 1, type: "text", content: "inline" }, env)).toBe("inline");
  });

  it("falls back to the cache for a hashed record", () => {
    const big = "z".repeat(PASTE_INLINE_MAX + 1);
    appendHistory({ display: "d", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: big, lineCount: 0 } } }, env);
    const rec = readHistory({ scope: "everywhere" }, env)[0].pastedContents![1];
    expect(resolvePastedContent(rec, env)).toBe(big);
  });

  it("is null on a cache miss — the `content no longer available` case", () => {
    expect(resolvePastedContent({ id: 1, type: "text", contentHash: "deadbeefdeadbeef" }, env)).toBeNull();
  });

  it("is null when the record carries neither arm", () => {
    expect(resolvePastedContent({ id: 1, type: "text" }, env)).toBeNull();
  });

  it("treats an empty inlined content as absent — upstream's `||`, not `??`", () => {
    expect(resolvePastedContent({ id: 1, type: "text", content: "" }, env)).toBeNull();
  });
});

describe("mode ⇄ display — hon / mP / LV", () => {
  it("prefixes a bash submission with `!` and leaves a prompt alone", () => {
    expect(displayForMode("ls -la", "bash")).toBe("!ls -la");
    expect(displayForMode("ls -la", "prompt")).toBe("ls -la");
  });

  // WAVE C TASK 14 folded `mP` (`modeOfDisplay`) into `composerMode`: with the `#` memory mode gone the two
  // were one rename apart — the same reading under `normal` instead of upstream's `prompt` — and a second
  // function spelling it was the duplication plan-review #23 named. Same three cases, one derivation.
  it("reads the mode back off the stored display", () => {
    expect(composerMode("!ls")).toBe("bash");
    expect(composerMode("ls")).toBe("normal");
    expect(composerMode("")).toBe("normal");
  });

  it("strips only the bash marker", () => {
    expect(stripModePrefix("!ls")).toBe("ls");
    expect(stripModePrefix("ls")).toBe("ls");
    expect(stripModePrefix("!!x")).toBe("!x");
  });

  it("round-trips through the file, which is how mode persists — there is no `mode` column", () => {
    appendHistory({ display: displayForMode("git status", "bash"), project: PROJ }, env);
    const e: HistoryEntry = readHistory({ scope: "everywhere" }, env)[0];
    expect(e.display).toBe("!git status");
    expect(composerMode(e.display)).toBe("bash");
    expect(stripModePrefix(e.display)).toBe("git status");
    expect("mode" in e).toBe(false);
  });
});

describe("isolation", () => {
  it("never touches a real home — every path derives from CCX_FLEET_ROOT", () => {
    const other = mkdtempSync(join(tmpdir(), "ccx-hist2-"));
    try {
      appendHistory({ display: "a", project: PROJ }, env);
      appendHistory({ display: "b", project: PROJ }, { CCX_FLEET_ROOT: other });
      expect(readHistory({ scope: "everywhere" }, env).map((e) => e.display)).toEqual(["a"]);
      expect(readHistory({ scope: "everywhere" }, { CCX_FLEET_ROOT: other }).map((e) => e.display)).toEqual(["b"]);
    } finally { rmSync(other, { recursive: true, force: true }); }
  });

  it("tolerates a history file that is a directory rather than crashing the composer", () => {
    mkdirSync(historyPath(env), { recursive: true });
    expect(() => appendHistory({ display: "a", project: PROJ }, env)).not.toThrow();
    expect(readHistory({ scope: "everywhere" }, env)).toEqual([]);
  });

  // DBn (L14587) yields the leading remainder buffer even when it is not newline-terminated, so a file
  // truncated mid-flight still gives up its last whole line. Ours must too.
  it("reads a final line that has no trailing newline", () => {
    mkdirSync(env.CCX_FLEET_ROOT!, { recursive: true });
    writeFileSync(historyPath(env), JSON.stringify({ display: "tail", timestamp: 1, project: PROJ }));
    expect(readHistory({ scope: "everywhere" }, env).map((e) => e.display)).toEqual(["tail"]);
  });
});
