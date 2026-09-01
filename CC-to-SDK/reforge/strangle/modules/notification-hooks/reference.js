// PARITY LAYER (§2.5 `reference`) — the Notification hook dispatcher
// (upstream `EE` / `executeNotificationHooks`, 2.1.251, chunk-fy12d89p).
//
// The smallest dispatcher in the family, and the only one that RETURNS NOTHING
// AT ALL. Every sibling either streams its results to a caller that folds them
// into the conversation or awaits them and does something with them — a drain to
// stderr, a display line, a verdict. This one awaits the executor and DISCARDS
// the results: a notification is an announcement, so running the hooks IS the
// whole effect and there is no arm in which a hook's output changes anything.
//
// Two more things it does not share with its siblings:
//
//   `matchQuery` is the NOTIFICATION TYPE. A matcher on this event selects a
//       KIND of notification, where every other event matches a tool name, a
//       trigger, an end reason or a load reason. The type is also the only field
//       of the record that is re-read after being written into it.
//   there is NO `signal`. The executor request has no cancellation slot at all,
//       so a notification's hooks cannot be aborted by the turn that raised it —
//       the one dispatcher of the family called without one.
//
// The options bag is optional and so is every key in it: called with nothing,
// `timeoutMs` falls to `Li` and the storage and credential slots destructure to
// `undefined`, which is what a call site that only wants the announcement passes.
//
// WHAT GRADES IT. Nothing on the corpus can: the event fired in no phase of
// `w5/probe-hook-events.ts`, and `EE` hands the executor no session hooks
// registry, so no SDK callback could observe it however the condition were
// created. The parity oracle is the whole of its evidence — which is exactly the
// case §2.5 wants a `reference` for.
//
// Ports (nothing behind them is owned by this wave):
//   createBaseHookInput(session, cwd)  the common prefix (two arguments).
//   cwd() -> string                    the working directory.
//   executeHooksAwait(request) -> results[]   the AWAITING executor (upstream
//       `AE`), whose return value this dispatcher throws away. Unowned, and a
//       ledger edge to whichever wave takes it.
//   defaultHookTimeoutMs -> 600000     upstream's `Li`, the destructure's
//       `timeoutMs` default (§2.4 `primitive`).

/** Upstream `Li` — the hook execution timeout, in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 600000;

export async function notificationHooks(
  session,
  notification,
  { timeoutMs = DEFAULT_HOOK_TIMEOUT_MS, storageV5, credentials } = {},
  createBaseHookInput,
  cwd,
  executeHooksAwait,
) {
  const { message, title, notificationType } = notification;
  const hookInput = {
    ...createBaseHookInput(session, cwd()),
    hook_event_name: "Notification",
    message,
    title,
    notification_type: notificationType,
  };
  await executeHooksAwait({
    session,
    hookInput,
    timeoutMs,
    matchQuery: notificationType,
    storageV5,
    credentials,
  });
}
