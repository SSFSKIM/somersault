# Parity — 38-output-styles

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 38.1 | Output-style system (default / Explanatory / Learning + custom) | 🔧 configurable | systemPrompt: { type:'preset', preset:'claude_code', append } / settings / settingSources | NOT a direct SDK option — `outputStyle` is a PHANTOM doc field absent from sdk.d.ts v0.3.178. Achieve the same effect by appending the style's prompt fragment via systemPrompt preset-append, or by loading project/user settings (settingSources) that carry outputStyle; built-in style names also surface on system/init and SDKControlInitializeResponse (available_output_styles). | P3 | doc | feb |
| 38.2 | Output-style picker UI + textual-augmentation services | 🏗 build | — | Picker reads getAllOutputStyles() locally and writes settings.outputStyle; data also available via available_output_styles on SDKControlInitializeResponse. Prompt-suggestion overlay maps to SDKPromptSuggestionMessage (promptSuggestions option). The picker chrome is build-only. | P3 | doc | feb |
