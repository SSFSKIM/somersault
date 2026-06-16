// Canonical 43 area slugs (spec filenames without .md) + cluster grouping.
export const AREAS = [
  "00-overview","01-entrypoint-bootstrap","02-settings-schemas-migrations",
  "03-query-engine","04-turn-pipeline","05-context-assembly","06-cost-token-tracking",
  "07-context-compaction","08-tool-base-registry","09-permission-system",
  "10-tool-bash","11-tool-files","12-tool-search","13-tool-web","14-tool-agent-team",
  "15-tool-tasks","16-tool-mcp-lsp","17-tool-skill","18-tool-modes","19-tool-misc",
  "20-command-system","21-command-catalog","21a-command-catalog-public",
  "21b-command-catalog-ant","21c-command-catalog-flagged","21d-command-catalog-plugin-and-misc",
  "22-service-api","23-service-mcp","24-service-lsp","25-service-oauth-auth",
  "26-service-analytics-flags","27-service-policy","28-service-plugins","29-service-memory",
  "30-coordinator-multiagent","31-mode-proactive","32-mode-kairos","33-mode-daemon",
  "34-mode-bridge","35-mode-remote-server","36-mode-voice","37-ink-ui-shell",
  "37a-components-catalog","37b-hooks-catalog","37c-ink-primitives-catalog",
  "38-output-styles","39-vim-keybindings","40-persistent-memory",
  "41-session-state-history","42-misc","42a-utils-long-tail",
];

export const CLUSTERS = {
  "c1-boot-settings": ["00-overview","01-entrypoint-bootstrap","02-settings-schemas-migrations"],
  "c2-query-context": ["03-query-engine","04-turn-pipeline","05-context-assembly","06-cost-token-tracking","07-context-compaction"],
  "c3-tools-base-perms": ["08-tool-base-registry","09-permission-system"],
  "c4-core-tools": ["10-tool-bash","11-tool-files","12-tool-search","13-tool-web"],
  "c5-agent-tasks": ["14-tool-agent-team","15-tool-tasks","30-coordinator-multiagent"],
  "c6-mcp-skill-modes-tools": ["16-tool-mcp-lsp","17-tool-skill","18-tool-modes","19-tool-misc"],
  "c7-commands": ["20-command-system","21-command-catalog","21a-command-catalog-public","21b-command-catalog-ant","21c-command-catalog-flagged","21d-command-catalog-plugin-and-misc"],
  "c8-services-core": ["22-service-api","23-service-mcp","24-service-lsp","25-service-oauth-auth"],
  "c9-services-ext": ["26-service-analytics-flags","27-service-policy","28-service-plugins","29-service-memory"],
  "c10-modes": ["31-mode-proactive","32-mode-kairos","33-mode-daemon","34-mode-bridge","35-mode-remote-server","36-mode-voice"],
  "c11-ui-shell": ["37-ink-ui-shell","37a-components-catalog","37b-hooks-catalog","37c-ink-primitives-catalog","38-output-styles","39-vim-keybindings"],
  "c12-persistence-misc": ["40-persistent-memory","41-session-state-history","42-misc","42a-utils-long-tail"],
};
