// SABOTAGE wiring — `sysprompt-preset` MUST go red with this built.
//
// The nine primitive assertions stay live for the same reason the identity
// row's two do: a twin that also broke them would fail at the adapter and prove
// the assertion rather than the coverage.
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
} from "./using-tools-section/sabotage.js";

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
    return usingToolsSection();
  },
});
