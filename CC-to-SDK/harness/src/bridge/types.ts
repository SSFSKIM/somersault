import { z } from "zod/v4";

/** A live session the bridge can control. The control methods are optional → the bridge feature-detects
 *  and reports `unsupported` for any the session does not provide (fake/partial sessions, SDK drift). */
export interface ControllableSession {
  setModel?(model?: string): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setMaxThinkingTokens?(maxTokens: number | null): Promise<void>;
  interrupt?(): Promise<unknown>;                 // 0.3.211: resolves with a receipt ({ still_queued })
  getContextUsage?(): Promise<unknown>;
  accountInfo?(): Promise<unknown>;
  reinitialize?(): Promise<unknown>;              // fresh init payload from the running CLI (probe 38)
  listBackgroundTasks?(): Promise<unknown>;       // live background-task set (probe 39)
  stopTask?(taskId: string): Promise<void>;
  backgroundAll?(toolUseId?: string): Promise<boolean>; // Ctrl+B
  capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
}

// Full SDK PermissionMode (sdk.d.ts:2055); the bridge translates faithfully and does not restrict the set.
const permissionMode = z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"]);

export const controlFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("initialize") }),
  z.object({ type: z.literal("set_model"), model: z.string().optional() }),
  z.object({ type: z.literal("set_permission_mode"), mode: permissionMode }),
  z.object({ type: z.literal("set_thinking"), maxTokens: z.number().nullable() }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("context_usage") }),
  z.object({ type: z.literal("account_info") }),
  z.object({ type: z.literal("reinitialize") }),
  z.object({ type: z.literal("background_tasks") }),
  z.object({ type: z.literal("stop_task"), taskId: z.string() }),
  z.object({ type: z.literal("background_all"), toolUseId: z.string().optional() }),
]);
export type ControlFrame = z.infer<typeof controlFrame>;

export type ControlResponse = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };
