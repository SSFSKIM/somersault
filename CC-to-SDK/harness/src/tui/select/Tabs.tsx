// tui/select/Tabs.tsx — the tab shell (F6 T2 chip strip; T-MENU task 1 adds the pane half): canon `Pg`
// (L122645, the shell), `pnt` (L122703, the chip) and `Zi` (L122728, the pane) in one module. The chip
// styling and the `tab`/`shift+tab`/`←`/`→` cycling are transcribed unchanged from 2.1.220's `Jx`/`awr` — this
// task retires the old header comment recording the pane half as a deliberate skip, since it is what follows.
//
// TWO CALLING CONVENTIONS, not one replacing the other:
//   · EXPLICIT (unchanged): `<Tabs tabs={...} active={...} onChange={...} />` — a caller supplies the tab
//     list and switches its own body on the active id. Every dialog not yet migrated onto the shell keeps
//     using this, byte-identical to before this task.
//   · SHELL (new, canon `Pg`): `<Tabs defaultTab="…">` or `<Tabs selectedTab={…} onTabChange={…}>` wrapping
//     `<Tab title id?>` children — the tab list is DERIVED from the children (`id ?? title`, canon's own
//     rule) and the matching child's content renders below the strip, so a migrated dialog deletes its own
//     TABS/TAB_SPECS array and body switch (D2-bl10's whole point) instead of wrapping it.
// A caller supplying BOTH `tabs` and `<Tab>` children gets the children's derived list — the more specific
// instruction wins, and it is the one that also has a pane to show.
import React from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";

export interface TabSpec { id: string; title: string }

export interface TabsProps {
  /** Explicit tab list (the EXPLICIT calling convention). Ignored when `children` supplies `<Tab>` elements. */
  tabs?: readonly TabSpec[];
  /** The active tab's id, EXPLICIT-mode controlled (the pre-existing name). An id that is not in `tabs` reads
   *  as the first tab, like `Jx`'s own `-1` guard. */
  active?: string;
  /** EXPLICIT-mode controlled callback (the pre-existing name). */
  onChange?: (id: string) => void;
  /** SHELL-mode controlled active id (canon `Pg`'s own prop name). */
  selectedTab?: string;
  /** SHELL-mode controlled callback (canon `Pg`'s own prop name). */
  onTabChange?: (id: string) => void;
  /** SHELL-mode UNCONTROLLED initial tab — internal state owns it from here. Only consulted once, the first
   *  time this component mounts with neither `active` nor `selectedTab` supplied. */
  defaultTab?: string;
  /** Upstream's `color` (`IIH`): with one set, the current chip becomes a filled BADGE (`T_`, L422149 —
   *  background `color`, foreground `inverseText`, bold) instead of the inverse chip. Upstream gates that on
   *  its header-focus mode, which we do not ship (see SettingsDialog's recorded divergence), so here it is
   *  simply "a colour was asked for" — and every current caller asks for none, i.e. the inverse chip. */
  color?: ThemeTokenName;
  /** No key handlers registered — the strip renders but does not steer (upstream's `nwr`, folded into that isActive at L435043). */
  disableNavigation?: boolean;
  /** `<Tab>` children (SHELL mode). Present ⇒ the tab list is derived from them and the active one's content
   *  renders below the strip; absent ⇒ EXPLICIT mode, unchanged from before this task. */
  children?: React.ReactNode;
}

export interface TabProps {
  title: string;
  /** Canon `Zi`'s own key (`id ?? title`) — set it when two tabs could share a title, or when the id must
   *  outlive a title rename. */
  id?: string;
  children?: React.ReactNode;
}

/** What `Tab` reads to know whether it is the active pane — published by `Tabs` in SHELL mode only. Absent
 *  (EXPLICIT mode, or a bare `<Tab>` with no `<Tabs>` shell above it) reads as "never active": a pane
 *  primitive nobody is driving must not guess itself visible. */
const ActiveTabContext = React.createContext<string | undefined>(undefined);

/** Canon `Zi`, L122728: renders `children` only when `selectedTab === (id ?? title)`. */
export function Tab({ title, id, children }: TabProps): React.ReactElement | null {
  const active = React.useContext(ActiveTabContext);
  if (active === undefined || active !== (id ?? title)) return null;
  return <>{children}</>;
}

const NO_ACTIONS = {};

/** `<Tab>` children → their derived `TabSpec` list, canon's own `id ?? title` rule. A non-`Tab` child
 *  (whitespace, a caller's stray fragment) is silently skipped — the shell only knows how to chip a `Tab`. */
function tabsFromChildren(children: React.ReactNode): TabSpec[] {
  const specs: TabSpec[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== Tab) return;
    const props = child.props as TabProps;
    specs.push({ id: props.id ?? props.title, title: props.title });
  });
  return specs;
}

export function Tabs({
  tabs: explicitTabs, active: activeProp, onChange, selectedTab, onTabChange, defaultTab,
  color, disableNavigation = false, children,
}: TabsProps) {
  const shell = children !== undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const derivedTabs = React.useMemo(() => (shell ? tabsFromChildren(children) : undefined), [shell, children]);
  const tabs = derivedTabs ?? explicitTabs ?? [];

  // Controlled id: EXPLICIT mode's `active` wins if given (the pre-existing precedent), then SHELL mode's
  // `selectedTab`; neither present ⇒ UNCONTROLLED, seeded once from `defaultTab` (else the first tab).
  const controlledId = activeProp ?? selectedTab;
  const [uncontrolledId, setUncontrolledId] = React.useState<string | undefined>(() => defaultTab ?? tabs[0]?.id);
  const active = controlledId ?? uncontrolledId ?? tabs[0]?.id ?? "";
  const at = Math.max(0, tabs.findIndex((t) => t.id === active));

  const select = (id: string) => {
    onChange?.(id);
    onTabChange?.(id);
    if (controlledId === undefined) setUncontrolledId(id);
  };
  // L435040-435042: cycling is modular over the tab list, in BOTH directions.
  const cycle = (delta: number) => { if (tabs.length > 0) select(tabs[(at + delta + tabs.length) % tabs.length]!.id); };

  useKeyScope("Tabs");
  useKeyActions(disableNavigation ? NO_ACTIONS : { "tabs:next": () => cycle(1), "tabs:previous": () => cycle(-1) });

  const strip = (
    <Box flexDirection="row" gap={1}>
      {tabs.map((t, i) => {
        const current = i === at;
        // `TXp = color && isCurrent && headerFocused` (L435102); `headerFocused` is `KIH && !nwr` at the call
        // site (L435075) and `KIH` is true whenever nothing has opted the header out — which nothing does here.
        return (
          <Box key={t.id} flexShrink={0}>
            {current && color
              ? <Text backgroundColor={resolveThemeColor(themeTokens()[color])} color={resolveThemeColor(themeTokens().inverseText)} bold>{` ${t.title} `}</Text>
              : <Text inverse={current} bold={current}>{` ${t.title} `}</Text>}
          </Box>
        );
      })}
    </Box>
  );

  if (!shell) return strip;
  return (
    <ActiveTabContext.Provider value={active}>
      {strip}
      {children}
    </ActiveTabContext.Provider>
  );
}
