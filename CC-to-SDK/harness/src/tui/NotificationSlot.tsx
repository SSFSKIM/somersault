// tui/src/NotificationSlot.tsx — Wave C Task 1 (EP-C1a): the ONE row the notification queue's `current`
// occupies. Dumb by design — it takes the notification as a prop and does NOT subscribe to the store; `useChat`
// owns the single store instance and mirrors `current` into its own state, `ChatApp` passes it down.
//
// Geometry from annex §C1.1/§C1.6:
//  · `zRr`'s inner box (L489353) is `flexDirection:"row", justifyContent:"flex-end", alignItems:"flex-end",
//    flexShrink:0, overflowX:"hidden"` — that `justifyContent` is the right flush.
//  · `$Rr` (L488834) is the three-arm renderer: a `jsx` entry renders the node inside `<Text wrap="truncate">`;
//    otherwise `<Text color={color} dimColor={!color} wrap="truncate">{text}</Text>`, so a plain hint with no
//    colour of its own is DIM. (The `segments` arm is divergence 3 in notifications.ts — nothing mints one.)
//
// WHAT LIVES AT THE MOUNT SITE, NOT HERE (Task 2 owns it): the absolutely-positioned overlay row above the
// composer — `position:"absolute", marginTop:-1, width:"100%", paddingLeft:2, paddingRight:1,
// overflow:"hidden"`, its height collapsing to 0 when hidden (L496241). This component renders one row and
// nothing else, so it can also be dropped straight into the footer's right region (`Wtl`, L494681) unchanged.
//
// The width it right-aligns and truncates against comes from its parent: in a column flex container an
// auto-width child stretches to the container's width, which is what both mount shapes provide.
import React from "react";
import { Box, Text } from "ink";
import type { CcxNotification } from "./notifications.js";

export function NotificationSlot({ notification }: { notification: CcxNotification | null }) {
  if (!notification) return null;                                        // zero height, not an empty row
  const body = notification.jsx !== undefined
    ? <Text wrap="truncate">{notification.jsx as React.ReactNode}</Text>
    : <Text color={notification.color} dimColor={!notification.color} wrap="truncate">{notification.text}</Text>;
  return (
    <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" flexShrink={0}>
      {body}
    </Box>
  );
}
