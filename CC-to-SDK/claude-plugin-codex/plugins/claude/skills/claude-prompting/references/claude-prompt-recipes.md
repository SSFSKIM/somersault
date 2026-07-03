# Claude Prompt Recipes

Starting templates for `rescue` prompts. Copy the smallest recipe that fits, trim what you don't need, and
write it as plain prose — Claude doesn't need XML block scaffolding for the instructions themselves (see
SKILL.md). Default to write-capable (`write` unset) unless the user asked for read-only.

## Diagnosis

Goal: diagnose why `<symptom>` is happening in `<repo/area>`.
Deliverable: the most likely root cause, the evidence for it, and the smallest safe next step.
Guidance to include: keep investigating until you have enough evidence to be confident; don't guess at
missing repository facts — if something needed is genuinely absent, say exactly what's unknown instead of
filling the gap.

## Smallest safe fix

Goal: implement the smallest safe fix for `<issue>` in `<repo/area>`; preserve existing behavior everywhere
else.
Deliverable: a summary of the fix, the touched files, what verification was run (tests, build), and any
residual risk or follow-up.
Guidance to include: resolve the task fully — don't stop after identifying the cause without applying the
fix; keep the change tightly scoped, no unrelated refactors or cleanup; verify the fix actually matches the
requirement before reporting done.

## Focused review

Goal: review `<change/area>` for the most likely correctness or regression risks, using only the provided
repository context.
Deliverable: findings ordered by severity with supporting evidence, then brief next steps.
Guidance to include: ground every claim in the repo/tool output and label inferences as inferences; explicitly
check second-order failure modes (empty states, retries, stale state, rollback paths) before finalizing.
(Use the built-in `review` / `adversarial_review` tools instead of a hand-written prompt when the job is
literally "review my current diff" — they already carry this contract.)

## Avoid these

- **Vague framing** ("take a look and tell me what you think") — state the concrete task and deliverable
  instead.
- **No output contract** ("investigate and report back") — say exactly what shape the answer should take.
- **No follow-through default** ("debug this") — say whether the worker should keep going on its own or stop
  and ask when something material is missing.
- **Asking for more reasoning instead of a better contract** ("think harder") — tighten the verification and
  output requirements first; only raise `effort` once the prompt itself is as specific as it can be.
- **Mixing unrelated jobs in one call** ("review this, fix the bug, update the docs, suggest a roadmap") —
  split into separate `rescue`/`review` calls instead.
- **Unsupported certainty** ("tell me exactly why production failed") — ask for claims grounded in evidence,
  with inferences labeled as such.
