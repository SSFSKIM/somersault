// Liveness twin: invert the classifier's result class while preserving shape.
import { createCommandClassifier } from "./command-classifier/reference.js";

const classify = createCommandClassifier(() => false);

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifyBashCommand(command, parsed) {
    const healthy = classify(command, parsed);
    return healthy.kind === "simple"
      ? { kind: "too-complex", reason: "C13b classifier liveness twin" }
      : { kind: "simple", commands: [], bareAssignmentNames: [] };
  },
});
