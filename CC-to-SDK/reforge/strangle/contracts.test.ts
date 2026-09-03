// Contract tests for the owned parity implementations (campaign spec §2.4).
//
//   npx tsx strangle/contracts.test.ts
//
// Why this exists. A `pure-helper` capture is owned outright: the module ships
// its own implementation and the graph's function is never called. §2.4 says the
// drift that buys is caught by "the differential surfaces the helper's output
// flows into, PLUS a small contract test over partitioned inputs where the
// helper's domain is wider than the corpus exercises" — and after C4's retrofit
// that second clause is doing most of the work. The corpus renders ONE of Read's
// six result arms, ONE of Grep's three, the plain stdout path of Bash's six, and
// NEVER truncates a Glob result at all, so a wrong branch in an owned module is
// invisible to a green gate.
//
// So: every owned helper and every formatter arm the corpus does not reach is
// partitioned here, with the expectation written out in full rather than
// computed — a test that recomputes the implementation grades nothing.
//
// Loaded through runtime paths (the reference modules are plain ESM `.js`, which
// is what lets the strangled graph and the engine-ts skeleton import the SAME
// file), so this file sees them untyped, exactly as both wirings do.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REFORGE_ROOT } from "../src/runTurn.js";

const MODULES = join(REFORGE_ROOT, "strangle", "modules");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Module = Record<string, any>;
const load = (name: string): Promise<Module> =>
  import(pathToFileURL(join(MODULES, name)).href) as Promise<Module>;

let pass = 0;
const failures: string[] = [];

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
}
const ok = (label: string, condition: boolean): void => {
  if (condition) pass++;
  else failures.push(label);
};

const shared = {
  formatBytes: (await load("shared/format-bytes.js")).formatBytes,
  FRESHNESS_SUFFIX: (await load("shared/file-state.js")).FRESHNESS_SUFFIX as string,
  assertGraphValue: (await load("shared/assert.js")).assertGraphValue,
};
const glob = await load("glob-result/reference.js");
const write = await load("write-tool-result/reference.js");
const edit = await load("edit-tool-result/reference.js");
const read = await load("read-tool-result/reference.js");
const bash = await load("bash-tool-result/reference.js");
const grep = await load("grep-tool-result/reference.js");
const taskGet = await load("task-get-result/reference.js");
const taskList = await load("task-list-result/reference.js");
const taskUpdate = await load("task-update-result/reference.js");
const taskCreate = await load("task-create-result/reference.js");
const envBlock = await load("env-block/reference.js");
const session = await load("session-materialize/reference.js");

const ID = "toolu_reforge";
const content = (block: { content?: unknown }) => block.content;

// ---- shared: the primitive assertion is the micro-differential check --------
{
  eq("assertGraphValue returns the owned value when they agree",
    shared.assertGraphValue("fixture", "x", "same", "same"), "same");
  let threw = "";
  try {
    shared.assertGraphValue("fixture", "suffix", " drifted", shared.FRESHNESS_SUFFIX);
  } catch (e) {
    threw = String((e as Error).message);
  }
  ok("…and THROWS on drift, naming both sides", threw.includes("no longer equals the owned value") && threw.includes("drifted"));
  ok("the freshness suffix carries an em dash, not a hyphen", shared.FRESHNESS_SUFFIX.includes("—"));
  eq("the freshness suffix, exactly", shared.FRESHNESS_SUFFIX,
    " (file state is current in your context — no need to Read it back)");
}

// ---- shared: formatBytes ----------------------------------------------------
{
  eq("bytes below 1KiB print as raw bytes", shared.formatBytes(999), "999 bytes");
  eq("the KiB boundary is exclusive below", shared.formatBytes(1023), "1023 bytes");
  eq("exactly 1KiB is 1KB, with the .0 stripped", shared.formatBytes(1024), "1KB");
  eq("a fractional KB keeps one decimal", shared.formatBytes(1536), "1.5KB");
  eq("the persisted-output preview budget renders as 2KB", shared.formatBytes(2000), "2KB");
  eq("MB", shared.formatBytes(5 * 1024 * 1024), "5MB");
  eq("GB", shared.formatBytes(3 * 1024 * 1024 * 1024), "3GB");
  eq("zero", shared.formatBytes(0), "0 bytes");
}

// ---- Glob: the truncation notice (ZERO corpus coverage — §2.4 mandatory) ----
{
  const notice = glob.truncationNotice;
  eq("no total at all",
    notice({ filenames: ["a", "b"], totalMatches: undefined, countIsComplete: false }),
    "(Results are truncated. Consider using a more specific path or pattern.)");
  eq("a complete count names the remainder exactly",
    notice({ filenames: ["a", "b"], totalMatches: 5, countIsComplete: true }),
    "(Showing 2 of 5 matching files; 3 more are not listed. Narrow the pattern or path to see the rest.)");
  eq("a complete count with a ZERO remainder still uses the complete wording",
    notice({ filenames: ["a", "b"], totalMatches: 2, countIsComplete: true }),
    "(Showing 2 of 2 matching files; 0 more are not listed. Narrow the pattern or path to see the rest.)");
  eq("an incomplete count can only say 'more than'",
    notice({ filenames: ["a"], totalMatches: 100, countIsComplete: false }),
    "(Showing the first 1 files; there are more than 100 matches. Narrow the pattern or path to see the rest.)");
  // …and the formatter's own two arms.
  eq("no files", content(glob.globResultBlock({ filenames: [], truncated: false }, ID)), "No files found");
  eq("untruncated results are just the names",
    content(glob.globResultBlock({ filenames: ["a.txt", "b.txt"], truncated: false }, ID)), "a.txt\nb.txt");
  eq("a truncated result appends the notice as a final line",
    content(glob.globResultBlock({ filenames: ["a.txt"], truncated: true, totalMatches: undefined }, ID)),
    "a.txt\n(Results are truncated. Consider using a more specific path or pattern.)");
}

// ---- Write: the arms the corpus does not reach ------------------------------
{
  const S = shared.FRESHNESS_SUFFIX;
  eq("create, clean", content(write.writeToolResultBlock({ filePath: "/p", type: "create" }, ID)),
    `File created successfully at: /p${S}`);
  eq("update, clean", content(write.writeToolResultBlock({ filePath: "/p", type: "update" }, ID)),
    `The file /p has been updated successfully.${S}`);
  eq("a user-modified write drops the suffix and adds the note",
    content(write.writeToolResultBlock({ filePath: "/p", type: "create", userModified: true }, ID)),
    "File created successfully at: /p The user modified your proposed content before accepting it.");
  eq("a memdir-stamped write drops the suffix silently",
    content(write.writeToolResultBlock({ filePath: "/p", type: "create", memdirStamped: true }, ID)),
    "File created successfully at: /p");
  eq("an unknown result type produces nothing at all, as upstream does",
    write.writeToolResultBlock({ filePath: "/p", type: "wat" }, ID), undefined);
}

// ---- Edit: two arms x three suffix states -----------------------------------
{
  const S = shared.FRESHNESS_SUFFIX;
  eq("single occurrence", content(edit.editToolResultBlock({ filePath: "/p" }, ID)),
    `The file /p has been updated successfully.${S}`);
  eq("replace_all", content(edit.editToolResultBlock({ filePath: "/p", replaceAll: true }, ID)),
    `The file /p has been updated. All occurrences were successfully replaced.${S}`);
  eq("a user-modified edit inserts the note and drops the suffix — doubled sentence break and all",
    content(edit.editToolResultBlock({ filePath: "/p", userModified: true }, ID)),
    "The file /p has been updated successfully.  The user modified your proposed changes before accepting them. .");
  eq("…and on the replace_all arm too",
    content(edit.editToolResultBlock({ filePath: "/p", userModified: true, replaceAll: true }, ID)),
    "The file /p has been updated.  The user modified your proposed changes before accepting them. . All occurrences were successfully replaced.");
  eq("a stale-recovered edit wins over both other suffix states",
    content(edit.editToolResultBlock({ filePath: "/p", staleRecovered: true, userModified: true }, ID)),
    "The file /p has been updated successfully.  The user modified your proposed changes before accepting them. . (note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.)");
  eq("memdir-stamped drops the suffix", content(edit.editToolResultBlock({ filePath: "/p", memdirStamped: true }, ID)),
    "The file /p has been updated successfully.");
}

// ---- Read: the numbering helpers and all six result arms --------------------
{
  eq("one numbered line", read.numberOneLine("hello", 3, "\t"), "3\thello");
  eq("a trailing CR is stripped", read.numberOneLine("hello\r", 3, "\t"), "3\thello");
  eq("only the LAST CR is stripped", read.numberOneLine("a\rb\r", 1, "\t"), "1\ta\rb");
  eq("empty content numbers to nothing", read.numberLines({ content: "", startLine: 1 }), "");
  eq("cat -n over three lines",
    read.numberLines({ content: "a\nb\nc", startLine: 1 }), "1\ta\n2\tb\n3\tc");
  eq("numbering starts at the window's first line",
    read.numberLines({ content: "x\ny", startLine: 10 }), "10\tx\n11\ty");
  eq("a trailing newline yields a final empty numbered line",
    read.numberLines({ content: "a\n", startLine: 1 }), "1\ta\n2\t");
  eq("the tab-aware separator is OFF by default even for tab-indented content",
    read.numberLines({ content: "\ta\n\tb", startLine: 1 }), "1\t\ta\n2\t\tb");
  eq("with the gate on, leading-tab content switches to a colon",
    read.numberLines({ content: "\ta\n\tb", startLine: 1, tabAwareSeparator: true }), "1:\ta\n2:\tb");
  eq("…and so does content whose tab appears after a newline",
    read.numberLines({ content: "a\n\tb", startLine: 1, tabAwareSeparator: true }), "1:a\n2:\tb");
  eq("…but tab-free content keeps the tab separator even with the gate on",
    read.numberLines({ content: "a\nb", startLine: 1, tabAwareSeparator: true }), "1\ta\n2\tb");

  eq("the seeded 'already in context' notice", read.seededUnchangedNotice("/p"),
    '<system-reminder>This file is already in your context (see "Contents of /p" above) and has not changed on disk. Use that content instead of re-reading.</system-reminder>');
  eq("the plain unchanged notice", read.unchangedNotice(),
    "Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.");

  // notebooks: adjacent text blocks merge, an image breaks the run.
  const cell = (over: Record<string, unknown> = {}) => ({
    cell_id: "c1", cellType: "code", language: "python", source: "print(1)", ...over,
  });
  eq("a code cell in python carries no tags",
    content(read.notebookResultBlock([cell()], ID)),
    [{ text: '<cell id="c1">print(1)</cell id="c1">', type: "text" }]);
  eq("a non-code cell is tagged with its type",
    content(read.notebookResultBlock([cell({ cellType: "markdown", source: "# h" })], ID)),
    [{ text: '<cell id="c1"><cell_type>markdown</cell_type># h</cell id="c1">', type: "text" }]);
  eq("a non-python CODE cell is tagged with its language",
    content(read.notebookResultBlock([cell({ language: "julia" })], ID)),
    [{ text: '<cell id="c1"><language>julia</language>print(1)</cell id="c1">', type: "text" }]);
  eq("two text cells merge into ONE block, newline-joined",
    content(read.notebookResultBlock([cell(), cell({ cell_id: "c2", source: "print(2)" })], ID)),
    [{ text: '<cell id="c1">print(1)</cell id="c1">\n<cell id="c2">print(2)</cell id="c2">', type: "text" }]);
  eq("an image output breaks the text run and keeps its own block",
    content(read.notebookResultBlock(
      [cell({ outputs: [{ image: { image_data: "AAA", media_type: "image/png" } }] }), cell({ cell_id: "c2" })], ID)),
    [
      { text: '<cell id="c1">print(1)</cell id="c1">', type: "text" },
      { type: "image", source: { data: "AAA", media_type: "image/png", type: "base64" } },
      { text: '<cell id="c2">print(1)</cell id="c2">', type: "text" },
    ]);

  const stale = () => "";
  const tabs = () => false;
  eq("image results carry the file's declared media type",
    content(read.readToolResultBlock({ type: "image", file: { base64: "B64", type: "image/png" } }, ID, stale, tabs)),
    [{ type: "image", source: { type: "base64", data: "B64", media_type: "image/png" } }]);
  eq("a pdf WITHOUT base64 degrades to the header line alone",
    content(read.readToolResultBlock({ type: "pdf", file: { filePath: "/d.pdf", originalSize: 2048 } }, ID, stale, tabs)),
    "PDF file read: /d.pdf (2KB)");
  eq("a pdf WITH base64 carries a document block",
    content(read.readToolResultBlock({ type: "pdf", file: { filePath: "/d.pdf", originalSize: 2048, base64: "B" } }, ID, stale, tabs)),
    [
      { type: "text", text: "PDF file read: /d.pdf (2KB)" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "B" } },
    ]);
  eq("extracted pages with none returned degrade to the header",
    content(read.readToolResultBlock({ type: "parts", file: { filePath: "/d.pdf", count: 2, originalSize: 1024 }, pages: [] }, ID, stale, tabs)),
    "PDF pages extracted: 2 page(s) from /d.pdf (1KB)");
  eq("a page that failed renders as text, numbered from firstPage",
    content(read.readToolResultBlock(
      { type: "parts", file: { filePath: "/d.pdf", count: 2, originalSize: 1024 },
        firstPage: 4, pages: [{ base64: "P" , mediaType: "image/png" }, { error: "boom" }] }, ID, stale, tabs)),
    [
      { type: "text", text: "PDF pages extracted: 2 page(s) from /d.pdf (1KB)" },
      { type: "image", source: { type: "base64", data: "P", media_type: "image/png" } },
      { type: "text", text: "[Page 5 could not be processed as an image: boom]" },
    ]);
  eq("a failed page with no error message omits the colon clause",
    content(read.readToolResultBlock(
      { type: "parts", file: { filePath: "/d.pdf", count: 1, originalSize: 1024 }, pages: [{}] }, ID, stale, tabs)),
    [
      { type: "text", text: "PDF pages extracted: 1 page(s) from /d.pdf (1KB)" },
      { type: "text", text: "[Page 1 could not be processed as an image]" },
    ]);
  eq("a seeded unchanged file gets the 'already in your context' notice",
    content(read.readToolResultBlock({ type: "file_unchanged", source: "seeded", file: { filePath: "/p" } }, ID, stale, tabs)),
    read.seededUnchangedNotice("/p"));
  eq("any other unchanged file gets the wasted-call notice",
    content(read.readToolResultBlock({ type: "file_unchanged", source: "read", file: { filePath: "/p" } }, ID, stale, tabs)),
    read.unchangedNotice());
  eq("text with content is numbered",
    content(read.readToolResultBlock({ type: "text", file: { content: "a\nb", startLine: 1 } }, ID, stale, tabs)),
    "1\ta\n2\tb");
  eq("the staleness PORT prefixes the numbered content",
    content(read.readToolResultBlock({ type: "text", file: { content: "a", startLine: 1 } }, ID,
      () => "<system-reminder>This memory is 3 days old.</system-reminder>\n", tabs)),
    "<system-reminder>This memory is 3 days old.</system-reminder>\n1\ta");
  eq("the tab-aware PORT reaches the numbering",
    content(read.readToolResultBlock({ type: "text", file: { content: "\ta", startLine: 1 } }, ID, stale, () => true)),
    "1:\ta");
  eq("a window past the end of a multi-line file emits its start line, empty",
    content(read.readToolResultBlock({ type: "text", file: { content: "", numLines: 1, totalLines: 9, startLine: 7 } }, ID, stale, tabs)),
    "7\t");
  eq("an empty file warns about emptiness",
    content(read.readToolResultBlock({ type: "text", file: { content: "", numLines: 0, totalLines: 0, startLine: 1 } }, ID, stale, tabs)),
    "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>");
  eq("an offset past a one-line file warns about the offset",
    content(read.readToolResultBlock({ type: "text", file: { content: "", numLines: 0, totalLines: 1, startLine: 9 } }, ID, stale, tabs)),
    "<system-reminder>Warning: the file exists but is shorter than the provided offset (9). The file has 1 lines.</system-reminder>");
}

// ---- Bash: every arm the four covering scenarios never take -----------------
{
  const noPath = () => {
    throw new Error("backgroundOutputPath must not be called without a background task id");
  };
  const noAck = () => {
    throw new Error("task-ack ports must not be called while useTaskAck() is false");
  };
  const plain = (over: Record<string, unknown>) =>
    bash.bashToolResultBlock({ stdout: "", stderr: "", ...over }, ID, noPath, noAck, noAck);

  eq("the preview splitter passes short text through",
    bash.splitPreview("abc", 10), { preview: "abc", hasMore: false });
  eq("…cuts at the last newline INSIDE the budget when it is past halfway",
    bash.splitPreview("aaaaa\nbbbbbb", 8), { preview: "aaaaa", hasMore: true });
  eq("…and hard-cuts at the budget when the only newline is too early",
    bash.splitPreview("a\nbbbbbbbbbb", 8), { preview: "a\nbbbbbb", hasMore: true });
  eq("…the halfway test is STRICT, so a newline exactly at half still hard-cuts",
    bash.splitPreview("aaaa\nbbbbbb", 8), { preview: "aaaa\nbbb", hasMore: true });
  eq("the persisted-output notice, with more to come",
    bash.persistedOutputNotice({ filepath: "/out.log", originalSize: 1048576, preview: "head", hasMore: true }),
    "<persisted-output>\nOutput too large (1MB). Full output saved to: /out.log\n\nPreview (first 2KB):\nhead\n...\n</persisted-output>");
  eq("…and without",
    bash.persistedOutputNotice({ filepath: "/out.log", originalSize: 1024, preview: "all", hasMore: false }),
    "<persisted-output>\nOutput too large (1KB). Full output saved to: /out.log\n\nPreview (first 2KB):\nall\n</persisted-output>");

  eq("a plain background notice", bash.backgroundNotice({ backgroundTaskId: "t1", outputPath: "/o", readToolName: "Read" }),
    "Command running in background with ID: t1. Output is being written to: /o. You will be notified when it completes. To check interim output, use Read on that file path.");
  eq("a user-backgrounded command says neither of the trailing sentences",
    bash.backgroundNotice({ backgroundTaskId: "t1", outputPath: "/o", backgroundedByUser: true, readToolName: "Read" }),
    "Command was manually backgrounded by user with ID: t1. Output is being written to: /o.");
  eq("a message-delivery backgrounding explains it was not interrupted",
    bash.backgroundNotice({ backgroundTaskId: "t1", outputPath: "/o", backgroundedToDeliverMessage: true, readToolName: "Read" }),
    "Command was moved to the background (ID: t1) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: /o. You will be notified when it completes. To check interim output, use Read on that file path.");
  eq("a timeout backgrounding rounds the timeout to whole seconds, floor 1",
    bash.backgroundNotice({ backgroundTaskId: "t1", outputPath: "/o", timedOutAfterMs: 120_000, readToolName: "Read" }),
    "Command did not complete within its 120s timeout and was moved to the background (ID: t1). Output is being written to: /o. You will be notified when it completes. To check interim output, use Read on that file path.");
  ok("…and a sub-second timeout still reports 1s",
    String(bash.backgroundNotice({ backgroundTaskId: "t1", outputPath: "/o", timedOutAfterMs: 5, readToolName: "Read" })).includes("its 1s timeout"));
  ok("a final-response reaping replaces the notification sentence",
    String(bash.backgroundNotice({ backgroundTaskId: "t1", outputPath: "/o", reapedAtFinalResponse: true, readToolName: "Read" }))
      .includes("do not end your turn to wait for it"));

  const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  eq("stdout that is a PNG data url becomes an image block, media type from the MAGIC BYTES",
    content(bash.imageResultBlock(`data:image/jpeg;base64,${PNG}`, ID)),
    [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }]);
  eq("stdout that is not a data url is not an image", bash.imageResultBlock("hello", ID), null);
  eq("a data url whose bytes are not a known image is rejected",
    bash.imageResultBlock(`data:image/png;base64,${Buffer.from("not an image").toString("base64")}`, ID), null);
  eq("the task-ack policy predicate is false in this build", bash.useTaskAck(), false);

  eq("structured content short-circuits everything",
    content(plain({ structuredContent: [{ type: "text", text: "S" }] })), [{ type: "text", text: "S" }]);
  eq("plain stdout is trimmed of leading blank lines and trailing space",
    content(plain({ stdout: "\n\n  out  \n\n" })), "  out");
  eq("stderr follows stdout on its own line",
    content(plain({ stdout: "out", stderr: " err \n" })), "out\nerr");
  eq("an interrupted command appends the abort marker",
    content(plain({ stdout: "out", interrupted: true })), "out\n<error>Command was aborted before completion</error>");
  eq("…separated from stderr by the owned newline when there is stderr",
    content(plain({ stderr: "err", interrupted: true })), "err\n<error>Command was aborted before completion</error>");
  ok("…and is_error tracks `interrupted`",
    (plain({ stdout: "x", interrupted: true }) as { is_error?: boolean }).is_error === true &&
      (plain({ stdout: "x" }) as { is_error?: boolean }).is_error === undefined);
  eq("the stale-read and gh-rate-limit hints are appended last, in that order",
    content(plain({ stdout: "out", staleReadFileStateHint: "STALE", ghRateLimitHint: "GH" })), "out\nSTALE\nGH");
  eq("persisted output replaces stdout with the notice",
    content(plain({ stdout: "x".repeat(3000), persistedOutputPath: "/o.log", persistedOutputSize: 3000 })),
    bash.persistedOutputNotice({ filepath: "/o.log", originalSize: 3000, preview: "x".repeat(2000), hasMore: true }));
  eq("an image result with trailing stderr appends a text block",
    content(bash.bashToolResultBlock(
      { stdout: `data:image/png;base64,${PNG}`, stderr: " warn ", isImage: true }, ID, noPath, noAck, noAck)),
    [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }, { type: "text", text: "warn" }]);
  eq("an isImage result whose stdout is NOT an image falls through to the text path",
    content(bash.bashToolResultBlock({ stdout: "not an image", stderr: "", isImage: true }, ID, noPath, noAck, noAck)),
    "not an image");
  eq("a backgrounded command carries the notice and reaches the output-path PORT",
    content(bash.bashToolResultBlock(
      { stdout: "", stderr: "", backgroundTaskId: "t9" }, ID, (id: string) => `/tmp/${id}.output`, noAck, noAck)),
    "Command running in background with ID: t9. Output is being written to: /tmp/t9.output. You will be notified when it completes. To check interim output, use Read on that file path.");
  ok("…and the cwd hint is appended on its own line",
    String(content(bash.bashToolResultBlock(
      { stdout: "", stderr: "", backgroundTaskId: "t9", backgroundCwdHint: "CWD" }, ID, () => "/o", noAck, noAck)))
      .endsWith("\nCWD"));
  // The task-ack branch is UNREACHABLE while the owned predicate is false — the
  // two `noAck` stubs above throw, so every case here also proves it is never
  // entered. An upstream flip moves useTaskAck's footprint hash and stales the
  // row (§5); it cannot pass silently.
}

// ---- Grep: the content and count arms, neither of which the corpus renders --
{
  eq("no pagination applied", grep.paginationNote(undefined, undefined), "");
  eq("limit only", grep.paginationNote(10, undefined), "limit: 10");
  eq("offset only", grep.paginationNote(undefined, 5), "offset: 5");
  eq("both", grep.paginationNote(10, 5), "limit: 10, offset: 5");
  eq("a zero offset is not applied", grep.paginationNote(10, 0), "limit: 10");
  eq("plural, singular", grep.plural(1, "file"), "file");
  eq("plural, default plural form", grep.plural(2, "file"), "files");
  eq("plural, explicit plural form", grep.plural(2, "match", "matches"), "matches");

  const g = (over: Record<string, unknown>) => content(grep.grepToolResultBlock(over, ID));
  eq("content mode returns the matched text",
    g({ mode: "content", content: "line" }), "line");
  eq("content mode appends the pagination footer when one applies",
    g({ mode: "content", content: "line", appliedLimit: 2 }), "line\n\n[Showing results with pagination = limit: 2]");
  eq("content mode with an offset past the end says so",
    g({ mode: "content", content: "", appliedOffset: 5, totalLines: 9 }),
    "No entries at this offset\n\n[Showing results with pagination = offset: 5]");
  eq("content mode with nothing at all says no matches",
    g({ mode: "content", content: "" }), "No matches found");
  eq("count mode tallies, singular",
    g({ mode: "count", content: "a.txt:1", numMatches: 1, numFiles: 1 }),
    "a.txt:1\n\nFound 1 total occurrence across 1 file.");
  eq("count mode tallies, plural",
    g({ mode: "count", content: "a:2\nb:3", numMatches: 5, numFiles: 2 }),
    "a:2\nb:3\n\nFound 5 total occurrences across 2 files.");
  eq("count mode with no content and no matches",
    g({ mode: "count", content: "", numMatches: 0, numFiles: 0 }),
    "No matches found\n\nFound 0 total occurrences across 0 files.");
  eq("count mode appends pagination inline",
    g({ mode: "count", content: "a:1", numMatches: 1, numFiles: 1, appliedLimit: 3 }),
    "a:1\n\nFound 1 total occurrence across 1 file. with pagination = limit: 3");
  eq("files mode with no files",
    g({ mode: "files_with_matches", numFiles: 0, filenames: [] }), "No files found");
  eq("files mode with an offset past the end",
    g({ mode: "files_with_matches", numFiles: 0, filenames: [], appliedOffset: 4, totalFiles: 9 }),
    "No entries at this offset. [Showing results with pagination = offset: 4]");
  eq("files mode, one file",
    g({ mode: "files_with_matches", numFiles: 1, filenames: ["a.txt"] }), "Found 1 file\na.txt");
  eq("files mode, several files with pagination",
    g({ mode: "files_with_matches", numFiles: 2, filenames: ["a", "b"], appliedLimit: 2 }),
    "Found 2 files limit: 2\na\nb");
}

// ---- the task family --------------------------------------------------------
{
  eq("TaskCreate", content(taskCreate.taskCreateResultBlock({ task: { id: 7, subject: "S" } }, ID)),
    "Task #7 created successfully: S");

  const task = (over: Record<string, unknown> = {}) => ({
    id: 1, subject: "S", status: "pending", description: "D", blockedBy: [], blocks: [], ...over,
  });
  eq("TaskGet, missing", content(taskGet.taskGetResultBlock({ task: undefined }, ID)), "Task not found");
  eq("TaskGet, plain", content(taskGet.taskGetResultBlock({ task: task() }, ID)),
    "Task #1: S\nStatus: pending\nDescription: D");
  eq("TaskGet, with both dependency directions",
    content(taskGet.taskGetResultBlock({ task: task({ blockedBy: [2, 3], blocks: [4] }) }, ID)),
    "Task #1: S\nStatus: pending\nDescription: D\nBlocked by: #2, #3\nBlocks: #4");

  eq("TaskList, empty", content(taskList.taskListResultBlock({ tasks: [] }, ID)), "No tasks found");
  eq("TaskList, plain", content(taskList.taskListResultBlock({ tasks: [task()] }, ID)), "#1 [pending] S");
  eq("TaskList, with an owner and a blocker",
    content(taskList.taskListResultBlock({ tasks: [task({ owner: "alice", blockedBy: [2] })] }, ID)),
    "#1 [pending] S (alice) [blocked by #2]");

  const off = () => false;
  const on = () => true;
  eq("TaskUpdate, failure with a message",
    content(taskUpdate.taskUpdateResultBlock({ success: false, taskId: 1, error: "nope" }, ID, off, off)), "nope");
  eq("TaskUpdate, failure without one",
    content(taskUpdate.taskUpdateResultBlock({ success: false, taskId: 1 }, ID, off, off)), "Task #1 not found");
  eq("TaskUpdate, success lists the changed fields",
    content(taskUpdate.taskUpdateResultBlock({ success: true, taskId: 1, updatedFields: ["status", "owner"] }, ID, off, off)),
    "Updated task #1 status, owner");
  eq("TaskUpdate, completing a task adds NO nudge while the ports are false — the headless case",
    content(taskUpdate.taskUpdateResultBlock(
      { success: true, taskId: 1, updatedFields: ["status"], statusChange: { to: "completed" } }, ID, off, off)),
    "Updated task #1 status");
  eq("…and adds it when both ports say yes — the branch the corpus cannot reach",
    content(taskUpdate.taskUpdateResultBlock(
      { success: true, taskId: 1, updatedFields: ["status"], statusChange: { to: "completed" } }, ID, on, on)),
    "Updated task #1 status\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.");
  eq("…and needs BOTH ports, not either",
    content(taskUpdate.taskUpdateResultBlock(
      { success: true, taskId: 1, updatedFields: ["status"], statusChange: { to: "completed" } }, ID, on, off)),
    "Updated task #1 status");
}

// ---- the W0 spikes' newly owned helpers -------------------------------------
{
  eq("the model sentence, named model", envBlock.primarySection({ marketingName: "Opus 5", modelId: "claude-opus-5" }),
    "You are powered by the model named Opus 5. The exact model ID is claude-opus-5.");
  eq("…and unnamed", envBlock.primarySection({ modelId: "claude-opus-5" }),
    "You are powered by the model claude-opus-5.");
  eq("the cutoff sentence", envBlock.secondarySection({ knowledgeCutoff: "May 2026" }),
    "Assistant knowledge cutoff is May 2026.");
  eq("…is null when there is no cutoff", envBlock.secondarySection({}), null);

  eq("a node fs error yields its code", session.errorCode({ code: "ENOENT", errno: -2 }), "ENOENT");
  eq("a plain Error has no code", session.errorCode(new Error("x")), undefined);
  eq("null has no code", session.errorCode(null), undefined);
  eq("an errno makes a failure EXPECTED", session.isExpected({ errno: -2 }), true);
  eq("a plain Error is a defect, not an expected failure", session.isExpected(new Error("x")), false);
  eq("null is not expected either", session.isExpected(null), false);
  eq("an Error formats as its message", session.formatError(new Error("boom")), "boom");
  eq("anything else stringifies", session.formatError({ toString: () => "odd" }), "odd");
}

// ---- the shutdown COORDINATOR's claim pair (C16b / W13b) -------------------
// Both halves are corpus-DARK, and their manifest rows name this file as what
// grades them instead. The darkness is measured rather than assumed — each
// facade's call sites were enumerated from the artifact and every one of them
// unmounts or re-execs a terminal UI, which a headless run has none of — so what
// is left to grade is the pair's own semantics, and there are exactly two things
// to say about them.
//
// THE SECOND STATEMENT IS THE ONE THAT MATTERS. Each method is two statements,
// and a reader who only saw the flag would call the pair a boolean setter. The
// other statement disarms and re-arms the ORPHAN CHECK — the 30-second watchdog
// that shuts the process down with 129 when its stdout stops being writable,
// which is exactly what a deliberate teardown looks like from the outside. So a
// claim that forgot to disarm would leave a shutdown racing its own watchdog,
// and the assertions below are written against the RECEIVER's call log rather
// than against the flag alone, because the flag is the half that cannot fail
// quietly.
{
  const claim = (await load("twn-claim-shutdown/reference.js")).twnClaimShutdown;
  const release = (await load("twn-release-shutdown-claim/reference.js")).twnReleaseShutdownClaim;

  /** A recording stand-in for the coordinator instance: the flag, plus what was called on it. */
  const coordinator = (shutdownInProgress = false) => {
    const calls: string[] = [];
    return {
      shutdownInProgress,
      calls,
      disarmOrphanCheck() {
        calls.push("disarmOrphanCheck");
      },
      armOrphanCheck() {
        calls.push("armOrphanCheck");
      },
    };
  };

  const claimed = coordinator(false);
  claim(claimed);
  eq("claiming sets the in-progress flag", claimed.shutdownInProgress, true);
  eq("…and disarms the orphan check, which is the half a flag setter would drop", claimed.calls, ["disarmOrphanCheck"]);

  const released = coordinator(true);
  release(released);
  eq("releasing clears the flag", released.shutdownInProgress, false);
  eq("…and re-arms the watchdog it took away", released.calls, ["armOrphanCheck"]);

  // The pair is an INVERSE, and that is what distinguishes it from the shutdown
  // latch one module over — which has a setter and no clearer anywhere in the
  // bundle. Asserting the round trip is asserting the difference.
  const roundTrip = coordinator(false);
  claim(roundTrip);
  release(roundTrip);
  eq("claim then release returns the coordinator to where it started", roundTrip.shutdownInProgress, false);
  eq("…having disarmed and re-armed exactly once each, in that order", roundTrip.calls, ["disarmOrphanCheck", "armOrphanCheck"]);

  // Neither is idempotent-by-guard: upstream writes the flag unconditionally,
  // so a second claim disarms a second time. Recorded because an owned copy
  // that "helpfully" guarded would change how many timers the graph clears.
  const twice = coordinator(false);
  claim(twice);
  claim(twice);
  eq("claiming twice disarms twice — upstream has no guard and neither does this", twice.calls, ["disarmOrphanCheck", "disarmOrphanCheck"]);
}

// ---- the coordinator's SYNCHRONOUS shutdown entry point (C16b / W13b) ------
// One branch, and the corpus renders one of its two arms: a headless run shuts
// down exactly once, so the re-entry arm — a second synchronous request while
// the first is still running — is unreachable by construction. The attestation
// excludes it by name and points here, which is §2.4's bargain: an arm no
// scenario renders is graded against upstream's own shape instead.
//
// `process.exitCode` IS THE POINT AND IS ALSO THIS PROCESS'S EXIT CODE. The
// method's whole synchronous half is that assignment plus the latch commit, so
// the assertions have to observe it for real; the original value is restored
// afterwards, because a contract test that left the suite exiting 143 would be
// a spectacular way to grade nothing.
{
  const shutdownSync = (await load("twn-shutdown-sync/reference.js")).twnShutdownSync;
  const savedExitCode = process.exitCode;

  /** A recording stand-in for the coordinator, with `shutdown` scripted per case. */
  const coordinator = (shutdownInProgress: boolean, shutdown: () => Promise<void>) => {
    const calls: string[] = [];
    return {
      shutdownInProgress,
      pendingShutdown: undefined as Promise<void> | undefined,
      calls,
      shutdown(code: number, reason: string) {
        calls.push(`shutdown(${code},${reason})`);
        return shutdown();
      },
      printResumeHint() {
        calls.push("printResumeHint");
      },
      async armFailsafeAndDrainStdout(code: number) {
        calls.push(`armFailsafeAndDrainStdout(${code})`);
      },
      forceExit(code: number) {
        calls.push(`forceExit(${code})`);
      },
    };
  };
  const ports = () => {
    const log: string[] = [];
    return {
      log,
      commitShutdown: () => log.push("commitShutdown"),
      logError: (msg: string) => log.push(`logError:${String(msg)}`),
      resetTerminal: () => log.push("resetTerminal"),
    };
  };

  // --- the T arm: no shutdown in flight --------------------------------------
  {
    process.exitCode = 0;
    const p = ports();
    const c = coordinator(false, async () => {});
    shutdownSync(c, 143, "signal", p.commitShutdown, p.logError, p.resetTerminal);
    eq("a first request stamps the exit status", process.exitCode, 143);
    eq("…and commits the shutdown latch", p.log, ["commitShutdown"]);
    eq("…and hands the rest to the async half", c.calls, ["shutdown(143,signal)"]);
    ok("…parking it on the instance for callers that await one", c.pendingShutdown instanceof Promise);
    await c.pendingShutdown;
  }

  // --- the F arm: a shutdown is already in flight ------------------------------
  // THE ARM NO SCENARIO RENDERS, and the interesting part is what it does NOT
  // skip: the guard covers only the status stamp and the commit, so the async
  // half is entered a SECOND time. That is upstream's shape and not a defect to
  // tidy — `shutdown` has its own re-entry guard on the same flag and returns
  // immediately — and an owned copy that wrapped the whole body in the guard
  // would stop parking a promise the second caller may already be awaiting.
  {
    process.exitCode = 7;
    const p = ports();
    const c = coordinator(true, async () => {});
    shutdownSync(c, 143, "signal", p.commitShutdown, p.logError, p.resetTerminal);
    eq("a re-entrant request leaves the exit status alone", process.exitCode, 7);
    eq("…and does not commit the latch a second time", p.log, []);
    eq("…but still enters the async half, because the guard covers only the two synchronous statements", c.calls, ["shutdown(143,signal)"]);
    await c.pendingShutdown;
  }

  // --- the catch chain, which is two deep --------------------------------------
  {
    process.exitCode = 0;
    const p = ports();
    const c = coordinator(false, async () => {
      throw new Error("hooks hung");
    });
    shutdownSync(c, 143, "signal", p.commitShutdown, p.logError, p.resetTerminal);
    await c.pendingShutdown;
    eq("a graceful shutdown that rejects is logged, and carries upstream's own sentence with the error interpolated", p.log, [
      "commitShutdown",
      "logError:Graceful shutdown failed: Error: hooks hung",
      "resetTerminal",
    ]);
    eq("…and the brutal version runs in its place, in order", c.calls, [
      "shutdown(143,signal)",
      "printResumeHint",
      "armFailsafeAndDrainStdout(143)",
      "forceExit(143)",
    ]);
  }

  // …and the SECOND catch, which is what stops a failure during teardown from
  // becoming an unhandled rejection on the way out.
  {
    process.exitCode = 0;
    const p = ports();
    const c = coordinator(false, async () => {
      throw new Error("first");
    });
    c.forceExit = () => {
      throw new Error("and the failsafe threw too");
    };
    shutdownSync(c, 143, "signal", p.commitShutdown, p.logError, p.resetTerminal);
    let settled = "pending";
    await c.pendingShutdown!.then(() => (settled = "resolved"), () => (settled = "rejected"));
    eq("a throw inside the failure handler is swallowed by the second catch", settled, "resolved");
  }

  process.exitCode = savedExitCode;
}

// ---- the headless dispatcher's SIGINT handler (C16b / W13b) ----------------
// Three arms, and the covering plan renders exactly one path through them: a
// first interrupt during a live turn. The other arms are the ones an operator
// actually meets — a SECOND Ctrl-C while the shutdown is already running, and an
// interrupt when no query is in flight — and neither is recordable, because a
// scenario delivers one signal to one turn. The attestation excludes them by
// name and points here.
//
// The PORT TRACE is the assertion, not the return value: the handler returns
// nothing, and its three arms differ from each other in nothing but which ports
// ran and in what order. That is the same argument W6's permission refusals and
// W4's compaction guards make, and it is why each case below compares a log.
{
  const sigint = (await load("ky-sigint-handler/reference.js")).kySigintHandler;

  const ports = (claimed: boolean, query: { signal: { aborted: boolean }; abort(r: unknown): void } | undefined) => {
    const log: string[] = [];
    return {
      log,
      args: [
        (level: string, event: string, payload: { signal: string }) => log.push(`logEvent:${level}:${event}:${payload.signal}`),
        () => {
          log.push("coordinatorIsShuttingDown");
          return claimed;
        },
        () => log.push("resetTerminal"),
        query,
        (reason: string) => {
          log.push(`abortReason:${reason}`);
          return { reason };
        },
        { abort: () => log.push("runController.abort") },
        (code: number) => log.push(`requestShutdown:${code}`),
      ] as const,
    };
  };
  const liveQuery = (aborted: boolean, log: string[]) => ({
    signal: { aborted },
    abort: (r: unknown) => log.push(`query.abort:${(r as { reason: string }).reason}`),
  });

  // ARM 1 — a repeat interrupt: the coordinator's claim is already taken.
  {
    const p = ports(true, undefined);
    sigint(...p.args);
    eq("a repeat interrupt logs, resets the terminal and stops there", p.log, [
      "logEvent:info:shutdown_signal:SIGINT",
      "coordinatorIsShuttingDown",
      "resetTerminal",
    ]);
    ok("…and asks for no second shutdown", !p.log.some((l) => l.startsWith("requestShutdown")));
    ok("…and aborts nothing", !p.log.some((l) => l.includes("abort")));
  }

  // ARM 2 — the covering path: a first interrupt with a live turn.
  {
    const log: string[] = [];
    const p = ports(false, liveQuery(false, log));
    sigint(...p.args);
    eq("a first interrupt cancels the turn, aborts the run and exits ZERO", p.log, [
      "logEvent:info:shutdown_signal:SIGINT",
      "coordinatorIsShuttingDown",
      "abortReason:user-cancel",
      "runController.abort",
      "resetTerminal",
      "requestShutdown:0",
    ]);
    eq("…and the cancellation reaches the query with upstream's own reason", log, ["query.abort:user-cancel"]);
  }

  // ARM 3 — no query in flight. The abort is skipped and the shutdown is not.
  {
    const p = ports(false, undefined);
    sigint(...p.args);
    eq("an interrupt between turns skips the query abort and still shuts down", p.log, [
      "logEvent:info:shutdown_signal:SIGINT",
      "coordinatorIsShuttingDown",
      "runController.abort",
      "resetTerminal",
      "requestShutdown:0",
    ]);
  }

  // ARM 3b — the `&&`'s second operand: a query that is ALREADY aborted is not
  // re-aborted. Upstream's guard, and the arm a copy that wrote `if (query)`
  // would lose.
  {
    const log: string[] = [];
    const p = ports(false, liveQuery(true, log));
    sigint(...p.args);
    eq("an already-aborted query is not aborted again", log, []);
    eq("…and the rest of the handler runs unchanged", p.log, [
      "logEvent:info:shutdown_signal:SIGINT",
      "coordinatorIsShuttingDown",
      "runController.abort",
      "resetTerminal",
      "requestShutdown:0",
    ]);
  }

  // THE TELEMETRY IS OUTSIDE THE BRANCH, which upstream expresses with a comma
  // operator inside the `if` condition. Stated as its own claim because it is
  // the one detail of this handler a faithful-looking rewrite would drop: put
  // the log inside the branch and repeat interrupts stop being recorded.
  {
    const p = ports(true, undefined);
    sigint(...p.args);
    eq("the signal is logged on EVERY arm, including the one that returns early", p.log[0], "logEvent:info:shutdown_signal:SIGINT");
  }
}

// ---- LifecyclePort, the composed seam (C16b / W13b) ------------------------
// The port is the thing C10.7/C10.8 import, so what it owes a contract test is
// not the members' behaviour — each is asserted above — but the WIRING: that
// each member reaches the implementation it claims to, and that the two flags
// stay apart. A port that quietly bound `isShuttingDown` to the claim would pass
// every test in this file except this one, and would then hang the executor on a
// shutdown that was about to be released.
{
  const { lifecyclePort, LIFECYCLE_PORT_MEMBERS } = await load("shared/lifecycle-port.js");
  const latch = await load("process-lifecycle/reference.js");

  const coordinator = { shutdownInProgress: false, disarmOrphanCheck() {}, armOrphanCheck() {} };
  const port = lifecyclePort(coordinator);

  eq("the port ships exactly the members it declares", Object.keys(port).sort(), [...LIFECYCLE_PORT_MEMBERS].sort());
  ok("…and every one of them is callable", LIFECYCLE_PORT_MEMBERS.every((m: string) => typeof port[m] === "function"));

  // THE TWO FLAGS ARE NOT THE SAME FLAG, asserted by moving one and watching the
  // other stay put. This is the whole reason the port has five members.
  eq("the claim starts clear", port.shutdownClaimed(), false);
  port.claimShutdown();
  eq("claiming moves the CLAIM", port.shutdownClaimed(), true);
  eq("…and does NOT move the latch, which nothing in this process has committed", latch.isShuttingDown(), false);
  ok(
    "a port that bound isShuttingDown to the claim would report the two equal here, and does not",
    port.isShuttingDown() !== port.shutdownClaimed(),
  );
  port.releaseShutdownClaim();
  eq("releasing moves it back — the claim is two-way where the latch is one-way", port.shutdownClaimed(), false);

  // The latch half reaches the SAME module instance the strangled graph uses,
  // which is what "one latch per process" means once two importers exist.
  eq("the port's latch reader is the owned module's own", port.isShuttingDown(), latch.isShuttingDown());
  // Identity, not equality: a port that minted `new Promise(() => {})` per call
  // would satisfy every awaiter and fail this, which is the difference that
  // matters to a caller racing two of them.
  eq("the port's hang is the SAME promise the owned module returns", port.hang() === latch.hang(), true);
  eq("…and the same one on every call through the port", port.hang() === port.hang(), true);
}

console.log(`=== owned-implementation contracts: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  // The vacuous-pass shape this file exists to forbid, applied to itself.
  console.log("FAIL — no contract ran");
  process.exitCode = 1;
} else {
  console.log(
    failures.length === 0
      ? "PASS — every owned helper and every uncovered formatter arm matches its recorded upstream behaviour"
      : `FAIL — ${failures.length} contract violation(s)`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
