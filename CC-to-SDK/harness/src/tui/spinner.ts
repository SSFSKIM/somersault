// tui/src/spinner.ts — pure spinner vocabulary + formatters for the live-turn indicator. CC fidelity:
// the asterisk-pulse frames (components/Spinner/utils.ts getDefaultCharacters, darwin variant) animated
// out-and-back, and the 187 random thinking verbs verbatim from constants/spinnerVerbs.ts. The status tail
// mirrors SpinnerAnimationRow.tsx's "(elapsed · esc to interrupt)" affordance. No React/Ink — view layer is Spinner.tsx.

/** The darwin asterisk-pulse base chars; the live cycle pulses out then back (CC: [...chars, ...reversed]). */
export const SPINNER_BASE = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
export const SPINNER_FRAMES: readonly string[] = [...SPINNER_BASE, ...[...SPINNER_BASE].reverse()];

/** Frame for an animation tick (wraps; negative-safe). */
export function glyphFrame(tick: number): string {
  const n = SPINNER_FRAMES.length;
  return SPINNER_FRAMES[(((tick % n) + n) % n)];
}

/** The 187 CC thinking verbs (verbatim). */
export const SPINNER_VERBS: readonly string[] = [
  "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming",
  "Beboppin'", "Befuddling", "Billowing", "Blanching", "Bloviating", "Boogieing",
  "Boondoggling", "Booping", "Bootstrapping", "Brewing", "Bunning", "Burrowing",
  "Calculating", "Canoodling", "Caramelizing", "Cascading", "Catapulting", "Cerebrating",
  "Channeling", "Channelling", "Choreographing", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Combobulating", "Composing", "Computing", "Concocting", "Considering",
  "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
  "Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating",
  "Doing", "Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating",
  "Embellishing", "Enchanting", "Envisioning", "Evaporating", "Fermenting", "Fiddle-faddling",
  "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing", "Fluttering",
  "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping",
  "Garnishing", "Generating", "Gesticulating", "Germinating", "Gitifying", "Grooving",
  "Gusting", "Harmonizing", "Hashing", "Hatching", "Herding", "Honking",
  "Hullaballooing", "Hyperspacing", "Ideating", "Imagining", "Improvising", "Incubating",
  "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning", "Kneading",
  "Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering",
  "Metamorphosing", "Misting", "Moonwalking", "Moseying", "Mulling", "Mustering",
  "Musing", "Nebulizing", "Nesting", "Newspapering", "Noodling", "Nucleating",
  "Orbiting", "Orchestrating", "Osmosing", "Perambulating", "Percolating", "Perusing",
  "Philosophising", "Photosynthesizing", "Pollinating", "Pondering", "Pontificating", "Pouncing",
  "Precipitating", "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering",
  "Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating",
  "Roosting", "Ruminating", "Sautéing", "Scampering", "Schlepping", "Scurrying",
  "Seasoning", "Shenaniganing", "Shimmying", "Simmering", "Skedaddling", "Sketching",
  "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning", "Sprouting",
  "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing",
  "Tempering", "Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying",
  "Transfiguring", "Transmuting", "Twisting", "Undulating", "Unfurling", "Unravelling",
  "Vibing", "Waddling", "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling",
  "Whirring", "Whisking", "Wibbling", "Working", "Wrangling", "Zesting",
  "Zigzagging",
];

/** Pick a verb from a [0,1) random value (default Math.random; injectable for tests). */
export function pickVerb(rand: number = Math.random()): string {
  const i = Math.min(SPINNER_VERBS.length - 1, Math.max(0, Math.floor(rand * SPINNER_VERBS.length)));
  return SPINNER_VERBS[i];
}

/** "3s" under a minute, else "1m 05s".
 *
 *  KNOWN DEFECT, recorded W-S t7 (correction pass) and deliberately NOT fixed there — it is out of that
 *  task's scope, and it is a shipped surface, so it is written down rather than left to be rediscovered.
 *  This is our port of upstream `$st` (`cli.pretty.js` L107079, exported as `formatBarElapsed` at L107029),
 *  and it diverges in two ways:
 *    1. Separator. Upstream emits `1m05s` — no space. We emit `1m 05s`. (Do not "fix" this by pointing at
 *       `format.ts`'s `formatDuration`: that is a port of a DIFFERENT function, `ra`, which spells the same
 *       duration `1m 5s` — unpadded and spaced. Three spellings exist upstream; this one owes `$st`.)
 *    2. Missing units. Upstream rolls over at an hour (`1h05m`) and a day (`2d03h`); we stop at minutes, so
 *       a session running 25 hours and 1 second reads `1501m 01s` instead of `1d01h`.
 *  Whoever next touches the spinner tail should port `$st` whole rather than patching one branch. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + "s";
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
}

/** The dim status tail: "(3s · 142 tokens · esc to interrupt)" — tokens shown only once > 0. */
export function spinnerStatus(elapsedMs: number, tokens = 0): string {
  const parts = [formatElapsed(elapsedMs), ...(tokens > 0 ? [`${tokens} tokens`] : []), "esc to interrupt"];
  return "(" + parts.join(" · ") + ")";
}
