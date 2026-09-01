# W2 (C5) scout — `chunk-y30v0ja7` export/consumer inventory + description anchors

Pin `2.1.251`. Read-only scouting; nothing built, recorded, or gated.
Parent: `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md` §2.2 (S-chunk precondition),
§3.1 (coverage attestation), Roadmap C5. Corrects two premises the brief carried in (see §4).

## 1. `chunk-y30v0ja7.js` — the S-chunk pilot (1410 bytes, 3 exports, 3 imports)

Whole source is 1 code line; everything below is read from it directly.

### 1.1 Exports

| export | kind | value / behavior |
|---|---|---|
| `ti` | `var`, string constant | `"Glob"` — the tool-name literal. |
| `$s` | `var`, string constant | `"REPL"` — tool-name literal for the REPL tool. Unrelated to Glob; the grab-bag half. |
| `O_n` | function `(e) => string` | the Glob tool description. |

`O_n(e)` in full: if `td(e)` → the one-paragraph lean description
(`'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.'`);
otherwise `Jk()==="default" ? o : t`, where module-level `t` is the 4-bullet list and
`o = t + "\n- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the ${yt} tool instead (if available)"`.
`t`/`o` are module-private (not exported); `o` interpolates `yt` at module-evaluation time.

### 1.2 Imports (3 chunks) and their capture class per §2.4

| import | from | what it supplies | class |
|---|---|---|---|
| `yt` | `chunk-k8vt31j7.js` (885 B, zero imports, pure constants) | `"Agent"` | `primitive` — own outright, equality-assert |
| `td` | `chunk-p33zayst.js` | `td(e) = Y.of(G().host).leanPrompt(e)`, memoized `si(B)`; `B(e)` returns `false` for falsy `e`, consults `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT`, the `tengu_velvet_tide` gate, clientData `simple_system_prompt`, and a model-family test `w(e)` | `effectful-port` — env + gate + host-keyed memo |
| `Jk` | `chunk-bsdtxcdc.js` | subagent-steer resolver returning `"default" \| "no_nudges" \| "counter_steer"`; **latches** on first call and emits `tengu_subagent_steer_applied` telemetry when non-default; sources are `CLAUDE_CODE_THISTLE_GREBE`, clientData, GrowthBook, model floor | `effectful-port` — mutates a latch, emits telemetry |

### 1.3 Top-level side effects

None beyond `var` initialization. `t` and `o` are template strings evaluated at module load; `o`
reads `yt` (a frozen string) at that moment. No mutation, no registration, no I/O, no `import.meta.require`.
The chunk is order-insensitive.

### 1.4 Live bindings

None required. All three exports are assigned once and never reassigned inside the chunk; ESM makes
them read-only at every consumer. A replacement may export plain `const`s.

### 1.5 Consumers

Two populations. **291 chunks** carry a bare side-effect import
(`import"/$bunfs/root/chunk-y30v0ja7.js"`) — Bun's transitive chunk-preload edges, binding nothing.
Because §1.3 shows no top-level effects, these are inert: the replacement only has to exist at the
same path and evaluate without throwing. **14 chunks** import bindings:

| consumer | imports | what it does with them |
|---|---|---|
| `fy12d89p` (engine) | `ti`, `O_n`, `$s` | the Glob tool object `B0=kt({name:ti, …, async description(){return O_n(void 0)}, …})`; `ti` also in tool-name sets, permission-rule matching (`ruleValue.toolName===ti`), hook matchers, prompt prose (`Use ${ti} for broad file pattern matching`), the tool-use counter switch, and the REPL bridge; `$s` filters REPL tool_use blocks out of transcripts and gates REPL-aware paths |
| `hdmehzg7` (Grep) | `ti`, `$s` | membership set `OVe=new Set([_t,ti,Xo,Qe,Bt,mc])`; `$s` in `CI()` |
| `w7bq1qyb` (sandbox/exec) | `ti` | builds `--allowed-tools` rule strings `` `${N}(${path}/**)` `` over `[_t,ti,Xo]`; `qo=new Set([_t,ti,Xo,BB])` |
| `9e2ns8ty` | `ti`, `$s` | permission check `if(e.name===ti){…pattern…}`; `$s` in an allowed-tools predicate |
| `2z83fvw5`, `81xmkgbw` (TUI) | `ti`, `$s` | built-in tool-name set builder; renderer registry keyed by tool name |
| `hw8qz4q5`, `215sh4gf`, `c6d1y7xy`, `myzsc7hx` | `ti` | tool-name sets / prompt prose |
| `6thm48px`, `dvbbv89q`, `g461tywa`, `xdx612ep` | `$s` | REPL content-block matching, `tool_progress` emission, disallowedTools assembly |

`O_n` has exactly **one** consumer (`fy12d89p`), called as `O_n(void 0)` — so `td(undefined)` is
always `false` at that call site and the lean branch of `O_n` is **dead on this call path**.
`ti` and `$s` are pure name constants consumed by 13 chunks with no behavioral coupling.

### 1.6 Verdict — clean enough to own whole, with one named port

The inventory does **not** argue for S-method fallback. The seam is as clean as §2.2 hoped:
3 exports, no side effects, no live bindings, no re-exports, two frozen-string exports, one function
with a single consumer. The entanglement is entirely in the **imports**, and it is bounded: `yt` is
`primitive`; `td` and `Jk` are `effectful-port`, each reaching subsystems later waves own (prompt
policy; subagent steer/GrowthBook). Under X4 hygiene the owned module takes both as typed delegation
arguments and the replacement chunk file is the adapter that supplies them. Two declared ledger
edges is the honest price.

Mechanics C5 must budget for:

- Keep `// @bun @bytecode` as line 1 (`build.ts:injectAfterBanner` exists because that banner is
  load-bearing) and use **materialized absolute specifiers** for the three imports — `prepare.ts`
  rewrites `/$bunfs/root/` in the staged graph.
- Export-name derivation (§2.2) is shape-based here: `ti` ← `var (ID)="Glob"`, `$s` ←
  `var (ID)="REPL"`, `O_n` ← the function whose body holds the lean literal. Cross-check the literal
  `export{…}` list; a mismatch or missing shape must throw.
- `Jk()`'s latch is first-call-wins. Call the port exactly where `O_n` did — inside the description
  call, after the `td` branch — never at module load, or the latched value can differ.

Alternative pilot, one line: `chunk-k8vt31j7.js` (885 B) has **zero imports**, 8 pure constants,
20 named consumers — a simpler debut if C5 wants to separate "does whole-chunk replacement work"
from "does port-crossing work". `y30v0ja7` stays the better single target: it exercises both.

## 2. Description-function anchors (the four S-method targets)

All four are `free-function` shape. Every anchor below was counted with `grep -o -F` across **all**
`~/claude-code-bundle/2.1.251/modules/*.js` — the same whole-graph uniqueness rule `build.ts:102`
enforces — and each returned exactly 1.

| tool | chunk | fn | anchor (unique, count 1) | branch it sits in |
|---|---|---|---|---|
| Read | `hx5r9amq` | `cYn(e,t,s,r)` | `Assume this tool is able to read all files on the machine.` | full (`td` false) |
| Glob | `y30v0ja7` | `O_n(e)` | `Fast file pattern matching. Supports glob patterns like` | lean (`td` true) |
| Grep | `hdmehzg7` | `gmn(e)` | `Content search built on ripgrep. Prefer this over` | lean (`td` true) |
| WebFetch | `qe0j59w7` | `eYn(e,t=!1)` | `Fetches a URL, converts the page to markdown, and answers` | lean (`td` true) |

Alternates, also count 1 if a different branch is preferred: `You can access any file directly by
using this tool.` (Read), `A powerful search tool built on ripgrep` (Grep), `IMPORTANT: WebFetch
WILL FAIL for authenticated or private URLs.` (WebFetch). Glob's full-branch text lives in the
module-level `var t`, **outside** `O_n`, so the lean literal is the only in-body anchor for Glob.

**The census's `td(e) ? brief : full` shape is confirmed for all four.** Captures per §2.4:

- **Read `cYn`** — params `t`,`s`,`r` are call-site strings (from `fy12d89p`'s `prompt({model:e})`,
  which computes them from `Tz()`/`XDe()`); in-body captures are `td` (`effectful-port`),
  `jVe`=2000 (`primitive`), `n` (the "Do NOT re-read" suffix, `primitive`), and `BVe()`
  (`pure-helper` in form but reads `at()` — the session model string — so it is `effectful-port`).
- **Glob `O_n`** — `td` (`effectful-port`), `Jk` (`effectful-port`), `t`/`o` (`primitive`, and `o`
  captures `yt`=`"Agent"`, `primitive`).
- **Grep `gmn`** — `td`, `Jk` (`effectful-port`); `Xo`=`"Grep"`, `Qe`=`"Bash"`, `yt`=`"Agent"`
  (`primitive`).
- **WebFetch `eYn`** — `td` (`effectful-port`); `u()` (`pure-helper`, the usage-notes block);
  `r()` → `Lmn()` (`effectful-port`: reads `CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS`, defaults 900000,
  memoized per host) and `k` (pluralizer, `pure-helper`); `Mmn` unused by `eYn`.

## 3. How descriptions become observable — and how they are graded

Descriptions reach the differential surface as `requestBody.tools[i].description`. The **`prompt()`**
method of each tool object is what fills that field, not `description()` (Read's `description()`
returns the one-liner `"Read a file from the local filesystem."`, which never appears in a request).

Grading path, verified in `src/proxy.ts` + `m1/run.ts`: each engine's outgoing requests are appended
to an `observed-A/B` file, normalized (`scrubRequestBody` touches only `Today's date is …` and
`metadata`, so descriptions pass through verbatim), and diffed structurally (`m1/run.ts:270-276`,
surface `requests`). A changed description reddens two ways at once — a `requests` diff, and a
cassette body-hash miss falling through to the positional fallback (`proxy.ts:155-158`), which C3
makes fatal for every non-extracted `engineB`. Caveat: `substanceOnly` scenarios (today
`background-task`) skip all three diff surfaces, so they grade nothing about descriptions.

**Correction to the brief's premise — the catalog is NOT identical across scenarios.** Measured from
the cassettes:

| tool description | scenarios whose request carries it |
|---|---|
| Read (full), WebFetch (full) | 26 scenarios — effectively the whole corpus |
| Read (lean), WebFetch (lean) | `m1-api-error` only |
| Glob (full), Grep (full) | **`m1-search-tools` only** |
| Glob (lean), Grep (lean) | **no scenario** |

`m1-plain`'s request carries 22 tools and no `Glob`/`Grep`; `m1-search-tools` carries 24 because its
scenario sets `allowedTools:["Write","Glob","Grep"]`. §1.3's "31 native tools" is the union over the
corpus, not a per-request constant. So sabotage of the Glob or Grep description reddens exactly one
scenario, and `coverage: ["search-tools"]` is the only correct manifest value for both.

The lean/full split is model-driven and partly accidental: `td` is false for `claude-sonnet-5`
(`w(e)` matches `"sonnet"`), and `m1-api-error` gets the lean branch only because its model id is the
deliberately invalid `claude-reforge-does-not-exist`, which falls through `w()`'s family list.

**Consequences for the coverage-attestation debut (§3.1).** The branch inventory will show both `td`
arms of Read and WebFetch executed by the existing corpus, but only the `td`-false arm for Glob and
Grep — and Glob's lean arm is unreachable anywhere (§1.5: the single call site passes `void 0`). C5
either adds a lean-branch search-tools variant (model id outside `w()`'s families) or records Glob's
lean arm as a reviewed exclusion citing `O_n(void 0)`. The `Jk()!=="default"` arms of Glob and Grep
are unexecuted under the pinned disabled-gate environment (§3.3) — exclusion candidates on the same
footing.

## 4. `hx5r9amq` early findings, and the `q6t` coordination point

`hx5r9amq` (4815 B, 15 exports) has **exactly one named consumer: `fy12d89p`, which imports all 15**;
280 further chunks carry only the inert bare import. Its own imports are just `at` (`bsdtxcdc`) and
`td` (`p33zayst`). By the §1 criteria this is a *cleaner* whole-chunk seam than the pilot — single
consumer, no live bindings, no top-level effects — despite 5× the exports. Contents: PDF page-range
parsing, a PDF-capability predicate, an extension test, the Read description `cYn` plus its four
constant fragments, three "already read" reminder strings and their prefix test, the truncation
marker, the 2000-line default `jVe`, and `q6t`.

**`q6t` = `" (file state is current in your context — no need to Read it back)"`** (a `primitive`).
Nobody imports it except `fy12d89p`, where it is used **twice**: in the Write result formatter
(`case "create"`, the body `strangle` already splices as `write-tool-result`) and again in the Edit
result formatter — a formatter C4 is about to own.

The coordination point, stated explicitly:

> `q6t`'s value is asserted in **three** places once both waves land: C4's retrofitted
> `write-tool-result` adapter, C4's new Edit-formatter adapter, and — if a later wave takes
> `hx5r9amq` as an S-chunk — the reforge-owned chunk's `q6t` export. All three must carry the same
> literal. The manifest's `derive` regex recovers the *identifier* from `fy12d89p`'s excised body, and
> replacing `hx5r9amq` does not change that identifier, so derivation keeps working; what can silently
> diverge is the **value**. Single source of truth: one owned constant in
> `strangle/modules/` that the chunk replacement re-exports and both adapters assert against —
> never two independently transcribed string literals.

Same shape, smaller stakes, applies to `jVe` (2000) and `Nmn`/`sYn`/`aYn`/`lYn`, which C4's Read
formatter and a later Read-description splice both touch.

---

## 5. Correction, added by C5 at implementation time (2026-09-01)

**§1.5's "`O_n` has exactly one consumer, called as `O_n(void 0)`" is wrong, and §3's consequence
for the attestation followed it off the cliff.**

`fy12d89p` calls `O_n` **twice**, from two methods of the same Glob tool object:

```js
async description(){return O_n(void 0)}
async prompt({model:e}){return O_n(e)}
```

The second is the one §3 itself identifies as filling `requestBody.tools[i].description`. So `td(e)`
is *not* always `false` at the call site, the lean branch is **not** dead on its only call path, and
`gmn` (Grep) has exactly the same pair. What is true is narrower and much less interesting: no corpus
scenario reached the lean arm, because the only scenario whose `allowedTools` admit Glob and Grep
(`search-tools`) runs a sonnet model, and `w()` matches `"sonnet"`.

That distinction decided the wave. Had the "dead on its only call path" reading stood, C5 would have
recorded a **reviewed exclusion** for a live branch. Instead it recorded a 25th scenario —
`search-tools-lean`, the search-tools tool set on the api-error model — and both lean arms are now
differentially covered and solo-sabotage red. The reviewed exclusions that remain
(`attestation/w2-descriptions.md`) are all environment-pinned rather than call-path arguments.

The generalizable lesson, since the scout method is reused every wave: **a "dead code" finding about
a function with more than one caller has to be re-derived from the call sites**, and a `grep -o` for
`return <fn>(` on a minified one-line chunk returns the first match per line, so it under-counts by
construction. The rest of §1's inventory (3 exports, zero top-level side effects, zero live bindings,
the three imports and their classes) was verified independently by `strangle/chunk.ts` at build time
and is correct.
