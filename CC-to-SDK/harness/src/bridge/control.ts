import type { ControllableSession, ControlFrame, ControlResponse } from "./types.js";

/** Translate a control frame into a ControllableSession method call. Never throws — feature-detects the
 *  target method and converts both "missing method" and "method rejected" into a structured response. */
export class ControlBridge {
  static async apply(session: ControllableSession, frame: ControlFrame): Promise<ControlResponse> {
    switch (frame.type) {
      case "initialize":
        try { return { ok: true, ...(await session.capabilities()) }; }
        catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return { ok: false, error: message };
        }
      case "set_model":
        return ControlBridge.call(session.setModel, "setModel", session, frame.model);
      case "set_permission_mode":
        return ControlBridge.call(session.setPermissionMode, "setPermissionMode", session, frame.mode);
      case "set_thinking":
        return ControlBridge.call(session.setMaxThinkingTokens, "setMaxThinkingTokens", session, frame.maxTokens);
      case "interrupt":
        return ControlBridge.payload(session.interrupt, "interrupt", session, "receipt"); // 0.3.211 receipt (additive)
      case "context_usage":
        return ControlBridge.payload(session.getContextUsage, "getContextUsage", session, "usage");
      case "account_info":
        return ControlBridge.payload(session.accountInfo, "accountInfo", session, "account");
      case "reinitialize":
        return ControlBridge.payload(session.reinitialize, "reinitialize", session, "init");
      case "background_tasks":
        return ControlBridge.payload(session.listBackgroundTasks, "listBackgroundTasks", session, "tasks");
      case "stop_task":
        return ControlBridge.call(session.stopTask, "stopTask", session, frame.taskId);
      case "background_all":
        return ControlBridge.payload(session.backgroundAll, "backgroundAll", session, "backgrounded", frame.toolUseId);
    }
  }

  private static async call(
    method: ((...args: any[]) => Promise<void>) | undefined,
    name: string,
    self: ControllableSession,
    ...args: unknown[]
  ): Promise<ControlResponse> {
    if (typeof method !== "function") return { ok: false, error: `unsupported: ${name}` };
    try { await method.apply(self, args); return { ok: true }; }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  }

  // Like call(), but the method returns a value surfaced under `key` (mirrors the initialize payload).
  private static async payload(
    method: ((...args: any[]) => Promise<unknown>) | undefined,
    name: string,
    self: ControllableSession,
    key: string,
    ...args: unknown[]
  ): Promise<ControlResponse> {
    if (typeof method !== "function") return { ok: false, error: `unsupported: ${name}` };
    try { return { ok: true, [key]: await method.apply(self, args) }; }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  }
}
