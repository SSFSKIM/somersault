# Parity — 37b-hooks-catalog

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 37b.1 | Input / key-dispatch / typeahead hooks | 🏗 build | — | Local terminal input plumbing — submits to query() prompt and Query.interrupt(); no SDK render data. Part of the 104-hook rebuild. | P3 | doc | feb |
| 37b.2 | Suggestions / data / session-lifecycle hooks | 🏗 build | — | Data sources: supportedCommands()/Models()/Agents(), listSessions()/getSessionMessages(), SDKCommandsChangedMessage, SDKPromptSuggestionMessage, SDKSessionStateChangedMessage, task system messages. Build-only hooks over the SDK surface. | P3 | doc | feb |
| 37b.3 | Display / animation / terminal-resize hooks | 🏗 build | — | Pure rendering/timing primitives with no SDK dependency. Part of the 104-hook rebuild. | P3 | doc | feb |
| 37b.4 | Swarm / permission / transport hooks | 🏗 build | — | Permission decisions from canUseTool; swarm/diff/notif data from subagent messages, task notifications, SDKNotificationMessage, includeHookEvents (hook_started/progress/response). Build-only. | P3 | doc | feb |
