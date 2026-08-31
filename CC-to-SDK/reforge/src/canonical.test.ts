// §3.4 — one regression test per scrub, both halves.
//
// A scrub is two claims, and only testing the first is how normalization rots:
//   1. it CATCHES the run-scoped value it was written for, and
//   2. it does NOT eat a value-shaped CONTRACT that merely looks similar.
//
// The second half is the one that matters here. A missed match now degrades to a
// FATAL positional fallback, which is loud; a WRONG match silently serves one
// request's response to another and grades green. So every pattern below is
// watched against a deliberately adjacent, must-survive neighbour.
//
// Run: npx tsx src/canonical.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeForHash, canonicalizeToolResultOrder, scrubRequestBody } from "./canonical.js";
import { assertNoKeyCollisions, fallbackVerdict, strictReplay, type CassetteEntry } from "./proxy.js";

const CASSETTES = join(dirname(dirname(fileURLToPath(import.meta.url))), "cassettes");

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

/** Wrap a prose string in a body-shaped envelope so the scrubs run the way they do live. */
const body = (text: string) => JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: [{ type: "text", text }] }] });
const hashed = (text: string) => canonicalizeForHash(body(text));
const differed = (text: string) => scrubRequestBody(body(text));
/** Do two prose bodies canonicalize to the same match key? */
const sameKey = (a: string, b: string) => hashed(a) === hashed(b);

// ---------------------------------------------------------------------------
// agent ids — `a` + 16 hex, engine-minted per run, written into request PROSE.
// ---------------------------------------------------------------------------
{
  const A = "agentId: a8b1bb212b0c2aeb2 (use SendMessage with to: 'a8b1bb212b0c2aeb2')";
  const B = "agentId: a9c2bb770ba007053 (use SendMessage with to: 'a9c2bb770ba007053')";
  check("agentId: two runs canonicalize alike", sameKey(A, B));
  check("agentId: the id really is replaced", !hashed(A).includes("a8b1bb212b0c2aeb2"));
  check("agentId: the surrounding prose survives", hashed(A).includes("use SendMessage with to:"));
  check("agentId: the task output path form is covered", sameKey("/tasks/a8b1bb212b0c2aeb2.output", "/tasks/a9c2bb770ba007053.output"));
  check("agentId: the <task-id> form is covered", sameKey("<task-id>a8b1bb212b0c2aeb2</task-id>", "<task-id>a9c2bb770ba007053</task-id>"));

  // NEGATIVE CONTROLS — value-shaped neighbours that must NOT be eaten.
  const sha1 = "a8b1bb212b0c2aeb2f0e1d2c3b4a5968778899aa"; // 40 hex starting with 'a'
  check("agentId: a 40-hex sha survives (word boundary holds)", hashed(sha1).includes(sha1));
  check("agentId: a 40-hex sha still discriminates", !sameKey(sha1, "a8b1bb212b0c2aeb2f0e1d2c3b4a5968778899ab"));
  const shortHex = "a8b1bb212b0c2aeb"; // 16 chars total — one hex digit short
  check("agentId: a 16-char token survives", hashed(shortHex).includes(shortHex));
  const toolUse = "toolu_01Wep5xk6suYMYvaBG71xjyV";
  check("agentId: a tool_use id survives", hashed(toolUse).includes(toolUse));
  check("agentId: a tool_use id still discriminates", !sameKey(toolUse, "toolu_01Wep5xk6suYMYvaBG71xjyW"));
  check("agentId: an english word of 17 letters survives", hashed("abcdefabcdefabcdef").includes("abcdefabcdefabcdef"));

  // W0 lens 3 — the scrub is bound to the ENGINE's enclosing prose, not to the
  // shape alone. An id-shaped token a user (or a tool result, or a file the
  // engine read back) happens to carry is NOT run-scoped and must still
  // discriminate; before this it was blanked wherever it appeared, so two
  // different prompts could share a replay key.
  const bare = "a8b1bb212b0c2aeb2";
  check("agentId: a bare id outside engine prose survives", hashed(`the token ${bare} is data`).includes(bare));
  check("agentId: a bare id outside engine prose still discriminates", !sameKey(`the token ${bare} is data`, "the token a9c2bb770ba007053 is data"));
  check("agentId: a LOOKALIKE key name is not the engine's header", !sameKey(`myAgentId: ${bare}`, "myAgentId: a9c2bb770ba007053"));
  check("agentId: a non-task path segment is not the output path", !sameKey(`/cache/${bare}.output`, "/cache/a9c2bb770ba007053.output"));

  // The differ does NOT get this scrub: it maps run ids instead, which is
  // strictly stronger (an engine that used two ids where the oracle used one
  // still diffs). Pattern-scrubbing there would destroy that check.
  check("agentId: the differ path leaves the id for its id MAP", differed(A).includes("a8b1bb212b0c2aeb2"));
}

// ---------------------------------------------------------------------------
// uuids — session/task directory names inside output paths.
// ---------------------------------------------------------------------------
{
  const A = "/tmp/claude-501/-sandbox/aba136e4-aedd-49e1-b352-244531968d66/tasks/x.output";
  const B = "/tmp/claude-501/-sandbox/7a5d233d-7f3d-4764-a7ac-abbda2b8c0be/tasks/x.output";
  check("uuid: two runs canonicalize alike", sameKey(A, B));
  check("uuid: the path around it survives", hashed(A).includes("/tasks/x.output"));
  // NEGATIVE CONTROLS
  check("uuid: a version string is not uuid-shaped", hashed("2.1.251").includes("2.1.251"));
  const notUuid = "aba136e4-aedd-49e1-b352-244531968d6"; // one digit short
  check("uuid: a near-miss survives", hashed(notUuid).includes(notUuid));
  check("uuid: the differ path leaves it for the id MAP", differed(A).includes("aba136e4-aedd-49e1-b352-244531968d66"));
  // Same tightening as the agent id: only the session directory of a TASK path
  // is run-scoped. A uuid a user pasted, or one naming something else, is data.
  const bareUuid = "aba136e4-aedd-49e1-b352-244531968d66";
  check("uuid: a bare uuid outside a task path survives", hashed(`resume session ${bareUuid}`).includes(bareUuid));
  check("uuid: a bare uuid outside a task path still discriminates", !sameKey(`resume session ${bareUuid}`, "resume session 7a5d233d-7f3d-4764-a7ac-abbda2b8c0be"));
}

// ---------------------------------------------------------------------------
// inline clocks — two renderings, both measured in real request bodies.
// ---------------------------------------------------------------------------
{
  check("clock prose: duration_ms: N", sameKey("<usage>tool_uses: 0\nduration_ms: 2714</usage>", "<usage>tool_uses: 0\nduration_ms: 36</usage>"));
  check("clock xml: <duration_ms>N</duration_ms>", sameKey("<usage><duration_ms>1739</duration_ms></usage>", "<usage><duration_ms>21</duration_ms></usage>"));
  // NEGATIVE CONTROLS — a scrub named `*_ms` must never eat a CONFIGURED
  // timeout, which is a real contract the corpus grades.
  check("clock: a configured timeout survives", hashed('"timeout_ms":120000').includes("120000"));
  check("clock: a configured timeout still discriminates", !sameKey('"timeout_ms":120000', '"timeout_ms":5000'));
  check("clock: a bare number in prose survives", hashed("run it 2714 times").includes("2714"));
  check("clock: a non-_ms labelled count survives", hashed("tool_uses: 3").includes("tool_uses: 3"));
  check("clock: subagent_tokens is NOT scrubbed", hashed("<subagent_tokens>19806</subagent_tokens>").includes("19806"));
}

// ---------------------------------------------------------------------------
// proxy port / process suffixes / plan filenames — pre-existing scrubs, now
// shared with the hash. Retested here because sharing moved them.
// ---------------------------------------------------------------------------
{
  check("proxy port", sameKey("check your inference gateway (127.0.0.1:64277)", "check your inference gateway (127.0.0.1:51222)"));
  check("proxy port: a non-loopback host survives", hashed("10.0.0.1:64277").includes("10.0.0.1:64277"));
  check("cc_version process suffix", sameKey("cc_version=2.1.251.b71", "cc_version=2.1.251.12d"));
  check("cc_version: the VERSION still discriminates", !sameKey("cc_version=2.1.251.b71", "cc_version=2.1.250.b71"));
  check("cc-socks pid", sameKey("/tmp/cc-socks/68386.sock", "/tmp/cc-socks/70001.sock"));
  check("plan filename random suffix", sameKey("/plans/reply-with-exactly-still-here-whimsical-pie.md", "/plans/reply-with-exactly-still-here-dreamy-kettle.md"));
  check("plan filename: the prompt-derived prefix still discriminates",
    !sameKey("/plans/reply-with-exactly-still-here-whimsical-pie.md", "/plans/write-a-haiku-whimsical-pie.md"));
}

// ---------------------------------------------------------------------------
// host git state — HASH ONLY. The differ must still see it, because that is
// what keeps the env block graded rather than blinded.
// ---------------------------------------------------------------------------
{
  const mk = (status: string, log: string) =>
    `gitStatus: This is the git status at the start of the conversation.\n\nCurrent branch: main\n\nGit user: SSFSKIM\n\nStatus:\n${status}\n\nRecent commits:\n${log}`;
  const A = mk("M ../README.md", "04e31c65 north star");
  const B = mk("M ../src/env.ts\n?? ../src/canonical.ts", "2621aad3 W0a splice mechanics");
  check("git state: two working trees canonicalize alike (hash)", sameKey(A, B));
  check("git state: the branch line survives the hash", hashed(A).includes("Current branch: main"));
  check("git state: a different BRANCH still discriminates", !sameKey(A, mk("M ../README.md", "04e31c65 north star").replace("branch: main", "branch: wip")));
  // The differ keeps the whole block, so an engine that stopped emitting the
  // git status, or emitted a different one, still fails the request-surface diff.
  check("git state: the differ still sees the working tree", differed(A).includes("M ../README.md"));
  check("git state: the differ still sees the commit log", differed(A).includes("04e31c65 north star"));

  // W0 lens 3 — ANCHORED to the gitStatus envelope. Unanchored, the pattern ate
  // everything from a bare `Status:` heading to the end of ANY string, so a user
  // prompt or a tool result that merely quoted a status report lost its tail and
  // two different requests could share a replay key.
  const looseA = "Here is my report.\n\nStatus:\nshipped\n\nRecent commits:\nfixed the parser";
  const looseB = "Here is my report.\n\nStatus:\nblocked\n\nRecent commits:\nreverted the parser";
  check("git state: an unenveloped Status/Recent-commits report survives", hashed(looseA).includes("shipped"));
  check("git state: an unenveloped report still discriminates", !sameKey(looseA, looseB));
  check("git state: the envelope's OWN sentence is what triggers the scrub", sameKey(A, B) && !sameKey(A, looseA));
  // The lines BETWEEN the envelope sentence and `Status:` are preserved, so the
  // branch and the git user still discriminate (already checked for branch above).
  check("git state: the git user survives the hash", hashed(A).includes("Git user: SSFSKIM"));
}

// ---------------------------------------------------------------------------
// §3.4 structural backstop — a cassette whose entries canonicalize together is
// REFUSED at load. Every scrub above is a bet; this is what makes a lost bet
// loud instead of a silent misroute.
// ---------------------------------------------------------------------------
{
  const entry = (seq: number, text: string): CassetteEntry => ({
    seq,
    method: "POST",
    path: "/v1/messages?beta=true",
    requestBody: body(text),
    status: 200,
    contentType: "text/event-stream",
    responseBody: "event: message_stop\ndata: {}\n\n",
  });
  const collides = (a: string, b: string): boolean => {
    try {
      assertNoKeyCollisions([entry(0, a), entry(1, b)], "synthetic");
      return false;
    } catch {
      return true;
    }
  };

  // The real corpus must load. Anything else and the gate cannot run at all.
  const corpus = readdirSync(CASSETTES).filter((f) => f.endsWith(".jsonl") && !f.includes("-observed-"));
  const colliding = corpus.filter((f) => {
    const entries = readFileSync(join(CASSETTES, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CassetteEntry);
    try {
      assertNoKeyCollisions(entries, f);
      return false;
    } catch {
      return true;
    }
  });
  check(`collision: all ${corpus.length} recorded cassettes load collision-free`, corpus.length > 0 && colliding.length === 0, colliding.join(", "));

  // POSITIVE CONTROLS — bodies that differ ONLY in something a scrub erases.
  // Each of these would have been served the other's response, silently, with
  // fallbackServed() still reporting zero.
  check("collision: two agent ids in engine prose are caught",
    collides("agentId: a8b1bb212b0c2aeb2 (internal)", "agentId: a9c2bb770ba007053 (internal)"));
  check("collision: two session uuids in a task path are caught",
    collides("/sandbox/aba136e4-aedd-49e1-b352-244531968d66/tasks/x", "/sandbox/7a5d233d-7f3d-4764-a7ac-abbda2b8c0be/tasks/x"));
  check("collision: two host git states are caught",
    collides(
      "gitStatus: This is the git status at the start of the conversation.\n\nStatus:\nM a.ts\n\nRecent commits:\nabc one",
      "gitStatus: This is the git status at the start of the conversation.\n\nStatus:\n(clean)\n\nRecent commits:\ndef two",
    ));
  check("collision: two months in a tool description are caught", (() => {
    const withTool = (m: string): CassetteEntry => ({
      ...entry(0, "same prompt"),
      requestBody: JSON.stringify({ model: "m", tools: [{ name: "WebSearch", description: `The current month is ${m}. Use it.` }] }),
    });
    try {
      assertNoKeyCollisions([withTool("August 2026"), { ...withTool("September 2026"), seq: 1 }], "synthetic");
      return false;
    } catch {
      return true;
    }
  })());

  // NEGATIVE CONTROLS — the backstop must not fire on healthy cassettes.
  check("collision: two genuinely different prompts do not collide", !collides("Reply with exactly OK", "Reply with exactly NOT-OK"));
  check("collision: an id-shaped token OUTSIDE engine prose no longer collides (this is the tightening)",
    !collides("the token a8b1bb212b0c2aeb2 is data", "the token a9c2bb770ba007053 is data"));
  check("collision: a REPEATED identical request is allowed (retries, repeat entries)", !collides("Reply with exactly OK", "Reply with exactly OK"));
  // The key is method+path+canonical body, so two bodies that WOULD collide on
  // one endpoint are distinct requests when they were sent to different ones.
  check("collision: the key includes the path", (() => {
    const a = entry(0, "agentId: a8b1bb212b0c2aeb2 (internal)");
    const b = { ...entry(1, "agentId: a9c2bb770ba007053 (internal)"), path: "/v1/messages/count_tokens" };
    try {
      assertNoKeyCollisions([a, b], "synthetic");
      return true;
    } catch {
      return false;
    }
  })());
}

// ---------------------------------------------------------------------------
// the engine's wall-clock MONTH — field-scoped to the fields the engine authors.
// The rot this catches was live: the corpus recorded in August stopped matching
// on 1 September and every scenario fell back positionally.
// ---------------------------------------------------------------------------
{
  const webSearch = (month: string) =>
    `IMPORTANT - Use the correct year in search queries:\n  - The current month is ${month}. You MUST use this year when searching for recent information, documentation, or current events.`;
  const withTools = (month: string) =>
    JSON.stringify({ model: "claude-sonnet-5", tools: [{ name: "Bash", description: "run a command" }, { name: "WebSearch", description: webSearch(month) }] });
  check("month: a tool description rolls over without missing", canonicalizeForHash(withTools("August 2026")) === canonicalizeForHash(withTools("September 2026")));
  check("month: the sentence around it survives", canonicalizeForHash(withTools("August 2026")).includes("You MUST use this year"));
  check("month: a sibling tool description is untouched", canonicalizeForHash(withTools("August 2026")).includes("run a command"));
  // The bundle's OTHER phrasing, which shares only the sentence prefix.
  const dashForm = (month: string) => JSON.stringify({ system: [{ type: "text", text: `The current month is ${month} — use this when searching for recent information.` }] });
  check("month: the second bundle phrasing is covered (system prompt)", canonicalizeForHash(dashForm("August 2026")) === canonicalizeForHash(dashForm("September 2026")));
  check("month: that phrasing's tail survives", canonicalizeForHash(dashForm("August 2026")).includes("use this when searching"));

  // NEGATIVE CONTROLS — the scrub is field-scoped precisely so that month-shaped
  // text a USER wrote stays fully discriminating. Two prompts that differ only in
  // a month must NOT share a replay key.
  check("month: USER prose keeps its month", hashed("The current month is August 2026").includes("August 2026"));
  check("month: USER prose still discriminates", !sameKey("The current month is August 2026", "The current month is September 2026"));
  check("month: an assistant-authored month in a tool_result still discriminates",
    !sameKey("<usage>The current month is August 2026</usage>", "<usage>The current month is September 2026</usage>"));
  // Adjacent engine-authored prose that is NOT the wall clock must survive: the
  // knowledge cutoff sits three lines above the git block in the same system text.
  check("month: the knowledge-cutoff line is not month-shaped",
    canonicalizeForHash(JSON.stringify({ system: "Assistant knowledge cutoff is January 2026." })).includes("January 2026"));
  check("month: a different CUTOFF still discriminates",
    canonicalizeForHash(JSON.stringify({ system: "Assistant knowledge cutoff is January 2026." })) !==
      canonicalizeForHash(JSON.stringify({ system: "Assistant knowledge cutoff is March 2026." })));
}

// ---------------------------------------------------------------------------
// tool_result ordering — shared structural canonicalization. The racy
// completion order lands in request bodies, so the hash needs it too.
// ---------------------------------------------------------------------------
{
  const r = (id: string, content: string, cache = false) => ({ type: "tool_result", tool_use_id: id, content, ...(cache ? { cache_control: { type: "ephemeral" } } : {}) });
  const one = [r("toolu_b", "REFORGE_P2"), r("toolu_a", "REFORGE_P1")];
  const two = [r("toolu_a", "REFORGE_P1"), r("toolu_b", "REFORGE_P2")];
  check("tool_result order is canonicalized", JSON.stringify(canonicalizeToolResultOrder(one)) === JSON.stringify(canonicalizeToolResultOrder(two)));
  check("tool_result CONTENT still discriminates",
    JSON.stringify(canonicalizeToolResultOrder(one)) !== JSON.stringify(canonicalizeToolResultOrder([r("toolu_a", "REFORGE_P1"), r("toolu_b", "WRONG")])));
  // The cache breakpoint attaches positionally, so its COUNT is kept and its
  // position discarded — whether the engine sets one is cost-bearing behavior.
  const cachedLast = canonicalizeToolResultOrder([r("toolu_a", "x"), r("toolu_b", "y", true)]);
  const cachedFirst = canonicalizeToolResultOrder([r("toolu_b", "y"), r("toolu_a", "x", true)]);
  check("cache breakpoint position is discarded", JSON.stringify(cachedLast) === JSON.stringify(cachedFirst));
  check("cache breakpoint COUNT is kept", JSON.stringify(cachedLast).includes('"reforge-cache-breakpoints","count":1'));
  check("no breakpoint at all is distinguishable from one",
    JSON.stringify(cachedLast) !== JSON.stringify(canonicalizeToolResultOrder([r("toolu_a", "x"), r("toolu_b", "y")])));
  // A message whose blocks are NOT all tool_results must be left alone: the
  // order of model-authored content blocks IS a contract.
  const mixed = [{ type: "text", text: "second" }, { type: "text", text: "first" }];
  check("non-tool_result arrays keep their order", JSON.stringify(canonicalizeToolResultOrder(mixed)) === JSON.stringify(mixed));
}

// ---------------------------------------------------------------------------
// Whole-body invariants.
// ---------------------------------------------------------------------------
{
  check("the date stamp is scrubbed", sameKey("Today's date is 2026-08-31", "Today's date is 2026-09-01"));
  check("metadata is scrubbed", canonicalizeForHash(JSON.stringify({ metadata: { user_id: "u1" } })) === canonicalizeForHash(JSON.stringify({ metadata: { user_id: "u2" } })));
  check("a non-JSON body does not throw", typeof canonicalizeForHash("not json at all") === "string");
  check("canonicalization is idempotent", canonicalizeForHash(hashed("agentId: a8b1bb212b0c2aeb2")) === hashed("agentId: a8b1bb212b0c2aeb2"));
  // The whole point: different PROMPTS must never collide.
  check("different prompts never collide", !sameKey("Reply with exactly OK", "Reply with exactly NOT-OK"));
  check("different models never collide",
    canonicalizeForHash(JSON.stringify({ model: "claude-sonnet-5" })) !== canonicalizeForHash(JSON.stringify({ model: "claude-opus-5" })));
  // Prompt-cache TTL is cost-bearing behavior and is NOT scrubbed — the
  // contaminated cassettes were re-recorded rather than normalized away.
  check("cache_control ttl is not scrubbed",
    canonicalizeForHash(JSON.stringify({ cache_control: { type: "ephemeral", ttl: "1h" } })) !==
      canonicalizeForHash(JSON.stringify({ cache_control: { type: "ephemeral" } })));
}

// ---------------------------------------------------------------------------
// §3.4 replay strictness — the warn-vs-fatal split, and that it is not vacuous.
// ---------------------------------------------------------------------------
{
  check("strict for a strangled engine", strictReplay("engine-strangled"));
  check("strict for engine-ts", strictReplay("engine-ts"));
  check("NOT strict for the identical-code self-test pair", !strictReplay("engine-extracted"));
  // A zero count is never a failure — otherwise every clean run would be red.
  check("zero fallbacks pass under both regimes", fallbackVerdict("engine-strangled", "A", 0) && fallbackVerdict("engine-extracted", "A", 0));
  check("a fallback FAILS a strangled run", !fallbackVerdict("engine-strangled", "A", 1));
  check("a fallback only WARNS on the self-test pair", fallbackVerdict("engine-extracted", "A", 1));
}

console.log(`=== canonicalization: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — every scrub catches its value and spares its value-shaped neighbour" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
