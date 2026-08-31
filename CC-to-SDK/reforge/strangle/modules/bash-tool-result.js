// ADAPTER — the graph-facing seam for the Bash result formatter.
//
// Delegation signature:
//   bashToolResultBlock(output, toolUseId,
//                       previewBytes, newline, readToolName,
//                       backgroundOutputPath, taskAckEnvelope, taskAckEnding)
//
// The first three are §2.4 `primitive`s the module owns; the adapter's job with
// the graph's copies is to prove they still agree, on every delegation. The last
// three are typed ports, documented in the reference module's header.
import {
  bashToolResultBlock,
  NEWLINE,
  PREVIEW_BYTES,
  READ_TOOL_NAME,
} from "./bash-tool-result/reference.js";
import { assertGraphValue } from "./shared/assert.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  bashToolResultBlock(
    output,
    toolUseId,
    previewBytes,
    newline,
    readToolName,
    backgroundOutputPath,
    taskAckEnvelope,
    taskAckEnding,
  ) {
    assertGraphValue("bash-tool-result", "previewBytes", previewBytes, PREVIEW_BYTES);
    assertGraphValue("bash-tool-result", "newline", newline, NEWLINE);
    assertGraphValue("bash-tool-result", "readToolName", readToolName, READ_TOOL_NAME);
    return bashToolResultBlock(output, toolUseId, backgroundOutputPath, taskAckEnvelope, taskAckEnding);
  },
});
