# Parity — 11-tool-files

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 11.1 | Read text with line numbers | ✅ provided | Read tool (claude_code preset) — FileReadInput (sdk-tools.d.ts:527) | Bundled Read tool is identical; line-number formatting handled inside CC. | P1 | doc | feb |
| 11.2 | Read offset/limit windowing | ✅ provided | FileReadInput.offset, FileReadInput.limit (sdk-tools.d.ts:535,539) | Same params on the bundled Read tool. | P1 | doc | feb |
| 11.3 | Read images (png/jpg/gif/webp) | ✅ provided | Read tool (claude_code preset); image output type in result | Bundled Read handles image extensions natively; SDK receives image content blocks. | P1 | doc | feb |
| 11.4 | Read PDF (full + page range) | ✅ provided | FileReadInput.pages (sdk-tools.d.ts:543, 'Maximum 20 pages per request') | Bundled Read tool exposes `pages`; full-PDF support is model-gated (isPDFSupported) inside CC. | P1 | doc | feb |
| 11.5 | Read Jupyter notebook | ✅ provided | Read tool (claude_code preset) — notebook output type | Bundled Read tool reads notebooks; cell rendering internal to CC. | P1 | doc | feb |
| 11.6 | Read-before-edit cache enforcement | ✅ provided | Read/Edit/Write tools (claude_code preset) — FileStateCache internal | The cache lives in the spawned CC process and gates the bundled Edit/Write tools identically. | P1 | doc | feb |
| 11.7 | Read dedup of unchanged repeat reads | ✅ provided | Read tool (claude_code preset); killswitch via env | Internal optimization; toggle via the tengu_read_dedup_killswitch growthbook/env if needed. | P2 | inferred | feb |
| 11.8 | Write (create/overwrite full file) | ✅ provided | Write tool (claude_code preset) — FileWriteInput (sdk-tools.d.ts:545) | Bundled Write tool is identical. | P1 | doc | feb |
| 11.9 | Edit exact-string substitution | ✅ provided | Edit tool (claude_code preset) — FileEditInput.old_string/new_string (sdk-tools.d.ts:517,521) | Bundled Edit tool is identical; exact-match + curly-quote desanitization internal. | P1 | doc | feb |
| 11.10 | Edit replace_all | ✅ provided | FileEditInput.replace_all (sdk-tools.d.ts:525, 'default false') | Same param on the bundled Edit tool. | P1 | doc | feb |
| 11.11 | Edit preserves encoding/line-endings | ✅ provided | Edit tool (claude_code preset) | Behavior internal to the bundled Edit tool; no SDK config. | P2 | doc | feb |
| 11.12 | NotebookEdit (replace/insert/delete cell) | ✅ provided | NotebookEdit tool (deferred) — NotebookEditInput (sdk-tools.d.ts:646); edit_mode/cell_type/cell_id | Tool is shouldDefer:true — surface it via ToolSearch/allowedTools; schema matches CC exactly. | P1 | doc | feb |
| 11.13 | File checkpointing / rewind | 🔧 configurable | Options.enableFileCheckpointing (sdk.d.ts:70); Query.rewindFiles(userMessageId, {dryRun}) (sdk.d.ts:148) | Set enableFileCheckpointing:true and call Query.rewindFiles() to restore — SDK exposes the rewind contract directly. | P1 | doc | feb |
| 11.14 | UNC-path short-circuit (NTLM leak guard) | ✅ provided | Read/Edit/Write/NotebookEdit tools (claude_code preset) | Security guard internal to the bundled file tools. | P2 | doc | feb |
| 11.15 | Large file-tool result persistence | ✅ provided | Edit/Write/NotebookEdit tools (claude_code preset) | Persistence handled by toolResultStorage inside CC; SDK gets the path-only envelope. | P2 | doc | feb |
| 11.16 | Settings-file edit validation | ✅ provided | Edit tool (claude_code preset) | Internal to the bundled Edit tool when targeting settings files. | P3 | inferred | feb |
| 11.17 | Turn-end file persistence (BYOC/cloud) | ✅ provided | Native SDKFilesPersistedEvent (subtype 'files_persisted', sdk.d.ts) — turn-end file persistence event. | Turn-end file persistence is a native SDK event. | Pnon-goal | doc | post-feb |
| 11.18 | Skill discovery on file access | ✅ provided | Read/Write/Edit tools (claude_code preset) + Options.skills | Triggered inside CC; gate which skills are enabled via Options.skills. | P2 | inferred | feb |
