// ADAPTER — the graph-facing seam for the "# Tone and style" section.
//
// Delegation signature:
//   toneAndStyleSection()
//
// No forwarded captures: the only free variable upstream has is the bullet
// formatter, which is a `pure-helper` the owned module ships itself.
import { toneAndStyleSection } from "./tone-and-style-section/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  toneAndStyleSection() {
    return toneAndStyleSection();
  },
});
