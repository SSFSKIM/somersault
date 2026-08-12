// tui/paletteSlot.tsx — D10's plumbing: the ONE seam that lets the composer's suggestion popup paint in a band
// the composer does not own (FSW Task 14).
//
// WHY A CONTEXT PAIR AND NOT A PROP. In fullscreen the palette belongs ABOVE the dock (grounding §4's D10 row;
// bundle `rCn` L456219-456226 is `position:absolute bottom:"100%" … opaque` — full cite below — mounted at L455945 as the FIRST
// child of the dock band `IDa` and therefore floating over the region, not inside the band). The element it
// paints is a function of the composer's own editor state — the matching list, the selected index, the catalog's
// name-column width — none of which leaves that component. Canon solves it with exactly this shape: a provider
// (`V0r`, L455235-455247) holding `[node, setNode]`, a publisher hook (`ZQo`, L455254) that pushes from an
// effect, and a consumer (`rCn`) that renders whatever is there.
//
// AND IT IS THE CHEAP SHAPE, which is the other half of the reason. Reporting the element up through a callback
// into ChatApp's own state would re-render the whole tree — the viewport included, on the one hot path this
// renderer has — for every keystroke that narrows a slash list. Here the setState lands on the HOST, whose
// `children` element is unchanged across it, so React re-renders the consumer and nothing else.
//
// WHAT `rCn` WRAPS ITS POPUP IN, cited in full (L456226): `position:"absolute", bottom:"100%", left:0, right:0,
// paddingX:2, paddingTop:1, flexDirection:"column", opaque:true` — and the popup itself takes `overlay:!0,
// noPad:!0`, which is what holds it to five rows with no blank padding (suggestPopup.tsx's `OVERLAY_ROWS`).
//   `paddingTop:1` IS THE ONE PIECE NOT REPRODUCED, deliberately, and it is a row rather than a detail. Canon's
// box is absolute, so its top padding is a blank line painted OVER the transcript at no cost to the layout;
// ours is in flow, so the same line would be a transcript row spent on a gap. `paddingX:2` is already inside
// the popup (`SuggestPopup`'s own Box, which the classic inline path shares), so the slot adds nothing at all
// and the palette's height is exactly the rows it drew. Recorded here rather than in a report, because the next
// reader comparing the two files will see one property missing and should not have to re-derive why.
//
// THE PUBLISH IS AN EFFECT, canon's own `useEffect(…, [set, node])`, so the palette lands one flush behind the
// keystroke that opened it. That is invisible next to Ink's 32 ms throttle, and it is NOT the report the frame's
// budget depends on: `onSuggestOpen` still rides `commitState` synchronously (ChatComposer's note), which is
// what widens the dock's cap in the same frame the popup appears in.
import React, { createContext, useContext, useEffect, useState } from "react";

const PaletteSet = createContext<((node: React.ReactNode) => void) | null>(null);
const PaletteValue = createContext<React.ReactNode>(null);

/** `V0r` (L455235). Wraps the tree that contains BOTH the publisher (the composer) and the slot. */
export function PaletteHost({ children }: { children: React.ReactNode }): React.ReactElement {
  const [node, setNode] = useState<React.ReactNode>(null);
  return <PaletteSet.Provider value={setNode}><PaletteValue.Provider value={node}>{children}</PaletteValue.Provider></PaletteSet.Provider>;
}

/** `ZQo` (L455254): publish `node` (or `null` to withdraw) for as long as this component is mounted. Outside a
 *  host it is inert, which is what keeps every bare-composer test and every classic mount unchanged. */
export function usePaletteHoist(node: React.ReactNode): void {
  const set = useContext(PaletteSet);
  useEffect(() => {
    if (!set) return;
    set(node);
    return () => set(null);
  }, [set, node]);
}

/** `rCn` (L456219). Renders whatever was published, and nothing — zero height — when nothing was. */
export function PaletteSlot(): React.ReactElement | null {
  const node = useContext(PaletteValue);
  return node ? <>{node}</> : null;
}
