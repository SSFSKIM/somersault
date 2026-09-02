// PARITY LAYER (§2.5 `reference`) — the text that says WHAT a hook will run
// (upstream `_9`, 2.1.251, chunk-fy12d89p @667541, 291 bytes).
//
// THE SECOND LIVE TAKE of C10.6's fix round, and the largest pure function in
// the belt with more than one caller. Six consumers inside the layer alone — the
// two executors, the subprocess runner, the status-message fallback, the
// cloud-session refusal and the matcher projection — and nine call sites.
//
// WHAT IT IS FOR, and it is not only a label. The streaming executor takes this
// string as the COMMAND IT WILL EXECUTE: for a command hook the result is passed
// through a `${CLAUDE_PLUGIN_ROOT}` substitution and handed to the subprocess
// runner. Elsewhere the same string is the human-facing identification of a hook
// in an error attachment and the fallback for a missing `statusMessage`. One
// projection, two fates — design §2's shape again, at a third scale.
//
// SEVEN ARMS, ONE PER HOOK TYPE, and three of them are decisions rather than
// field reads:
//
//   command   the args are OPTIONAL and the join is a single space. With args
//             the command and its args are joined; without them the bare
//             command is returned rather than a one-element join — which is the
//             same string, so the distinction is invisible in the result and
//             visible only in what upstream wrote.
//   prompt and agent return the SAME field. They are two arms rather than one
//             because the union's two members are separate types, and a copy
//             that merged them would be right today and wrong the first time
//             either grows a field.
//   mcp_tool  is `server/tool`, a template rather than a field.
//   callback and function return their own KIND as the text, because a
//             function has no source to name. That is why the two literals read
//             like a mistake and are not one.
//
// There is no default arm: a type outside the union returns `undefined`, and
// the callers that build a command from it would then run nothing. Upstream's
// shape is reproduced rather than repaired.

/**
 * @param hook a resolved hook entry
 * @returns the text identifying what it runs, or undefined for an unknown type
 */
export function hookInvocationText(hook) {
  switch (hook.type) {
    case "command":
      return hook.args ? [hook.command, ...hook.args].join(" ") : hook.command;
    case "prompt":
      return hook.prompt;
    case "agent":
      return hook.prompt;
    case "http":
      return hook.url;
    case "mcp_tool":
      return `${hook.server}/${hook.tool}`;
    case "callback":
      return "callback";
    case "function":
      return "function";
    // BEHAVIOUR-IDENTICAL, and present for the instrumenter rather than for the
    // program: upstream's switch has no default clause, and a no-match path that
    // is an arm of no clause cannot be marked, so the branch inventory would be
    // incomplete (§3.1). Falling out of the switch returns `undefined`, which is
    // exactly what upstream does for a type outside the union. W7.6a made the
    // same rewrite on the eighteen-arm event switch for the same reason.
    default:
      break;
  }
  return undefined;
}
