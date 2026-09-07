// Graph adapter for C13b's pinned KTe command classifier.
//
// The scrub gate is pinned false in every reforge engine by X6: the variable
// that could enable it is forbidden because upstream also changes permission
// mode when it is set. The reference factory still grades both gate states in
// classifier-parity.test.ts; this graph wiring selects the pinned state.
import { PARSE_ABORTED } from "./shell-parser/reference.js";
import { assertGraphValue } from "./shared/assert.js";
import { createCommandClassifier } from "./command-classifier/reference.js";

const classify = createCommandClassifier(() => false);

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifyBashCommand(command, parsed, graphParseAborted) {
    assertGraphValue("command-classifier", "parseAborted", graphParseAborted, PARSE_ABORTED);
    return classify(command, parsed);
  },
});
