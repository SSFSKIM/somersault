// tui/src/osc8.ts — the ONE place the OSC-8 hyperlink byte shape is spelled out. A leaf module (no imports,
// so it can never join an import cycle): `sgrFoldRow.ts` (the fold-row SGR writer) and `toolRenderer.tsx`
// (`osc8FileLink` / `osc8WebLink`) both build their hyperlink bytes from these two exports instead of each
// carrying its own copy of the escape shape. BEL terminator (`\x07`), matching what 2.1.220 emits and what
// every terminal this project targets accepts.
//
// Deliberately NOT reused by the tests that pin these byte sequences: a test importing the production
// constant to check the production constant proves nothing. The covering tests (toolFold, sgrFoldRow,
// toolRenderer, fullscreen-osc8, fullscreen-prlink) hardcode the literal escape bytes on purpose, so a
// regression in this module's shape still fails them independently.
export const osc8Open = (href: string): string => "\x1b]8;;" + href + "\x07";
export const OSC8_CLOSE = "\x1b]8;;\x07";
