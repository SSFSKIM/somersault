// Shared input fixtures for C13b's command-classifier differential contract
// and its instrumented coverage driver. An input executed by only the driver
// could earn `contract` coverage without ever being compared to pinned bytes,
// so every classifier-specific input shared with that driver lives here.

export interface ClassifierShellNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  children: (ClassifierShellNode | null)[];
}

/** Ordered byte-level guards; overlapping cases also pin guard precedence. */
export const CLASSIFIER_GUARD_CASES: readonly (readonly [string, string])[] = [
  ["empty", ""],
  ["ASCII whitespace", " \t\n"],
  ["lone high surrogate", "echo " + String.fromCharCode(0xd800)],
  ["lone low surrogate", "echo " + String.fromCharCode(0xdc00)],
  ["control character", "echo " + String.fromCharCode(1)],
  ["Unicode no-break space", "echo" + String.fromCharCode(0xa0) + "x"],
  ["backslash escaped space", "echo a\\ b"],
  ["backslash continued line", "echo a\\" + "\n" + "b"],
  ["zsh dynamic directory", "echo ~[name]"],
  ["zsh equals expansion", "=git status"],
  ["zsh numeric range glob", "echo <1-9>"],
  ["brace carrying quote", 'echo {a"b,c}'],
  ["comment bytes are preserved", 'echo ok # {a"b,c}'],
  ["quoted brace is masked", 'echo "{a"'],
];

/** Commands classified with the subprocess-environment scrub gate enabled. */
export const SCRUB_ENABLED_CASES: readonly (readonly [string, string])[] = [
  ["for loop", 'for item in a b; do echo "$item"; done'],
  ["while loop", "while true; do echo x; done"],
  ["expanded command name", "$COMMAND arg"],
  ["quoted expanded command name", '"$COMMAND" arg'],
];

export interface MalformedRootCase {
  label: string;
  command: string;
  root: ClassifierShellNode;
}

/** Synthetic roots that select byte-coverage checks a real parser cannot emit. */
export const MALFORMED_ROOT_CASES: readonly MalformedRootCase[] = [
  {
    label: "skipped top-level bytes",
    command: "x echo hi",
    root: {
      type: "program",
      text: "x echo hi",
      startIndex: 0,
      endIndex: 9,
      children: [
        {
          type: "command",
          text: "echo hi",
          startIndex: 2,
          endIndex: 9,
          children: [],
        },
      ],
    },
  },
  {
    label: "trailing top-level bytes",
    command: "echo hi x",
    root: {
      type: "program",
      text: "echo hi x",
      startIndex: 0,
      endIndex: 9,
      children: [
        {
          type: "command",
          text: "echo hi",
          startIndex: 0,
          endIndex: 7,
          children: [],
        },
      ],
    },
  },
];

export interface SentinelIdentityCase {
  label: string;
  command: string;
  input: "canonical" | "same-description";
}

/** Identity cases; each consumer supplies its own canonical sentinel instance. */
export const SENTINEL_IDENTITY_CASES: readonly SentinelIdentityCase[] = [
  {
    label: "each side recognises its own identity",
    command: "echo ok",
    input: "canonical",
  },
  {
    label: "fresh symbols are not mistaken for the sentinel",
    command: "echo ok",
    input: "same-description",
  },
];
