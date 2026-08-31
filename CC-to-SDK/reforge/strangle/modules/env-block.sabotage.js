// Deliberately WRONG variant — proves the env-block splice is live: the block
// is stamped into a dispatched Agent's system prompt, so with this installed the
// `subagent` scenario's emitted request bodies must diverge from the oracle's.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async envBlock() {
    return `Here is useful information about the environment you are running in:
<env>
REFORGE_SABOTAGED_ENV
</env>`;
  },
});
