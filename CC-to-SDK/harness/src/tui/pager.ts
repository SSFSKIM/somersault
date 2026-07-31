// tui/src/pager.ts — pure scroll reducer for the transcript pager (Ctrl-O). Bindings are the 2.1.220
// bundle's Transcript context verbatim, plus the Scroll context's pageup/pagedown. Deliberate gaps,
// both recorded in docs/parity/tui-ux.md: ctrl+e (transcript:toggleShowAll) is deferred — our
// transcript has no collapsed variant to expand — and home/end never reach an Ink app as key flags
// (g/G are the equivalents). "exit" is returned for q/escape/ctrl+c; the component owns closing.
export interface PagerKey { upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; escape?: boolean; ctrl?: boolean }
export type PagerAction = { kind: "exit" } | { kind: "top" } | { kind: "bottom" } | { kind: "lines"; n: number } | { kind: "pages"; n: number };

export function pagerAction(input: string, key: PagerKey): PagerAction | null {
  if (key.escape) return { kind: "exit" };
  if (key.ctrl) {
    switch (input) {
      case "c": return { kind: "exit" };
      case "u": return { kind: "pages", n: -0.5 };
      case "d": return { kind: "pages", n: 0.5 };
      case "b": return { kind: "pages", n: -1 };
      case "f": return { kind: "pages", n: 1 };
      case "n": return { kind: "lines", n: 1 };
      case "p": return { kind: "lines", n: -1 };
      default: return null;
    }
  }
  if (key.upArrow) return { kind: "lines", n: -1 };
  if (key.downArrow) return { kind: "lines", n: 1 };
  if (key.pageUp) return { kind: "pages", n: -1 };
  if (key.pageDown) return { kind: "pages", n: 1 };
  if (input === "q") return { kind: "exit" };
  if (input === "j") return { kind: "lines", n: 1 };
  if (input === "k") return { kind: "lines", n: -1 };
  if (input === " ") return { kind: "pages", n: 1 };
  if (input === "b") return { kind: "pages", n: -1 };
  if (input === "g") return { kind: "top" };
  if (input === "G") return { kind: "bottom" };
  return null;
}

export function clampOffset(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, total - height)));
}
export function applyPager(offset: number, a: PagerAction, total: number, height: number): number {
  if (a.kind === "top") return 0;
  if (a.kind === "bottom") return Math.max(0, total - height);
  if (a.kind === "lines") return clampOffset(offset + a.n, total, height);
  if (a.kind === "pages") return clampOffset(offset + Math.round(a.n * height), total, height);
  return offset;
}
