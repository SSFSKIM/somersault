# Canon grounding addendum — `popsOutOnError` consumption + the `odS` git scraper

Companion to `2026-08-18-tool-stream-ground.md`. Same source and same discipline: everything is
`~/claude-code-bundle/2.1.234/cli.pretty.js`, all citations are `cli.pretty.js:LINE`, minified
identifiers are kept in the prose so every claim is re-findable, and each section separates
**OBSERVED** (quoted from the reprint) from **INFERRED** (my reading of it).

This addendum exists to close the two re-reads that spec §3.1 mandated before implementation:
(a) how canon *consumes* `popsOutOnError`, and (b) the full recognition + bookkeeping rules of the
git-op scraper `odS`. It also records one place where the spec's wording, taken literally, would
produce a defect — see §C.

---

## A. `popsOutOnError` — how canon consumes it

### A.1 Can a silently-absorbed call open a run and become its anchor? — **YES**

**OBSERVED.** `Krr` marks the silent set at **236807–236809**:

> ```js
> let o = Joi.includes(e);
> if (Ns() && e === iE || o)
>   return { isCollapsible: !0, isSearch: !1, isRead: !1, isList: !1, isREPL: !1,
>            isMemoryWrite: !1, isScratchpadWrite: !1, isWorkshopWrite: !1,
>            isAbsorbedSilently: !0, popsOutOnError: o };
> ```

`Joi = [nq, xz, ODe, oq, DW]` (**236734**) = TodoWrite / TaskCreate / TaskGet / TaskUpdate /
TaskList; `iE = "ToolSearch"` is fullscreen-only and gets `popsOutOnError: false` (because
`o` is false for it).

In the accumulation loop `iNp`, the silent branch is **237140–237146**:

> ```js
> } else if (u.isAbsorbedSilently) {
>   if (u.popsOutOnError) {
>     let f = { count: 0, added: 0, removed: 0, spent: !1 };
>     o.workshopEditsByToolUseId ??= new Map;
>     for (let m of u.toolUseIds)
>       o.workshopEditsByToolUseId.set(m, f);
>   }
> }
> ```

That branch does **not** `continue` or `return`. Control falls through to the shared tail of the
`if (u)` block at **237195–237197**:

> ```js
> for (let f of u.toolUseIds)
>   o.toolUseIds.add(f);
> o.messages.push(c);
> ```

And `idS` derives the cluster identity from `messages[0]` (**237027**):

> `let t = e.messages[0], ... displayMessage: t, uuid: \`collapsed-${t.uuid}\`, timestamp: t.timestamp`

**Conclusion (OBSERVED).** A silently-absorbed call — TodoWrite, any `Task*`, or ToolSearch in
fullscreen — is pushed into `o.messages` unconditionally, registers its `tool_use_id` in
`o.toolUseIds`, and therefore **can be `messages[0]`**, i.e. the cluster's `displayMessage`,
`uuid` (`collapsed-<uuid>`) and `timestamp`. It contributes **no counter** of any kind.

**Consequence (OBSERVED, 518513).** A run made *only* of silent calls renders nothing when
collapsed:

> `if (!v && !w && !de) return null;`

where `de` (**518467**) is the "is there anything to say" disjunction over every counter and
`v` / `w` are the memory / team-memory predicates. None of them can be true for a silent-only
run. **INFERRED:** such a cluster is still a live row in the virtual list and is still reported
clickable (`Pr` returns `!0` for `collapsed_read_search` unconditionally, **549764**) — a
zero-height clickable item. Expanding it *does* show content, because the verbose branch at
**518492** returns before the `!de` null check and renders every absorbed `tool_use` through
`Eth` (**518504–518510**). This is the canon evidence for spec §3.1's "silently-absorbed calls
ARE members".

### A.2 What `popsOutOnError` actually registers

**OBSERVED.** It does not set a dedicated flag. It plants a **zero-valued entry in the
workshop-edit ledger** (`workshopEditsByToolUseId`), the same map real workshop writes use
(**237127–237130**):

> ```js
> let f = { count: p, added: u.editLines?.added ?? 0, removed: u.editLines?.removed ?? 0, spent: !1 };
> o.workshopEditsByToolUseId ??= new Map;
> for (let g of u.toolUseIds)
>   o.workshopEditsByToolUseId.set(g, f);
> ```

versus the silent variant's `{ count: 0, added: 0, removed: 0, spent: !1 }` (**237142**).

That ledger is read by exactly one function, `sdS(message, acc)` (**237059–237072**):

> ```js
> function sdS(e, t) {
>   if (e.type !== "user" || !t.workshopEditsByToolUseId) return !1;
>   let r = !1;
>   for (let n of e.message.content) {
>     if (n.type !== "tool_result" || !n.is_error) continue;
>     let o = t.workshopEditsByToolUseId.get(n.tool_use_id);
>     if (!o || o.spent) continue;
>     o.spent = !0,
>     t.workshopWriteCount   = Math.max(0, (t.workshopWriteCount ?? 0) - o.count),
>     t.workshopLinesAdded   = Math.max(0, (t.workshopLinesAdded ?? 0) - o.added),
>     t.workshopLinesRemoved = Math.max(0, (t.workshopLinesRemoved ?? 0) - o.removed),
>     r = !0;
>   }
>   return r;
> }
> ```

**INFERRED.** The zero counts are the whole trick: `sdS` runs its un-count arithmetic and
subtracts nothing, but returns `true`, which is the only thing the caller cares about. So
`popsOutOnError` is implemented as "join the workshop-error path with a no-op un-count".
`spent` makes the trigger fire at most once per `tool_use_id`.

### A.3 Pop-out semantics — split, relocate, or render-standalone-after?

**OBSERVED.** The consumption site is the *second* branch of the loop, **237198–237210**:

> ```js
> } else if (QHp(c, o.toolUseIds) && sdS(c, o)) {
>   let p = o.messages.at(-1),
>       f = p ? Pka(p) : [],
>       m = new Set(c.type === "user"
>             ? c.message.content.flatMap((g) => g.type === "tool_result" && g.is_error ? [g.tool_use_id] : [])
>             : []);
>   if (!(o.hookCount > 0 || (o.relevantMemories?.length ?? 0) > 0) && f.length > 0 && f.every((g) => m.has(g))) {
>     o.messages.pop();
>     for (let g of f)
>       o.toolUseIds.delete(g);
>     if (o.messages.length > 0)
>       l(), n.push(p);
>     else
>       n.push(p), a(), o = Rka();
>   } else
>     l();
>   n.push(c);
> }
> ```

Supporting predicates: `QHp(msg, ids)` (**236922**) requires the user message to carry ≥1
`tool_result` and **all** of them to belong to the accumulator; `Pka(msg)` (**236929**) returns
`[content[0].id]` for an assistant message, the full id list for a `grouped_tool_use`, and
**`[]` for a `user` message**; `l()` (**237107**) is the flush.

**The three outcomes (OBSERVED, read off the branch):**

| situation | what happens |
|---|---|
| the errored call is the run's **last** message, **all** its tool_uses errored, and the run absorbed no PreToolUse hooks and no relevant-memories | the call is **removed** from the run (`o.messages.pop()`, ids deleted), then the run is **flushed** (`l()`), then the call is emitted **standalone after the cluster**, then the error `tool_result` is emitted after it. **Split + relocate.** |
| same as above but the run had nothing else left (`o.messages.length === 0` after the pop) | no cluster is emitted at all — `n.push(p), a(), o = Rka()`. The call renders standalone as if it had never been collapsible; the buffered thinking/attachments are drained; the accumulator resets. |
| the errored call is **not** the last message (e.g. the last message is an absorbed `tool_result`, for which `Pka` returns `[]`), or only some of its tool_uses errored, or the run absorbed hooks / relevant-memories | `else l()` — the call **stays inside the cluster**, the run is simply **closed**, and the error `tool_result` is emitted standalone after it. **Split only, no relocation.** |

**OBSERVED, and load-bearing:** in every one of the three branches, `n.push(c)` runs and `l()`
or `o = Rka()` has already fired. **An error result for a `popsOutOnError` tool always ends the
run.** It is never absorbed the way an ordinary result is.

**Contrast — errors for every other collapsible tool (OBSERVED, 237211–237213):**

> ```js
> } else if (QHp(c, o.toolUseIds)) {
>   if (o.messages.push(c), adS(c, o.erroredToolUseIds), Ns() && o.bashCommands?.size)
>     odS(c, o);
> }
> ```

`adS` (**237073–237079**) just records errored ids in `o.erroredToolUseIds`. A failed Read,
Grep, Bash or MCP call therefore stays absorbed and does **not** break the run; the recorded ids
only drive the error tint on the cluster spinner (`S = b.some(... erroredToolUseIDs.has ...)`,
**518465**) and filter `memoryOps` at **237050**.

### A.4 Anchor stability — canon vs. the spec's invariant

**INFERRED.** Canon never *shifts* the anchor of a surviving run: the pop can only remove
`messages.at(-1)`, and `messages[0]` can only be `messages.at(-1)` when the run has exactly one
message — in which case no cluster is emitted at all. So within one evaluation of `iNp`, the
anchor is stable by construction.

**But canon can un-form a run retroactively**, and it gets away with it because `iNp` is a pure
re-derivation: it starts from `o = Rka()` on every call (**237093**) and rebuilds the whole list
from the whole message array. A single silent call that later errors simply never becomes a
cluster on the *next* render. An incremental/streaming implementation (ours) cannot retract a row
it already published mid-turn — which is exactly why spec §3.1 pins the anchor-stability
invariant as ours regardless. **This is a divergence to implement deliberately, not a canon
contradiction.** The concrete case to handle: a run opened by a silent call that is still the
run's only member when its error result arrives.

**INFERRED corollary the implementer should not miss:** because `iNp` is a full re-derivation,
all of the accumulator's append-only bookkeeping (§B.6) is idempotent across re-renders. Any
implementation that mutates a long-lived accumulator instead must supply that idempotence itself.

---

## B. `odS` — the git-operation scraper

### B.1 Call site and guard

**OBSERVED, 237212.** `odS(c, o)` runs **inside** the accumulation loop, on each absorbed
`tool_result`, gated on fullscreen and on the run having recorded at least one bash command:

> `if (o.messages.push(c), adS(c, o.erroredToolUseIds), Ns() && o.bashCommands?.size) odS(c, o);`

Confirms spec §3.1's "scraped as each bash result is absorbed", not at cluster close.

`bashCommands` is populated only in the `isBash` branch (**237152–237160**):

> ```js
> } else if (Ns() && u.isBash) {
>   o.bashCount = (o.bashCount ?? 0) + p;
>   let { command: f } = u.input;
>   if (f) {
>     let m = gQo(f);
>     o.latestDisplayHint = m !== void 0 ? Ika(m) : Aka(f);
>     for (let h of u.toolUseIds)
>       o.bashCommands?.set(h, f);
>   }
> }
> ```

Initialised, together with the four result arrays and `gitOpBashCount`, by `Rka()` (**237023**),
fullscreen-only:

> `e.bashCount = 0, e.bashCommands = new Map, e.commits = [], e.pushes = [], e.branches = [], e.prs = [], e.gitOpBashCount = 0;`

**Do git commands actually reach that branch? — YES (OBSERVED).** `isBash` is
`Ns() ? !l && c : void 0` where `l = isSearch||isRead||isList` and `c = ipe.includes(name)`
(**236816**). Bash's `isSearchOrReadCommand` delegates to `xmv(command)` (**379263–379267**),
which classifies on the **first word of each pipeline segment** against four fixed sets
(**379214**):

> `Emv = new Set(["find","grep","rg","ag","ack","locate","which","whereis"])`,
> `Cmv = new Set(["cat","head","tail","less","more","wc","stat","file","strings","jq","awk","cut","sort","uniq","tr"])`,
> `kmv = new Set(["ls","tree","du"])`, `Amv = new Set(["echo","printf","true","false",":"])`

`git` and `gh` are in none of them, so `xmv` returns `{isSearch:!1,isRead:!1,isList:!1}`
(**378945–378946**) → `l` false → `isBash` true. **Every `git`/`gh` invocation lands in the
`isBash` branch and is recorded in `bashCommands`.**

### B.2 `odS` body — verbatim (236993–237019)

> ```js
> function odS(e, t) {
>   if (e.type !== "user") return;
>   let r = e.toolUseResult;
>   if (!r?.stdout && !r?.stderr) return;
>   let n = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
>   for (let o of e.message.content) {
>     if (o.type !== "tool_result") continue;
>     let i = t.bashCommands?.get(o.tool_use_id);
>     if (!i) continue;
>     let { commit: s, push: a, branch: l, pr: c } = vFr(i, n);
>     if (s) t.commits?.push(s);
>     if (a) t.pushes?.push(a);
>     if (l) t.branches?.push(l);
>     if (c) t.prs?.push(c);
>     if (s || a || l || c)
>       t.gitOpBashCount = (t.gitOpBashCount ?? 0) + 1;
>   }
> }
> ```

**OBSERVED.** The scraped text is `stdout + "\n" + stderr` off `message.toolUseResult` — a single
per-message object, not per-block. Only `tool_use_id`s present in `bashCommands` are considered.
**INFERRED:** if one user message ever carried two bash `tool_result` blocks, both would be
matched against the *same* combined output and `gitOpBashCount` would be bumped twice. Canon's
normalised stream keeps one tool_result per user message (`Pka`/`idS` both assume `content[0]`),
so this is latent rather than live.

### B.3 `vFr(command, output)` — the recognition table

`vFr` is at **194436–194473**. Patterns are built by `SFr` (**194291–194293**):

> `function SFr(e, t = "") { return new RegExp(\`\\\\bgit(?:\\\\s+-[cC]\\\\s+\\\\S+|\\\\s+--\\\\S+=\\\\S+)*\\\\s+${e}\\\\b${t}\`); }`

i.e. `git`, optionally followed by `-c k=v` / `-C dir` / `--opt=val` prefixes, then the subcommand.
The constants (**194645–194650**):

> `Upp = SFr("commit"), TLn = SFr("push"), xya = /(?:^|\s)(?:-n|--dry-run)(?=\s|$)/, J5b = SFr("cherry-pick"), X5b = SFr("merge", "(?!-)"), Z5b = SFr("rebase")`
> `Iya = [{re:/\bgh\s+pr\s+create\b/,action:"created"}, {re:/\bgh\s+pr\s+edit\b/,action:"edited"}, {re:/\bgh\s+pr\s+merge\b/,action:"merged"}, {re:/\bgh\s+pr\s+comment\b/,action:"commented"}, {re:/\bgh\s+pr\s+close\b/,action:"closed"}, {re:/\bgh\s+pr\s+reopen\b/,action:"reopened"}, {re:/\bgh\s+pr\s+ready\b/,action:"ready"}]`
> `eQo = /"(?:[^"\\]|\\.)*"|'[^']*'/g` (the quote-stripper)
> `tQo = /https?:\/\/[^/\s"]+\/([^\s"]+?)\/(?:pull|pull-requests|-\/merge_requests)\/(\d+)/`
> `l6b = /^\[(?:([\w./-]+)|detached HEAD)(?: \(root-commit\))? ([0-9a-f]{4,})\]/m`
> `Gpp = /^\s*[+\-*!= ]?\s*(?:\[new branch\]|[0-9a-f]+\.\.+[0-9a-f]+)\s+\S+\s*->\s*(\S+)/m`

| entry | command predicate | result predicate | extraction | emitted shape |
|---|---|---|---|---|
| `commit` | `Upp.test(cmd)` (`git … commit`) **or** `J5b.test(cmd)` (`git … cherry-pick`) — **194438** | `qpp(output)` must match `l6b` on the ANSI-normalised text — **194439** | `sha = l6b[2]`, `branch = l6b[1]` | `{ sha, kind, branch? }`, `kind = cherry-pick ? "cherry-picked" : /--amend\b/.test(cmd) ? "amended" : "committed"` — **194441** |
| `push` | `TLn.test(cmd)` **and** `!xya.test(Dya(cmd))` — the `git push` argument segment must not contain `-n` / `--dry-run` — **194443–194445** | `output.match(Gpp)?.[1]` must exist — **194446** | remote-side ref name (`… -> <ref>`) | `{ branch }` — **194448** |
| `merge` | `X5b.test(cmd)` (`git … merge` not followed by `-`) — **194451** | `/(Fast-forward\|Merge made by)/.test(output)` — **194451** | `$pp(cmd, "merge")` → first non-flag token after the subcommand | `{ ref, action: "merged" }` — **194454** |
| `rebase` | `Z5b.test(cmd)` — **194456** | `/Successfully rebased/.test(output)` — **194456** | `$pp(cmd, "rebase")` | `{ ref, action: "rebased" }` — **194459** |
| `pr` | `Pya(cmd)` returns an action — **194461** | `Oya(output)` (last `tQo` URL match) **or** fallback `Vpp(output)` — **194463–194469** | number + url (+repository, discarded here) | `{ number, url?, action }` — **194465** / **194469** |

Only **one** commit, push, branch and pr entry can come out of a single `vFr` call — `r` is a
flat object, so a later `if` overwrites an earlier one (this is why `merge` and `rebase` share the
`branch` slot; a command matching both would keep the rebase result, **194456–194459**).

Helpers, verbatim:

- `Dya(e)` (**194416–194418**) — the `git push` argument segment:
  > `return (e.split(TLn)[1] ?? "").split(/[&|;\n]/)[0] ?? "";`
- `zpp(e)` (**194391–194395**) — ANSI/CR normalisation before commit matching:
  > `return e.replace(/\x1b\[[0-9;]*K/g, "").replace(/\x1b\[[0-9]*G/g, "\n").replace(/\r/g, "\n");`
- `qpp(e)` (**194396–194401**):
  > `let t = zpp(e).match(l6b); if (t?.[2] === void 0) return; return { sha: t[2], ...t[1] !== void 0 && { branch: t[1] } };`
- `$pp(e, t)` (**194423–194435**) — first bare (non-flag, non-redirection) token after the subcommand:
  > ```js
  > let r = e.split(SFr(t))[1];
  > if (!r) return;
  > for (let n of r.trim().split(/\s+/)) {
  >   if (/^(?:[\d*]*[<>]|[&|;])/.test(n)) break;
  >   if (n.startsWith("-")) continue;
  >   return n;
  > }
  > ```
- `Pya(e)` (**194294–194304**) — PR action, with the two modifier overrides:
  > ```js
  > let t = Iya.find((n) => n.re.test(e))?.action, r = e.replace(eQo, " ");
  > if (t === "merged") {
  >   if (/--disable-auto\b/.test(r)) return "auto-merge-disabled";
  >   if (/--auto\b/.test(r))         return "auto-merge-enabled";
  > } else if (t === "ready" && /--undo\b/.test(r)) return "draft";
  > return t;
  > ```
  `Iya.find` takes the **first** matching entry in declaration order (create, edit, merge,
  comment, close, reopen, ready). `gh pr review` is **not** in `Iya` — `r6b` exists
  (**194646**) but is consumed by an unrelated function (`n6b`, **194314**), not by `Pya`.
- `Oya(e)` (**194370–194373**) — **last** PR-URL occurrence in the output:
  > `let t = e.match(new RegExp(tQo.source, "g")); return t ? rQo(t.at(-1)) : null;`
  `rQo` (**194325–194330**) yields `{ prNumber, prUrl, prRepository, provider }`.
- `Vpp(e)` (**194419–194422**) — the no-URL fallback:
  > `let t = e.match(/[Pp]ull request (?:(\S+)#)?#?(\d{1,9})\b/); return t?.[2] ? { prNumber: parseInt(t[2], 10), prRepository: t[1] } : void 0;`

**OBSERVED, and worth stating plainly: `vFr` never consults an exit code.** "Success" is inferred
entirely from the shape of the output. (The neighbouring *telemetry* path `nQo` **does** check
`r.exitCode === 0` at **194357** — a different consumer with a different rule. `Mya`, the
branch-name sanity filter at **194624**, is likewise telemetry-only and does not gate `odS`.)

**INFERRED, two fragilities the port inherits:** `/--amend\b/` at **194441** is tested against the
**raw** command, not the quote-stripped `r` that `Pya` uses — so `git commit -m "revert the
--amend"` classifies as an amend. And `Upp`/`TLn` match anywhere in the command string, so
`echo "git push" && ls` is a candidate whose output simply fails the result predicate.

**Renderer tie-in (OBSERVED).** The scraped shapes map 1:1 onto the header clauses:
`commits` are bucketed by `kind` in the fixed order `["committed","amended","cherry-picked"]` with
labels `{committed:"committed", amended:"amended commit", "cherry-picked":"cherry-picked"}` and
the shas joined by `", "` (**518575–518581**); `pushes` are **deduplicated** with `fo` and joined
(**518583–518585**, `fo(e) = [...new Set(e)]` at **18625**); `branches` render one clause each via
`{merged:"merged", rebased:"rebased onto"}` (**518587–518590**); `prs` render one clause each via
the ten-entry action→verb map at **518593**, as a link when `url` is present (**518595**).

### B.4 `bashCount` vs `gitOpBashCount` — the no-double-count bookkeeping

**OBSERVED.** They are two independent counters, incremented at two different moments:

- `bashCount` at **absorption of the call** — `o.bashCount = (o.bashCount ?? 0) + p` (**237153**);
- `gitOpBashCount` at **scrape of the result** — `t.gitOpBashCount = (t.gitOpBashCount ?? 0) + 1`,
  once per result that yielded any of the four (**237016–237017**).

So a `git commit` call is counted in **both**. `idS` emits both raw, and only when `bashCount > 0`
(**237035–237036**):

> `if ((e.bashCount ?? 0) > 0) u.bashCount = e.bashCount, u.gitOpBashCount = e.gitOpBashCount;`

**The subtraction happens in the renderer, not in the accumulator** (**518466–518467**):

> `P.current = Math.max(P.current, e.bashCount ?? 0);`
> `… let Z = e.gitOpBashCount ?? 0, le = Ns() ? Math.max(0, P.current - Z) : 0, …`

and `le` is what the shell clause prints (**518625–518626**):

> `if (Ns() && le > 0) $e("bash", s ? "running" : "ran", … le … le === 1 ? "command" : "commands");`

**Load-bearing detail (OBSERVED).** The watermark ratchet (`P.current`) is applied to the **gross**
`bashCount`; `gitOpBashCount` is **not** watermarked and is subtracted *after* the ratchet. This is
what lets the shell-command clause legitimately **decrease** mid-turn: `git commit` starts →
`bashCount 1, gitOp 0` → "running **1** shell command"; its result arrives → `gitOp 1` → `le = 0`,
the shell clause vanishes and "committed abc1234" takes its place. `Z` is still included in `de`
(**518467**), so a run consisting solely of a recognised git op still renders.

One brief-mode merge site also carries the pair forward (**237281–237284**):

> `if (t.bashCount) e.bashCount = (e.bashCount ?? 0) + t.bashCount;`
> `if (t.gitOpBashCount) e.gitOpBashCount = (e.gitOpBashCount ?? 0) + t.gitOpBashCount;`

### B.5 Dedup — where it exists, and where it does not

**OBSERVED.** There is **no dedup in `odS`**. `commits`, `pushes`, `branches` and `prs` are plain
append-only arrays (**237008–237015**). The only dedup in the whole pipeline is at render time:
`fo()` on push branch names (**518584**). Repeated commits produce repeated shas in the joined
list; two `gh pr comment` calls on PR #12 produce two identical clauses (and two React children
keyed `pr-commented-12`, **518595**).

**INFERRED.** Append-only is safe *only* because `iNp` re-derives from scratch each call
(`o = Rka()` at **237093**) — the same idempotence point made in §A.4. Nothing prevents the same
`tool_use_id` being scraped twice within one pass either; `bashCommands` entries are never
removed, but a given result message is visited once per pass.

---

## C. Reconciliation with spec §3.1

**One contradiction, and it is the kind that would ship as a bug.**

Spec §3.1 says of git ops: *"those bash calls move out of `bashCount` into `gitOpBashCount` (so
'committed abc123f' and 'ran 2 shell commands' never double-count one call)"*.

Canon does **not** move anything. `bashCount` stays gross; `gitOpBashCount` is a parallel tally;
the renderer computes `le = max(0, watermark(bashCount) − gitOpBashCount)` (**518467**). The
*invariant* the spec states is right — no call is double-counted — but the *mechanism* is not, and
implementing the literal wording alongside canon's watermark produces a stuck counter: if the git
call is subtracted from `bashCount` at accumulation, `bashCount` goes 1 → 0 while the ratchet holds
`P.current = 1`, so `le` latches at 1 and the header keeps saying "ran 1 shell command" next to
"committed abc1234" — exactly the double-count the clause was written to prevent. The order
matters: **ratchet the gross count, subtract the git-op count after.**

Two smaller refinements to §3.1 (not contradictions, but the spec's one-liners under-specify):

1. *"an errored result **pops the call out**"* — true only in the narrow case of §A.3 row 1/2. In
   the general case (§A.3 row 3) the errored silent call **stays inside the cluster** and only the
   run closes. Any acceptance cell written as "TodoWrite errors ⇒ it leaves the run" will be wrong
   for the ordering where another absorbed message follows it.
2. *"ToolSearch: absorbed silently — counted nowhere, breaks nothing"* — correct on counting and on
   never popping out (`popsOutOnError` is false for it, **236807–236809**), but it is **not**
   inert with respect to run identity: like every silent call it is pushed into `o.messages`
   (**237197**) and can therefore *open* a run and become its anchor (§A.1).

The anchor-stability invariant is unaffected in the direction the spec pins it; the one case that
needs a deliberate divergence is a run whose *only* member is a silent call that later errors —
canon dissolves the run retroactively, we must not (§A.4).

---

## D. Base-doc "Unresolved" status

This addendum does not touch the base doc's open list (`gtr`, `bet`, `oJS`, `eUn`, `Beh`/`Feh`/`Tth`,
`RJe`, the expansion-Set-across-screen-switch question). It closes only the two items spec §3.1
raised. Newly opened, small:

- `gQo` / `Ika` / `Aka` (**237156–237157**) — the bash `latestDisplayHint` formatters. Not read.
- `Ek(command)` (**378935**) — the pipeline splitter `xmv` classifies over. Not read; its exact
  segmentation decides which compound commands are read-ish in the classic renderer.
- Whether any user message in canon's normalised stream can carry two bash `tool_result` blocks
  (the latent double-scrape in §B.2). Not settled from the reprint.
