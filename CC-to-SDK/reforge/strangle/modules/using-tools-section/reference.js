// PARITY LAYER (§2.5 `reference`) — the "# Using your tools" section of the
// default system prompt (upstream `M8t`, 2.1.251, chunk-fy12d89p).
//
// The only one of the six sections that READS THE SESSION: which tools the model
// actually has decides which shell it is told to avoid, which search tools it is
// told to prefer, and which task tool it is told to plan with. That is why this
// module has nine `primitive` captures — the tool NAMES — and why §2.4's
// equality assertion on each of them earns its keep here more than anywhere else
// in the manifest: a tool renamed upstream moves no anchor, no target hash and no
// capture hash, and the adapter's per-delegation comparison is the only thing
// that would see it.
//
// TWO ARMS, AND THE CORPUS RENDERS ONE. In the interactive REPL the section
// collapses to a single task-tool bullet — and to the EMPTY STRING when no task
// tool is present, which is the only place in the prompt pipeline where a
// section builder returns "" rather than null. Headless takes the full arm.
// Both are graded by `strangle/prompt-parity.test.ts` over the cross-product of
// task tool x shell x search availability.
//
// THE HEADING OCCURS TWICE IN THIS BODY, once per arm, which is why the row is
// anchored on the parallel-tool-calls sentence instead: `selectExcision` counts
// CANDIDATES rather than spans, so two occurrences inside one node read as a tie
// and refuse (C6's recorded mechanism note). The shorter form of that sentence
// also occurs twice, so the anchor is the long one.
import { bulletLines } from "../shared/prompt-bullets.js";

/** The task tools, in upstream's preference order. */
export const TASK_CREATE_TOOL = "TaskCreate";
export const TODO_WRITE_TOOL = "TodoWrite";
/** The two shells; the second is the fallback when Bash is not in the catalog. */
export const BASH_TOOL = "Bash";
export const POWERSHELL_TOOL = "PowerShell";
/** The file tools, always named as preferable to a shell. */
export const READ_TOOL = "Read";
export const EDIT_TOOL = "Edit";
export const WRITE_TOOL = "Write";
/** The search tools, named only when the search-tool path is NOT available with Bash. */
export const GLOB_TOOL = "Glob";
export const GREP_TOOL = "Grep";

const PARALLEL_TOOL_CALLS = "You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them, make all independent tool calls in parallel. Maximize use of parallel tool calls where possible to increase efficiency. However, if some tool calls depend on previous calls to inform dependent values, do NOT call these tools in parallel and instead call them sequentially. For instance, if one operation must complete before another starts, run these operations sequentially instead.";

const replTaskBullet = (tool) => "Break down and manage your work with the " + tool + " tool. These tools are helpful for planning your work and helping the user track your progress. Mark each task as completed as soon as you are done with the task. Do not batch up multiple tasks before marking them as completed.";
const preferBullet = (shell, tools) => "Prefer dedicated tools over " + shell + " when one fits (" + tools + ") — reserve " + shell + " for shell-only operations.";
const planBullet = (tool) => "Use " + tool + " to plan and track work. Mark each task completed as soon as it's done; don't batch.";

/**
 * @param {Set<string>} toolNames             the session's tool catalog
 * @param {() => boolean} isRepl              upstream's REPL predicate
 * @param {() => boolean} searchToolsEnabled  upstream's search-tool predicate
 */
export function usingToolsSection(toolNames, isRepl, searchToolsEnabled) {
  const taskTool = [TASK_CREATE_TOOL, TODO_WRITE_TOOL].find((name) => toolNames.has(name));
  if (isRepl()) {
    const items = [taskTool ? replTaskBullet(taskTool) : null].filter((item) => item !== null);
    // The one section builder that answers with an empty string rather than null.
    if (items.length === 0) return "";
    return ["# Using your tools", ...bulletLines(items)].join("\n");
  }
  const searchEnabled = searchToolsEnabled();
  const hasBash = toolNames.has(BASH_TOOL);
  const shell = hasBash ? BASH_TOOL : POWERSHELL_TOOL;
  const preferred = [READ_TOOL, EDIT_TOOL, WRITE_TOOL, ...(searchEnabled && hasBash ? [] : [GLOB_TOOL, GREP_TOOL])].join(", ");
  const items = [
    preferBullet(shell, preferred),
    taskTool ? planBullet(taskTool) : null,
    PARALLEL_TOOL_CALLS,
  ].filter((item) => item !== null);
  return ["# Using your tools", ...bulletLines(items)].join("\n");
}
