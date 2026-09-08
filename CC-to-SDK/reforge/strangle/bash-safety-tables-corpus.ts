// The shared input corpus for C13b's Bash safety-table parity and coverage lanes.
//
// `bash-safety-tables.test.ts` compares every callable invocation here against
// the pinned 2.1.251 bytes. `bash-safety-tables-coverage.ts` executes the same
// invocations against the instrumented owned module so attestation can measure
// which branches that differential contract grades. The driver must not carry
// private inputs: add a branch-reaching invocation here so parity and coverage
// widen together.

export type TableName =
  | "pL"
  | "Pnn"
  | "DP"
  | "xnn"
  | "u8e"
  | "l_e"
  | "Bnn"
  | "oro"
  | "Ern"
  | "Crn"
  | "Arn";

export const TABLE_NAMES: readonly TableName[] = [
  "pL",
  "Pnn",
  "DP",
  "xnn",
  "u8e",
  "l_e",
  "Bnn",
  "oro",
  "Ern",
  "Crn",
  "Arn",
];

/** The dependency result exercised by the pinned-byte parity suite. */
export const BASH_TABLE_HOME = "/home/reforge";

export interface InvocationCase {
  label: string;
  args: unknown[];
  /** The live result returned by the injected sed read-only classifier. */
  sed?: boolean;
}

const pathCases: InvocationCase[] = [
  { label: "empty", args: ["command", []] },
  { label: "plain operand", args: ["command", ["operand"]] },
  { label: "double dash", args: ["command", ["--", "operand"]] },
  { label: "long equals", args: ["command", ["--format=%G?", "operand"]] },
  { label: "custom pretty", args: ["command", ["--pretty=custom"]] },
  { label: "shell placeholder", args: ["command", ["__CMDSUB_OUTPUT__"]] },
  { label: "tracked placeholder", args: ["command", ["__TRACKED_VAR__"]] },
  { label: "url", args: ["command", ["https://example.test/owner/repo"]] },
  { label: "github shorthand", args: ["command", ["owner/repo"]] },
  { label: "at target", args: ["command", ["owner@example.test"]] },
  { label: "watch", args: ["command", ["--watch"]] },
  {
    label: "docker connection flag",
    args: ["command", ["--host=tcp://example.test"]],
  },
  { label: "short cluster", args: ["command", ["-abc"]] },
  { label: "date expression", args: ["command", ["-d", "yesterday", "+%F"]] },
  { label: "lsof host", args: ["command", ["-iTCP@host"]] },
  { label: "tput reset", args: ["command", ["reset"]] },
  { label: "numeric test", args: ["command", ["1", "-eq", "2"]] },
  {
    label: "sed read-only",
    args: ["sed -n 1p file", ["-n", "1p", "file"]],
    sed: true,
  },
  {
    label: "sed write",
    args: ["sed -i s/a/b/ file", ["-i", "s/a/b/", "file"]],
    sed: false,
  },
];

const fileCases: InvocationCase[] = [
  { label: "empty", args: [[]] },
  { label: "operand", args: [["file"]] },
  { label: "flag then operand", args: [["-n", "file"]] },
  { label: "double dash", args: [["--", "-file"]] },
  { label: "two operands", args: [["from", "to"]] },
  {
    label: "find reference",
    args: [["src", "-newer", "stamp", "-name", "*.ts"]],
  },
  { label: "awk source", args: [["-e", "{print}", "input"]] },
  { label: "awk file", args: [["-f", "program.awk", "input"]] },
  { label: "grep recursive", args: [["-R", "pattern"]] },
  { label: "grep file pattern", args: [["-fpatterns", "input"]] },
  { label: "sed expression", args: [["-e", "s/a/b/", "input"]] },
  { label: "jq files", args: [["--arg", "name", "value", ".", "input.json"]] },
  { label: "git no-index", args: [["diff", "--no-index", "left", "right"]] },
];

const safetyCases: InvocationCase[] = [
  { label: "empty", args: [[]] },
  { label: "plain", args: [["file"]] },
  { label: "flag", args: [["-f", "file"]] },
  { label: "double dash", args: [["--", "file"]] },
  { label: "two operands", args: [["old", "new"]] },
];

const wrapperCases: InvocationCase[] = [
  { label: "zero", args: ["0"] },
  { label: "decimal", args: ["42"] },
  { label: "hex", args: ["0x2a"] },
  { label: "word", args: ["cpu"] },
  { label: "path", args: ["/tmp/lock"] },
];

export function casesFor(table: TableName): InvocationCase[] {
  if (table === "pL") return fileCases;
  if (table === "xnn") return safetyCases;
  if (table === "Arn") return wrapperCases;
  return pathCases;
}
