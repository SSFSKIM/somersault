// appserver/sessionIdentity.ts — the vocabulary of "this config names an EXISTING conversation", and the
// one strip both sites that must drop it perform: `review/start`'s inherited config (review.ts) and the
// swap family's base (rewind.ts, shared by thread/rewind, thread/clear and thread/reopen). Each of those
// grew its own list, and each list had a different hole in it — the swap family's missed the hatch below
// entirely. One home is what stops the next knob from being remembered in one place and forgotten in the
// other; it lives in its own module so neither of those files has to import the other.

/** In THIS repo's vocabulary (config/types.ts) — the six ways a config says "that conversation". */
export const SESSION_IDENTITY = ["resume", "resumeAt", "droppedTurnUuid", "forkSession", "sessionId", "continueSession"] as const;
/** The same six in the SDK's own vocabulary, which renames four of them (resolveOptions.ts is the map).
 *  Kept as a second list rather than one mapping because they are two different wires, and a rename on
 *  either side should fail loudly here rather than silently stop stripping. */
export const SESSION_IDENTITY_OPTIONS = ["resume", "resumeSessionAt", "resumeDropsTurn", "forkSession", "sessionId", "continue"] as const;
/** The THIRD wire: the spawned CLI's own argv (probe 114) — and the only one of the three that is LONGER
 *  than six. `extraArgs` entries are appended AFTER every typed identity flag the SDK pushes, and the CLI
 *  adopts the LAST occurrence of a repeated flag — measured in both orders, with the result envelope and
 *  the transcript filename naming the same winner — so an unstripped `extraArgs.resume` overrules the typed
 *  field exactly as the options hatch could. The leading six are the SDK-typed knobs in the CLI's own
 *  spellings, which hyphenate four of them; same rule as above: a rename on the CLI side should fail loudly
 *  here rather than silently stop stripping.
 *
 *  The trailing THREE mirror no typed `Options` field at all — they live on this wire and nowhere else, so
 *  only a sweep of the wire itself finds them. Found by reading the installed native CLI's WHOLE option
 *  list (`claude --help`) for flags whose VALUE can name an existing conversation, which is this module's
 *  one test for identity:
 *    `--from-pr [value]`                    "Resume a session linked to a PR by PR number/URL".
 *    `--teleport [session]`                 "Resume a teleport session, optionally specify session ID".
 *    `--cloud [description|session_id|url]` "Create a cloud session with the given description, or attach
 *      to an existing one by session ID or claude.ai/code URL" — the VALUE SHAPE decides, and only the
 *      caller's string says which it is. Stripped anyway: a swap or "detached" review silently continuing
 *      the target's cloud conversation is a worse failure than a passthrough cloud description going
 *      missing.
 *  Considered by that same sweep and deliberately NOT identity: `--environment <environment_id>` creates a
 *  NEW cloud session on a self-hosted environment — it names infrastructure, never a conversation — and
 *  `--worktree [name]` names a directory. */
export const SESSION_IDENTITY_ARGS = ["resume", "resume-session-at", "resume-drops-turn", "fork-session", "session-id", "continue",
  "from-pr", "teleport", "cloud"] as const;

/** Whether an `extraArgs` KEY is one of the argv spellings above — matched on the part BEFORE any `=`, because the SDK
 *  pushes a null-valued key literally as `--<key>`: `{"resume=<id>": null}` reaches the CLI as the perfectly
 *  valid `--resume=<id>` under a key that never equals `"resume"`, so whole-key deletion alone lets the flag
 *  through in the one encoding that needs no value at all. */
const isIdentityArg = (key: string): boolean => (SESSION_IDENTITY_ARGS as readonly string[]).includes(key.split("=")[0]);

/** A copy of one `extraArgs` map with every identity flag (in either encoding) gone and everything else
 *  untouched — the argv strip itself, shared by the top-level hatch and the nested one below. */
function stripIdentityArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const key of Object.keys(out)) if (isIdentityArg(key)) delete out[key];
  return out;
}

/** `config` with every identity knob removed from its `extraOptions` ESCAPE HATCH — the second half of any
 *  identity strip, and the half both sites are apt to forget, because the hatch is spread into the SDK
 *  `Options` LAST (resolveOptions.ts) and so reaches the engine without passing through a typed field at
 *  all. Stripping only the typed six leaves `extraOptions: {resume}` free to overrule the whole intent: a
 *  rewind, reopen or clear opening or mutating a DIFFERENT conversation while the record is stamped with
 *  the id it was supposed to keep, and a "detached" review reading the target's own transcript.
 *
 *  DELETED here, not written `undefined` as the typed six are: that spread means a present-but-undefined
 *  key would CLOBBER an identity a caller set deliberately on top of this (rewind's own
 *  `{...swapBaseConfig(cfg), resume: sessionId}`), turning an over-permissive hatch into a broken swap.
 *
 *  BOTH HATCHES, and both of the ways a flag gets round a flat exact-key pass over them. The argv hatch is
 *  reachable at two depths — `config.extraArgs`, and `config.extraOptions.extraArgs`, which the Options
 *  spread restores OVER the sanitized top-level one — and in two encodings, since a null-valued key is
 *  pushed to the argv literally, so `{"resume=<id>": null}` is a working `--resume=<id>` whose key matches
 *  nothing. Each is sanitized in place, keeping the legitimate argv values a caller put beside them.
 *
 *  Returns the config untouched when there is no hatch object, so a caller can pipe through this
 *  unconditionally without minting an `extraOptions` key nothing asked for. Never mutates its input. */
export function stripIdentityHatch(config: Record<string, unknown>): Record<string, unknown> {
  let out = config;
  const extra = config.extraOptions;
  if (extra && typeof extra === "object") {
    const hatch = { ...(extra as Record<string, unknown>) };
    for (const key of SESSION_IDENTITY_OPTIONS) delete hatch[key];
    // A hatch inside the hatch. That same last-wins spread is over the WHOLE resolved Options, so an
    // `extraArgs` key in here does not merge with the sanitized `extraArgs` below — it REPLACES it, handing
    // the argv back the identity flag this function just took off it. Sanitized rather than deleted whole,
    // because its non-identity half is a legitimate argv passthrough like any other. (`extraOptions
    // .extraOptions` is NOT the same hole: nothing downstream reads a nested hatch, so a key by that name is
    // inert rather than restored.)
    const nested = hatch.extraArgs;
    if (nested && typeof nested === "object") hatch.extraArgs = stripIdentityArgs(nested as Record<string, unknown>);
    out = { ...out, extraOptions: hatch };
  }
  // The second hatch, same treatment: `extraArgs` reaches the engine as raw CLI argv, where the last
  // occurrence of a flag wins (probe 114) — a knob here needs no Options field at all to steal the swap.
  const args = config.extraArgs;
  if (args && typeof args === "object") out = { ...out, extraArgs: stripIdentityArgs(args as Record<string, unknown>) };
  return out;
}
