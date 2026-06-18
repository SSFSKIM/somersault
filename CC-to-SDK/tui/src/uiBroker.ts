// tui/src/uiBroker.ts — a PermissionBroker whose request() is fulfilled by a late-bound handler (the React
// layer). Before a handler is set (or after teardown), requests deny — never hang.
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "cc-harness";

export interface UiBrokerHandle {
  broker: PermissionBroker;
  setHandler(h: ((req: PermissionRequest) => Promise<PermissionDecision>) | null): void;
}

export function createUiBroker(): UiBrokerHandle {
  let handler: ((req: PermissionRequest) => Promise<PermissionDecision>) | null = null;
  return {
    broker: { request(req) { return handler ? handler(req) : Promise.resolve({ kind: "deny" } as PermissionDecision); } },
    setHandler(h) { handler = h; },
  };
}
