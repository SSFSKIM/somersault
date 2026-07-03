import type { OpenFn, OpenCtx } from "./handlers.js";

/** Scripted, key-free session used ONLY when CC_APPSERVER_FAKE==="1" (bin/contract tests). When the prompt
 *  says USE_TOOL and a dynamic-tool broker is present, it drives one item/tool/call round-trip (exercising the
 *  server→client broker path without the SDK), then folds the client's reply into the final text. */
let fakeN = 0;
export const fakeOpen: OpenFn = (_cfg: any, ctx: OpenCtx) => ({
  sessionId: `sdk_fake_${++fakeN}`,
  submit: async (prompt: string, onMessage: (m: any) => void) => {
    // Resume path: echo cfg.resume as the first streamed text so contract tests can assert the
    // server actually reopened with the sidecar's prior sessionId (no real SDK session to inspect).
    onMessage({ type: "assistant", message: { content: [{ type: "text", text: _cfg?.resume ? `resumed:${_cfg.resume}` : "thinking" }] } });
    if (prompt.includes("USE_TOOL") && ctx.broker) {
      const r = await ctx.broker.call("linear_graphql", { query: "query { viewer { id } }" });
      const text = (r.contentItems ?? []).map((c) => c?.text ?? "").join("") || r.output || "";
      return { result: `tool said: ${text}` };
    }
    return { result: "final text" };
  },
  usage: async () => ({}),
  dispose: async () => {},
} as any);
