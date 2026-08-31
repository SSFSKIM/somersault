# How 2.1.251 resolves `tengu_*` feature gates (and why reforge replays are already pinned)

Date: 2026-08-31. Evidence: `~/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines,
line numbers below), `reforge/config/`, one offline `m1/run.ts --scenario plain` replay.

**Headline:** the flag system is **GrowthBook**, not Statsig. And reforge already forces the
compiled-in defaults on *every* gate, because `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` /
`DISABLE_TELEMETRY=1` (set in `src/runTurn.ts:61-66` and `src/harness.ts:72-76`) trip the
provider's `isEnabled()` off. There is nothing to snapshot and nothing that can drift.

## 1. Where cached gate data lives (Q1)

Two independent caches, **both inside `.claude.json`** (the global config object `oe()`), not in a
separate file and not in `~/.claude/statsig`:

| Layer | Key in `.claude.json` | Read at |
|---|---|---|
| GrowthBook feature values | `cachedGrowthBookFeatures`, `cachedExperimentFeatures`, `cachedExperimentData` | 302072, 302088, 301841, 301849 |
| Server "client data" bootstrap blob | `clientDataCacheSlots` (keyed by entrypoint/model/org), legacy `clientDataCache` | 141154, 141163, 312566-312572 |

`statsig` appears **only** as a directory-name string in two housekeeping lists — the known-config-
entries allowlist (124150) and a cleanup sweep (722608). No SDK, no reader, no writer: a vestige.

`reforge/config/` (verified by `ls -laR`) holds `.claude.json`, `.last-cleanup`,
`policy-limits.json`, `remote-settings.json` (literally `{}`), `backups/`, `projects/`,
`session-env/`, `sessions/`, `shell-snapshots/`, `tasks/`. **No statsig dir, no gate cache.**
`grep -rl 'cachedGrowthBookFeatures|clientDataCacheSlots|clientDataCache|cachedExperimentFeatures'
config/` → no matches; `.claude.json` carries only install/migration identity fields.

## 2. What the resolver does with no cache and no network (Q2)

The resolver is `getFeatureValueWithSource` on the GrowthBook client class `ql`
(**cli.pretty.js:302055-302074**), reached through the tiny alias `function I(e, t) { return
$m(e, t).value; }` at **310385** (`$m` → 310383 → `Be().getFeatureValueWithSource`). Precedence,
first match wins:

1. **environment overrides** → `source:"override"` (302057). Backed by
   `CLAUDE_INTERNAL_FC_OVERRIDES` (310304) — but see §4: the parser is stubbed out in this build.
2. **config overrides** → `source:"override"` (302060). `readConfigOverrides() { return; }` (301844)
   — also stubbed.
3. **`if (!isEnabled() && !isDiskCacheReadableWhileDisabled()) return { value: t, source:
   "disabled" }`** (302062-302063) — **returns the caller's default `t`**.
4. remote-eval payload (in-memory, this process) → `source:"payload"` (302067).
5. disk cache `readGlobalConfig().cachedGrowthBookFeatures?.[e]` → `source:"disk"` (302071).
6. **`return { value: t, source: "fallback" }`** (302074) — the caller's default again.

So there is **no per-gate default table**. Defaults are the *second argument at each call site*:
`I("tengu_expressive_whistle", !1)` (497734), `I("tengu_kestrel_moor", !0)` (310433),
`I("tengu_gb_refresh_interval_minutes", null)` (310413). Census of the `I(...)` alias alone:
**431 call sites / 379 distinct gates**; default shapes are 249×`false`, 104×`true`, 17×`null`,
13×`{}`, 9×`""`, plus a handful of numbers. (Other aliases in other chunks: `Lp(` async gate check
×15, `DH(` ×7, `gpe(` pinned-once ×1, `R4t(` blocking ×1. The bundle has 2,195 distinct `tengu_*`
literals overall, most of them telemetry event names rather than gates.)

**Enablement predicates** (the whole point):

- `isEnabled` = `R$()` = `!a.DISABLE_GROWTHBOOK && nP()` — **310354**
- `nP()` = `!zh()` — **310184**
- `zh()` = `O2() || mi() !== null || _j() || k2()` — **302653**
- `_j()` = `x() !== "default"` — **697501**; `x()` returns `"essential-traffic"` if
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `"no-telemetry"` if `DISABLE_TELEMETRY` or
  `DO_NOT_TRACK` — **697488-697496**
- `isDiskCacheReadableWhileDisabled` = `I7()` =
  `a.CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF && !a.DISABLE_GROWTHBOOK && _j() && pr()` — **310357**

Reforge sets both `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `DISABLE_TELEMETRY=1` and does
**not** set `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF`. Therefore `isEnabled()===false` and
`isDiskCacheReadableWhileDisabled()===false`, and **step 3 fires for every gate**: the disk cache is
never even read, and every gate resolves to its compiled-in call-site default with
`source:"disabled"`. `checkGateCachedOrBlocking` short-circuits the same way:
`if (!this.deps.isEnabled()) return !1;` (302084).

### The second layer: the server "client data" blob

Some call sites consult the bootstrap blob *before* the gate default, e.g. **497722-497730**:

```js
function OXn() {
  if (!zg()) return !1;
  let e = a.CLAUDE_CODE_LUMINOUS_WHISTLE;   // per-gate env override
  if (e !== void 0) return e;
  let t = Fl()?.[yIt];                       // client-data blob, keyed by gate name
  if (typeof t === "boolean") return t;
  return I(yIt, !1);                         // compiled-in default
}
```

`Fl()` (**312562-312572**) reads `oe().clientDataCacheSlots[key]`, falling back to legacy
`clientDataCache`; returns `null` when neither exists. ~24 such `Fl()?.` gate reads in the bundle.

The blob is fetched by `GET {BASE_API_URL}/api/claude_cli/bootstrap?entrypoint=…&model=…`
(**141092**, 5 s timeout, exported as `fetchBootstrapData` / `refreshBootstrapData` at 569258).
Staleness is driven by an `x-cc-atis-current` response header (`DXn`, **497724**) compared against
the cached `atis` pin (`cNe()`, **310425-310428**); mismatch triggers the jittered refetch whose
telemetry is `tengu_client_data_stale_refetch` (**497758**), throttled by
`tengu_expressive_whistle_config` (min 300 s, max jitter 180 s — 497724, 497766-497770).

**Both paths are dead under reforge's env:**
- the bootstrap fetch itself: `if (Ct()) return n("[Bootstrap] Skipped: Nonessential traffic
  disabled"), null;` — **141086-141087** (`Ct()` = `x() === "essential-traffic"`, 697498)
- the stale-refetch path: same `Ct()` guard in its precondition chain — **497741**
- and it is additionally gated on real OAuth/WIF/API-key auth (141101-141105).

## 3. Does a replay touch the network for gates? (Q3) — no

Ran `npx tsx m1/run.ts --scenario plain` with `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-REPLAY-DUMMY`
(a bogus value, only to clear the runner's `process.exit(1)` auth guard at `m1/run.ts:37-40`).
Result: `cassette exists — reusing` → `ALL PASS`. A garbage token producing a clean pass is itself
proof no gate/bootstrap call reaches the network. `find config -exec stat` before/after: the **only**
changes are two new session `.jsonl` files under `config/projects/-…-reforge-sandbox/` and that
dir's + `config/sessions/`'s mtimes. `.claude.json` was not rewritten and still has no gate keys.

Answer to "cache, defaults, or silent fetch failure": **defaults** — not by fetch failure but by an
explicit short-circuit two levels above the network.

## 4. Kill-switches and override knobs (Q4)

Grep of `DISABLE` / `EXPERIMENT` / `STATSIG` / `GROWTHBOOK` uppercase literals near the resolver:

| Env var | Line | Effect |
|---|---|---|
| `DISABLE_GROWTHBOOK` | 310354, 310357, 93235, 93265, 93271 | **The kill-switch.** Forces `isEnabled()` false → every gate to its compiled-in default. User-visible: Remote Control refuses to run and says so (93236). |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 697489, 141086, 497741 | Same effect on gates (via `zh()`), **plus** skips the `/api/claude_cli/bootstrap` client-data fetch. What reforge already sets. |
| `DISABLE_TELEMETRY` / `DO_NOT_TRACK` | 697491-697494 | Same gate effect via `zh()`; does *not* by itself skip bootstrap (`Ct()` is false) — but reforge sets the nonessential-traffic var too. |
| `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` | 310357 | Opt-*in* to keep reading `cachedGrowthBookFeatures` while telemetry is off. Must stay unset. |
| `CLAUDE_INTERNAL_FC_OVERRIDES` | 310304 | Passed to the client as `readEnvironmentOverrides`, but **`getEnvironmentOverrides()` (301822-301826) never calls it** — it sets `environmentOverridesParsed = true` and returns the always-`null` field. Parser stripped from the public build. Do not build on it. |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | 34034 | Unrelated — API beta headers, not gates. |
| `CLAUDE_CODE_DISABLE_EXPERIMENTS` | — | **Does not exist** in 2.1.251. |

`readConfigOverrides()` (301844), `setConfigOverride()` (301866), `clearConfigOverrides()` (301868)
are all stubbed to `return;` in this build, so `~/.claude` cannot pin gates either.

## Verdict for the campaign spec (§3.3)

**Do not build the "snapshot the blob into `reforge/config` + assert stability at record time"
mechanism.** It would pin a cache that is never read, against a fetch that never happens.

The correct pinning mechanism is the **env kill-switch, which reforge already sets** — but the spec
should make it explicit and defended rather than incidental:

1. Add `DISABLE_GROWTHBOOK: "1"` to the reforge env alongside the existing two vars. It is the
   narrowest, most direct switch (`!a.DISABLE_GROWTHBOOK && …`, 310354) and it does not depend on
   the telemetry predicate chain staying shaped the way it is today.
2. Assert `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` is **absent** from the replay env.
3. Replace the blob-snapshot task with a **leak check**: after every record and replay, assert
   `reforge/config/.claude.json` contains none of `cachedGrowthBookFeatures`,
   `cachedExperimentFeatures`, `cachedExperimentData`, `clientDataCacheSlots`, `clientDataCache`.
   Their appearance means an env guard regressed. This is cheap and it is the real invariant.
4. For `engine-ts`, the thing to port is not a blob but **379 compiled-in call-site defaults**
   (`I("tengu_x", <default>)`). Extracting that name→default table from the bundle is a genuine
   deliverable; the gate *provider* can be a constant-folded stub returning those defaults.

Residual risk to note in the spec: gate defaults are baked per engine build, so a bundle re-pin can
silently change behavior. The `I("tengu_…", default)` extraction in (4) doubles as the diff surface
for that — snapshot the table per pinned bundle version and diff it on re-pin.
