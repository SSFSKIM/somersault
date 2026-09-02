// SABOTAGE LAYER (§2.5). `sysprompt-preset` MUST go red with this built.
export const TASK_CREATE_TOOL = "TaskCreate";
export const TODO_WRITE_TOOL = "TodoWrite";
export const BASH_TOOL = "Bash";
export const POWERSHELL_TOOL = "PowerShell";
export const READ_TOOL = "Read";
export const EDIT_TOOL = "Edit";
export const WRITE_TOOL = "Write";
export const GLOB_TOOL = "Glob";
export const GREP_TOOL = "Grep";

export function usingToolsSection() {
  return "# Using your tools";
}
