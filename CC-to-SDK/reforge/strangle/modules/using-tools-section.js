// ADAPTER — the graph-facing seam for the "# Using your tools" section.
//
// Delegation signature:
//   usingToolsSection(toolNames,
//                     taskCreateTool, todoWriteTool, bashTool, powershellTool,
//                     readTool, editTool, writeTool, globTool, grepTool,
//                     isRepl, searchToolsEnabled)
//
// NINE `primitive` captures — the highest primitive yield in the manifest, and
// the row where §2.4's per-delegation assertion matters most. These are TOOL
// NAMES: rename one upstream and no anchor moves, no target hash moves and no
// capture hash moves, because the capture is derived by shape. The nine
// comparisons below are the only thing in the campaign that would notice, and
// they run on every single request.
//
// Two `effectful-port` captures are called rather than compared: the REPL
// predicate that selects the short arm, and the search-tool predicate that
// decides whether Glob and Grep are named.
import { assertGraphValue } from "./shared/assert.js";
import {
  BASH_TOOL,
  EDIT_TOOL,
  GLOB_TOOL,
  GREP_TOOL,
  POWERSHELL_TOOL,
  READ_TOOL,
  TASK_CREATE_TOOL,
  TODO_WRITE_TOOL,
  WRITE_TOOL,
  usingToolsSection,
} from "./using-tools-section/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  usingToolsSection(
    toolNames,
    taskCreateTool,
    todoWriteTool,
    bashTool,
    powershellTool,
    readTool,
    editTool,
    writeTool,
    globTool,
    grepTool,
    isRepl,
    searchToolsEnabled,
  ) {
    assertGraphValue("using-tools-section", "taskCreateTool", taskCreateTool, TASK_CREATE_TOOL);
    assertGraphValue("using-tools-section", "todoWriteTool", todoWriteTool, TODO_WRITE_TOOL);
    assertGraphValue("using-tools-section", "bashTool", bashTool, BASH_TOOL);
    assertGraphValue("using-tools-section", "powershellTool", powershellTool, POWERSHELL_TOOL);
    assertGraphValue("using-tools-section", "readTool", readTool, READ_TOOL);
    assertGraphValue("using-tools-section", "editTool", editTool, EDIT_TOOL);
    assertGraphValue("using-tools-section", "writeTool", writeTool, WRITE_TOOL);
    assertGraphValue("using-tools-section", "globTool", globTool, GLOB_TOOL);
    assertGraphValue("using-tools-section", "grepTool", grepTool, GREP_TOOL);
    return usingToolsSection(toolNames, isRepl, searchToolsEnabled);
  },
});
