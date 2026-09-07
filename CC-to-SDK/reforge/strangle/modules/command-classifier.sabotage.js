// Liveness twin: invert the classifier's result class while preserving shape.
import { PARSE_ABORTED } from "./shell-parser/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { createCommandClassifier } from "./command-classifier/reference.js";

const classify = createCommandClassifier(() => false);

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifyBashCommand(command, parsed, graphParseAborted) {
    assertGraphValue("command-classifier", "parseAborted", graphParseAborted, PARSE_ABORTED);
    const healthy = classify(command, parsed);
    return healthy.kind === "simple"
      ? { kind: "too-complex", reason: "C13b classifier liveness twin" }
      : { kind: "simple", commands: [], bareAssignmentNames: [] };
  },
});
