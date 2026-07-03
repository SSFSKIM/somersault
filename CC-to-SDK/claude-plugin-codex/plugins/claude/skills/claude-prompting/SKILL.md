---
name: claude-prompting
description: How to write effective prompts for Claude workers dispatched via claude-companion — structure, grounding, and output contracts for Claude models (opus/sonnet/haiku/fable).
---

# Prompting Claude workers

Claude responds best to plain, well-scoped prose with explicit success criteria. Unlike GPT-style block
prompting, XML tag scaffolding is optional — use it to delimit large pasted inputs (diffs, logs, stack
traces), not to structure the instructions themselves.

- Lead with the goal in one sentence, then constraints, then context.
- State the deliverable explicitly ("produce a minimal patch", "return a ranked list of causes").
- For investigation tasks: name the observable symptom, where it manifests, and what "explained" looks like.
- For fixes: define the smallest acceptable change and what must NOT change; ask for verification (run the
  tests) and to report what was run.
- For structured output: show the exact shape you want and say "output strictly that shape, no prose before
  or after it."
- Give repo-relative paths; the worker starts in the workspace you pass as `cwd` and has full repo access
  there.
- Do not stack roleplay or persona framing; a single role sentence ("You are a senior reviewer") is enough.
- Say explicitly whether the worker may edit files. `rescue` defaults to write-capable; call it out anyway
  when the user only wants investigation, since a written prompt beats relying on `write:false` alone to
  convey intent.

See [references/claude-prompt-recipes.md](references/claude-prompt-recipes.md) for ready-made diagnosis,
fix, and review prompt shapes.
