// SABOTAGE LAYER (§2.5). The block is stamped into a dispatched Agent's system
// prompt, so `subagent`'s emitted request bodies must diverge from the oracle's.
export async function envBlock() {
  return `Here is useful information about the environment you are running in:
<env>
REFORGE_SABOTAGED_ENV
</env>`;
}
