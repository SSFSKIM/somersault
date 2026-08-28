// Probe 117c — What does `Options.settings` actually put on the CLI's argv?
//
// The design's per-thread inbound policy rides `--settings` (the flag layer, which the CLI force-enables
// regardless of `settingSources`). 117 proved that route works when the value is a JSON STRING. The
// question this probe closes is whether the OBJECT form — which `sdk.d.ts` declares as accepted, and
// which THIS HARNESS already uses today (`config/settings.ts`'s mergeAutoCompact folds
// `autoCompactEnabled` / `autoCompactWindow` into an object and hands it to `options.settings`) —
// survives serialization. Reading the SDK bundle says it does not: the only arg emitter is
// `String(n)`, and the sole JSON.stringify of `settings` sits behind a branch that returns early unless
// `options.sandbox` is set. `String({...})` is `"[object Object]"`, which the CLI would then try to
// resolve as a FILE PATH.
//
// If that is right, two things follow: the design must pass a string, and the harness has a live latent
// defect — every setting routed through `config.settings` has been silently dropped.
//
// No session is started and no model turn is spent: `spawnClaudeCodeProcess` intercepts the launch,
// records argv, and reports. That makes this deterministic and free.
//
// Run from CC-to-SDK/probes:
//   npx tsx probes/117c-settings-argv-serialization.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const log = (...a: unknown[]) => console.log("[p117c]", ...a);

function capture(label: string, settings: unknown, extra?: Record<string, unknown>): Promise<string[]> {
  return new Promise(resolve => {
    let settled = false;
    const done = (argv: string[]) => { if (!settled) { settled = true; resolve(argv); } };
    async function* input() { yield { type: "user" as const, message: { role: "user" as const, content: "noop" }, parent_tool_use_id: null, session_id: "x" }; }
    const q: any = query({
      prompt: input(),
      options: {
        model: "claude-sonnet-4-5",
        settingSources: [],
        settings,
        ...extra,
        // The launch never happens: we record argv and hand back a corpse the SDK will give up on.
        spawnClaudeCodeProcess: (o: any) => {
          done(o.args as string[]);
          const noop = () => { /* nothing */ };
          return {
            stdin: { write: noop, end: noop, on: noop },
            stdout: { on: noop, setEncoding: noop, pipe: noop },
            stderr: { on: noop, setEncoding: noop, pipe: noop },
            on: (ev: string, cb: any) => { if (ev === "exit") setTimeout(() => cb(0, null), 10); },
            kill: noop,
literal: label,
          } as any;
        },
      } as any,
    });
    (async () => { for await (const _ of q) { /* drain */ } })().catch(() => { /* expected */ });
    setTimeout(() => done([]), 15_000).unref?.();
  });
}

function settingsArg(argv: string[]): string {
  const i = argv.indexOf("--settings");
  if (i >= 0) return argv[i + 1] ?? "(flag with no value)";
  const eq = argv.find(a => a.startsWith("--settings="));
  return eq ? eq.slice("--settings=".length) : "(absent)";
}

(async () => {
  const asObject = await capture("object", { crossSessionInbound: "refuse" });
  const asString = await capture("string", JSON.stringify({ crossSessionInbound: "refuse" }));
  const asObjectSandboxed = await capture("object+sandbox", { crossSessionInbound: "refuse" }, { sandbox: true });

  console.log("\n=== VERDICT (probe 117c) ===");
  const o = settingsArg(asObject), s = settingsArg(asString), os = settingsArg(asObjectSandboxed);
  console.log(`object   -> --settings ${JSON.stringify(o)}  ${o.startsWith("{") ? "✅ JSON" : "❌ NOT JSON"}`);
  console.log(`string   -> --settings ${JSON.stringify(s)}  ${s.startsWith("{") ? "✅ JSON" : "❌ NOT JSON"}`);
  console.log(`object+sandbox -> --settings ${JSON.stringify(os)}  ${os.startsWith("{") ? "✅ JSON" : "❌ NOT JSON"}`);
  console.log(`\n${o.startsWith("{")
    ? "Both forms serialize; the object form is safe and the harness's existing config.settings path is fine."
    : "The OBJECT form does not survive serialization — the design must pass a JSON string, and config/settings.ts's mergeAutoCompact currently hands the SDK an object, so every setting routed through it is silently dropped."}`);
  process.exit(0);
})();
