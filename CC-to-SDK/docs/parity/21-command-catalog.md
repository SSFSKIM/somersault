# Parity — 21-command-catalog

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 21.1 | Built-in command catalog scope (~105 registry entries / ~179 command files) | ✅ provided | supportedCommands() enumerates the full built-in catalog present in the spawned CLI | Rather than re-implement, call supportedCommands() to get the live catalog; the per-group verdicts below classify which groups are usable vs gated. | P1 | doc | feb |
| 21.2 | Per-command prompt corpus (init / review / security-review / commit prompts) | ✅ provided | built-in prompt commands run inside the CLI when invoked; settingSources/plugins let users supply equivalent .claude/commands/*.md prompt files | Invoking /init, /review, /security-review through the spawned CLI runs the bundled prompts; custom equivalents go in .claude/commands or skills. | P1 | doc | feb |
