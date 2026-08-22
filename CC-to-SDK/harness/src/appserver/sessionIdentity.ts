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
 *  Returns the config untouched when there is no hatch object, so a caller can pipe through this
 *  unconditionally without minting an `extraOptions` key nothing asked for. Never mutates its input. */
export function stripIdentityHatch(config: Record<string, unknown>): Record<string, unknown> {
  const extra = config.extraOptions;
  if (!extra || typeof extra !== "object") return config;
  const hatch = { ...(extra as Record<string, unknown>) };
  for (const key of SESSION_IDENTITY_OPTIONS) delete hatch[key];
  return { ...config, extraOptions: hatch };
}
