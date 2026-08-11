// appserver/reloads.ts — M2b Task 5: `plugin/reload` and `skill/reload`, promoted from probe 105 (both
// ALIVE). Two thin chain-scoped handlers over the engine's own re-scan calls.
//
// The reply is the fixed `{ok:true}` the promotion criteria named, NOT the engine's receipt — even though
// probe 105 found each call answers with a fresh catalog (commands+agents+plugins+mcpServers for plugins,
// skills for skills). That receipt is the same data `thread/capabilities/read` already serves, and
// mirroring it into a second payload shape would give clients two sources for one catalog that drift
// apart. What the receipt DOES settle is that a reload is a capabilities refresh, so each handler pings
// `thread/capabilities/changed` after replying — reply first, ping second, exactly as lifecycle.ts's
// reinitialize and mcp.ts's three topology mutations do. `skills` is not one of the four catalogs
// `capabilities()` returns, but the ping is right for BOTH reloads on evidence, not symmetry: probe 105's
// captured catalog shows skill-backed commands in the COMMANDS surface (the same names appear in that
// payload's commands list and its skills list), so a skills reload changes what `supportedCommands`
// returns — which is precisely what the ping tells clients to re-read.
//
// Chain-scoped, mirroring settings.ts/mcp.ts/tasks.ts: a reload replaces the engine's live command and
// agent tables, so it must not interleave with another op mutating the same session. The engine method is
// resolved INSIDE the chain, not at arrival — rewind's swap can replace `record.session` while this waits
// its turn, and the engine that serves the op is the one live when the chain reaches it.
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import type { EngineSession } from "./registry.js";
import { threadIdParams } from "./schema/core.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors mcp.ts/tasks.ts — registry.ts's `updatedAt` is unix seconds, not ms

const UNSUPPORTED = "unsupported by this engine"; // introspect.ts:36's exact wording

/** One shape, twice over. `pick` reads the member off the session at chain time (see the header) rather
 *  than closing over a session resolved at arrival. */
function reload(pick: (s: EngineSession) => (() => Promise<unknown>) | undefined): Handler {
  return (srv, ctx, id, params) => {
    const parsed = threadIdParams.safeParse(params);
    if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
    const record = srv.registry.get(parsed.data.threadId);
    if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    record.chain = record.chain.then(async () => {
      const fn = pick(record.session);
      if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
      try {
        await fn();
        record.updatedAt = nowSec();
        ctx.peer.reply(id, { ok: true });
        srv.broadcast(record.id, "thread/capabilities/changed", { threadId: record.id });
      } catch (e) {
        // A chain-deferred body runs LATER than dispatch's arrival-time -33005 gate, so the engine can die
        // while the op waits its turn — and scoring that -32603 blames the server for a dead read loop the
        // caller can see for itself. Same re-check and wording as dispatch's own post-handler catch
        // (server.ts), so a client sees one -33005 message on either path.
        if (record.session.isEnded?.()) { ctx.peer.replyError(id, ERR.ENGINE_GONE, "Engine is gone (session ended)"); return; }
        ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
      }
    });
  };
}

export const pluginReload = reload((s) => s.reloadPlugins?.bind(s));
export const skillReload = reload((s) => s.reloadSkills?.bind(s));
