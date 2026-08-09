// tui/test/notification-slot.test.tsx — Wave C Task 1 (EP-C1a), the rendering half. `notifications.test.ts`
// pins the queue; this pins the ONE row the queue's `current` occupies.
//
// Geometry owed to annex §C1.1/§C1.6: `zRr`'s inner box is
// `flexDirection:"row", justifyContent:"flex-end", alignItems:"flex-end"` (L489353) and every hint is
// `wrap="truncate"` (`$Rr`, L488834), with plain text rendering DIM unless it carries a colour. The absolute
// positioning above the composer (`position:"absolute", marginTop:-1`, height collapsing to 0) belongs to the
// MOUNT SITE, not to this component — Task 2 owns that. Here the slot is wrapped in a fixed-width column Box
// so the flex cross-axis stretch gives it a known width to right-align and truncate against.
import { describe, it, expect } from "vitest";
import React from "react";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { NotificationSlot } from "../../src/tui/NotificationSlot.js";
import type { CcxNotification } from "../../src/tui/notifications.js";

const strip = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
/** The slot inside a terminal of `width` columns — the shape the footer's right region gives it. */
function slot(notification: CcxNotification | null, width = 40) {
  return render(<Box width={width} flexDirection="column"><NotificationSlot notification={notification} /></Box>);
}

describe("NotificationSlot", () => {
  it("renders the current notification dim, right-flushed, on ONE row", () => {
    const { lastFrame } = slot({ key: "external-editor-hint", text: "ctrl+g to edit" });
    const raw = lastFrame() ?? "";
    expect(raw).toContain("\x1b[2mctrl+g to edit");                       // dimColor, `$Rr`'s no-colour arm
    const lines = strip(raw).split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);                                         // one row, never two
    expect(lines[0]!.startsWith(" ")).toBe(true);                         // padded on the LEFT…
    expect(lines[0]!.trimEnd().endsWith("ctrl+g to edit")).toBe(true);    // …because it is flushed right
    expect(lines[0]!.trimEnd().length).toBe(40);                          // flush against the right edge
  });

  it("renders nothing at all — zero height — with no current notification", () => {
    expect(strip(slot(null).lastFrame()).trim()).toBe("");
    expect(strip(slot(null).lastFrame()).split("\n").filter((l) => l.length > 0).length).toBe(0);
  });

  it("uses the notification's colour instead of dim when one is set", () => {
    const raw = slot({ key: "thinking-toggled-hotkey", text: "Thinking on", color: "red" }).lastFrame() ?? "";
    expect(raw).toContain("\x1b[31m");                                    // color="red"
    expect(raw).not.toContain("\x1b[2m");                                 // …and NOT dim
    expect(strip(raw)).toContain("Thinking on");
  });

  it("truncates at the available width rather than wrapping onto a second row", () => {
    const long = "a notification far too long to fit in this terminal at all";
    const lines = strip(slot({ key: "long", text: long }, 20).lastFrame()).split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);
    expect(lines[0]!.length).toBeLessThanOrEqual(20);
    expect(lines[0]!.trimEnd().endsWith("…")).toBe(true);                 // Ink's truncate ellipsis
  });

  it("renders a pre-built jsx node verbatim (the token-warning arm)", () => {
    const jsx = <Text color="red">62% until auto-compact</Text>;
    const raw = slot({ key: "token-warning", jsx, priority: "medium" }).lastFrame() ?? "";
    expect(strip(raw)).toContain("62% until auto-compact");
    expect(raw).toContain("\x1b[31m");
  });

  it("prefers jsx over text when an entry carries both", () => {
    const jsx = <Text>from the node</Text>;
    const out = strip(slot({ key: "both", jsx, text: "from the text" }).lastFrame());
    expect(out).toContain("from the node");
    expect(out).not.toContain("from the text");
  });
});
