// appserver/schema/mcp.ts — M2b Wave 3: the MCP quintet's params. Verbatim from the task brief.
import { z } from "zod/v4";
export const mcpStatusParams = z.object({ threadId: z.string().min(1) });
export const mcpNameParams = z.object({ threadId: z.string().min(1), name: z.string().min(1) });
// Spec Wave 3's advisory warning, verbatim, so a generated JSON-schema consumer (Task 6) sees it too: a
// disabled server is not a security boundary — a model tool call can still resurrect it on demand.
export const mcpToggleParams = z.object({ threadId: z.string().min(1), name: z.string().min(1), enabled: z.boolean() })
  .describe("advisory, not a security boundary — a model tool call resurrects a disabled server; gate with permissions instead");
export const mcpSetParams = z.object({ threadId: z.string().min(1), servers: z.record(z.string(), z.unknown()) });
// `mode` is REQUIRED-but-nullable, mirroring rewindParams's `prevUuid`: null clears an existing pin
// (probe 49's rules-layer override), and a client that simply omitted the field must not be read as
// asserting that.
export const mcpOverrideParams = z.object({ threadId: z.string().min(1), name: z.string().min(1), mode: z.string().nullable() });
