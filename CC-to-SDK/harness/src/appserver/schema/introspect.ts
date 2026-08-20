// appserver/schema/introspect.ts — the introspection reads' published RESPONSE shapes (D-M5-19's `result`
// slot). Only `thread/capabilities/read` declares one today, and it declares one for a specific reason
// rather than as the start of a retrofit: M5 Task 13 gives that reply a SECOND, OPTIONAL field whose
// ABSENCE carries meaning, and "absent means the engine never told us" is a contract no params schema and
// no field name can state. The other four reads (`contextUsage`, `usage`, `init`, `account`) still publish
// none — each relays an SDK-owned payload verbatim, so the shape a client would validate against is the
// SDK's, not ours (introspect.ts's "UNTYPED passthrough" rule).
import { z } from "zod/v4";

/** `capabilities` is the engine's own four-catalog object, relayed verbatim by `introspect.ts` and typed
 *  identically by both engines that produce it (`registry.ts`'s `EngineSession.capabilities`, and
 *  `fleetEngine.ts`, which defaults each catalog so a pre-M3 host still answers with four). The element
 *  shapes are the SDK's — `unknown` here rather than re-described, for the passthrough reason above.
 *
 *  `terminalSlashCommands` (M5 Task 13, spec D-M5-22) is the only field in this reply this server derives
 *  rather than relays. It is latched off the engine's `system/init` frame (`router.ts`'s
 *  `routeTerminalCommands`) because that frame is the ONLY place the classification exists anywhere in the
 *  SDK surface — `supportedCommands()`, which is what `capabilities.commands` is, carries no
 *  terminal-bound marker at all (`SlashCommand`, sdk.d.ts). It exists for exactly the client class this
 *  server exists for: a remote or web UI that must not offer a command only a terminal can run.
 *
 *  THREE STATES, keyed on the INIT FRAME rather than on the key, which is the correction review F1 forced:
 *    - key ABSENT — no init frame has arrived on this thread yet. On a fresh thread that is simply
 *      "before the first turn"; init is re-emitted every turn, so it resolves itself.
 *    - `[]` — an init frame arrived and advertised no terminal-bound command. A real answer, and the one
 *      the ENGINE actually produces: `sdk.d.ts` declares `terminal_slash_commands` "present only when
 *      non-empty", so a session with none, and a CLI too old to have the field, both say so by omitting
 *      it. Those two are the same instruction for a remote UI deciding what to hide, so both land here.
 *    - a non-empty list — those commands are terminal-bound. Last frame wins, since init recurs.
 *  Every init frame is authoritative, which is what keeps a once-latched list from outliving its truth: a
 *  `thread/capabilities/changed` ping tells clients to re-read, and both halves of the re-read then answer
 *  for the same session. A client that renders `[]` and an absent key the same way is choosing to; one
 *  that cannot tell "the engine says none" from "we have not heard from the engine" has been mis-told. */
export const capabilitiesReadResult = z.object({
  capabilities: z.object({
    models: z.array(z.unknown()),
    commands: z.array(z.unknown()),
    mcpServers: z.array(z.unknown()),
    agents: z.array(z.unknown()),
  }),
  terminalSlashCommands: z.array(z.string()).optional()
    .describe("commands this session advertises as terminal-bound, latched from the engine's system/init frame. EVERY init frame is authoritative: the KEY IS ABSENT (never null) only while no init frame has arrived on this thread; an init frame that omits the field yields [], which is how the engine reports 'none' (the SDK sends the field only when non-empty, so a session with no tagged command and a CLI predating the field are indistinguishable and mean the same thing to a client deciding what to hide); an init frame carrying the field yields it verbatim, latest frame winning"),
});
