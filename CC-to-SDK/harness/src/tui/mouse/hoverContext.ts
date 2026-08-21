// tui/mouse/hoverContext.ts — F9 T-MOUSE Task 3: canon's `Ssi` boolean context (bundle L203979/L203997,
// R1 §2.3), the mechanism half of hover-brighten. Canon reads it through a hit-tested layout tree
// (`DUr`/`kCP`) that ccx does not have (R1's structural premise for the whole track); the OBSERVABLE
// behaviour it exists to reproduce is unchanged — every dimmed `<Text>` inside a hovered row's subtree
// renders at full colour — so it is ported here as an ordinary React context instead: `Line.tsx` (the one
// choke point every `RenderLine`/`Segment` passes through, F1 Task 4) reads it to drop `dimColor` and swap
// the `userMessageBackground` band for its hover twin; `FullscreenViewport` provides `true` around exactly
// the slice whose `itemKey` the pointer is over.
//   `false` with NO PROVIDER ABOVE is canon's own default too (`useContext(Ssi)` unprovided answers `false`,
// L203997) — every dialog, the markdown renderer, and any OTHER consumer of `Line` outside a hovered
// transcript row-cluster gets the ordinary dim/band it always got.
import { createContext } from "react";

export const HoverContext = createContext<boolean>(false);
