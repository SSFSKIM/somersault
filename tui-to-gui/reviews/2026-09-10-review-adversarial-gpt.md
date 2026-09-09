# Adversarial review (GPT gateway agent), 2026-09-10

Recovered from the agent's final message; the agent declined to write a file.

**The map is not ready to drive roadmap decomposition.** Its main weaknesses are a false security finding, an incoherent dependency graph, inflated “cards retired” claims, and product proposals presented as canon defects.

I kept the review read-only. My subagent instructions prohibit writing report files, so I have not created `/Users/new/.claude/jobs/4b30d1a4/tmp/tui-to-gui/review-adversarial.md`. The findings below are ready for the caller to save.

## Top five findings, ranked by decision impact

### 1. High — The mandatory bidi-security fix is already implemented

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:320`, Tier 0 at lines 356–362, and C10 at lines 479–483.

**Evidence:** B-57 alleges that afleet removes control characters but not bidi overrides or zero-width marks. I followed its source citation to `/Users/new/developer/github/afleet/App/Timeline/Rendering/TextSanitiser.swift:3–45`.

The implementation explicitly removes `.format`, `.privateUse`, and default-ignorable scalars. These sets already cover the cited bidi overrides, isolates, zero-width marks, and U+FEFF. Its documentation explains why a scalar-wise union pass reaches the same fixed point without ten iterations: deleting a scalar cannot create another scalar.

Thus the README faithfully propagates a **false card finding** into a mandatory security work item. The notification-specific clamp is a separate claim and is not disproved by this check.

**Fix:** Remove the bidi work from Tier 0 and C10; correct B-57 and its ranking row. Audit the notification path separately rather than coupling it to the nonexistent bidi gap. Preserve the existing sanitizer and HTML escaping.

---

### 2. High — C9 is neither small nor a valid prerequisite for everything, and the graph contradicts its own ownership

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:462–527`.

**Evidence:**

- C9 bundles approximately nine separate systems: routing, result rendering, banners, completion, decisions, composer strips, disclosure persistence, header popovers, and rewind capability. Several are individually M in §7. Calling this child “small” is unsupported.
- C15 depends on “C9’s row and card” at line 521, but C9 owns neither the sidebar row nor the task/agent card. C15 itself owns both.
- C9 accepts “`/tasks` opens something,” while the actual Background panel is assigned to C14. Either C9 builds an unspecified temporary destination, or its acceptance depends on a later child.
- C8 implements third answers and `dialogExpiry`; C12 lists them again. C8 implements interruption and waiting states; C10 lists them again. C9 owns permission route titles/questions; C12 repeats them.
- G-21 explicitly says C6.4 is **already unblocked**, after merged C6.1 and C6.3. The map moves it behind all of C9 without identifying any new necessary dependency.

Relevant evidence cards are in `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/G-fleet-and-agents.md:1297` and `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/F-panel-commands-session.md`, F-09 and its ranking row.

**Fix:** Give each deliverable one owner and each edge a named necessary dependency. Extract shared components inside their first concrete consumer; do not require an omnibus infrastructure child before unrelated UI work. Replace “opens something” with a user-complete acceptance.

---

### 3. High — The numerical case for the cut and its “ten-plus-card seams” is false

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:243–263`, `:283–288`, and `:364–379`.

**Evidence:**

The README says that, among the **201 unbuilt cards**, 42 land in Settings, 41 in decisions, and 62 in the composer, using this to justify grouping by region. Those are **all-status totals**. Filtering the existing `/Users/new/Developer/GitHub/somersault/tui-to-gui/surface-index.md` by `designed`, `routed-only`, and `undesigned` produces:

| Region | Claimed unbuilt | Actual unbuilt in index |
|---|---:|---:|
| Settings | 42 | 36 |
| Decision card | 41 | 16 |
| Composer | 62 | 21 |

The seam claim is also not a count of retired work. The surface registry lists six consumers; disclosure lists three; strip lists four; header popovers list six. More importantly, some listed cards need materially different work.

**Three reusable-system tests:**

1. **Surface registry — real dispatch seam, overstated coverage.**  
   E-30 needs a fast-mode toggle and readback; E-42 needs a frontmatter-backed definitions browser/editor and an owner decision; F-20 needs a transcript preview through the real renderer; G-21 needs the unbuilt Agents panel. A registry can deliver or report a command, but cannot retire these surfaces. F-20’s own dependencies are the timeline renderer and transcript data, not the registry.  
   Evidence: `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/E-panel-commands-settings.md`, E-30/E-42; `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/F-panel-commands-session.md:1395`; `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/G-fleet-and-agents.md:1297`.

2. **Structured result slot — a genuine, well-supported seam, not completed forms.**  
   B-14 explicitly proposes it; B-17 needs thumbnails; B-18/B-40 need diffs. Current `ToolResultForm` contains strings rather than a structured display body. This abstraction is justified. Nevertheless, the lane says “one seam plus twenty small views,” not that the seam retires those views. Live Bash output also has a data-path limitation a rendering slot cannot solve.  
   Evidence: `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/B-transcript-rendering.md:815`, `:988`, `:1231`; `/Users/new/developer/github/afleet/App/Timeline/Rendering/Rows/ToolResultForms.swift`.

3. **Banner queue — two different lifetime systems have been conflated.**  
   A-27 proposes **one persistent strip per active condition**, stacked, leaving only by resolution. Head-requeue, current-item preemption, `fold`, and timers come from A-28’s **one-at-a-time transient toast** system. §4.4 imports those mechanics into the channel-banner seam but does not cite A-28. Applying a single-current-item queue to persistent trust/auth conditions could hide unresolved conditions.  
   Evidence: `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/A-chrome-and-status.md:1361` and `:1433`.

**Fix:** Correct the cross-tabulation. Replace “retires” with separate columns for **shared prerequisite**, **remaining consumer work**, and **actual delivery**. Specify persistent banners and transient toasts as distinct presentations/lifecycles, even if they share message metadata.

---

### 4. High — The audit converts deliberate deviations and owner decisions into mandatory “canon” fixes

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:306`, `:311`, `:316`, `:331–332`, and Tier 0.

**Evidence:**

- **F-12:** `/stop` becomes a Tier-0 naming fix although the card explicitly asks whether its interrupt meaning is deliberate. The existing root specification explicitly defines `/stop` as turn interrupt. This is not an implementation departure from its specification.  
  Sources: `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/F-panel-commands-session.md:883`; `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md:1124–1184`.
- **E-42:** the audit’s “What canon does” column says “a definitions view.” The card says canon removed the wizard and prints a static notice; rebuilding a definitions editor is an explicit owner decision. The README itself acknowledges the removal at lines 606–607.
- **D-57:** the audit attributes “remaining time” to canon. The card explicitly calls a visible relative deadline an `[exceeds]` feature that the terminal does not display.
- **B-17:** “the picture” is listed as something lost from the terminal, though the card establishes that canon draws placeholders, never pixels.
- **B-58:** the card deliberately drops `copyOnSelect` because it conflicts with macOS conventions. The audit lists its absence as lost fidelity.

**Fix:** Separate **implementation defects**, **deliberate divergences**, and **GUI improvements**. Keep `/stop` semantic changes and the agents editor behind their actual owner decisions. Fix false feedback and silence without silently authorizing product changes.

---

### 5. High — Important findings disappear between audit, ranking, and child ownership

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:313`, §§7–8.

**Evidence:**

- E-39, `/memory` displaying only a count, is classified as a live defect. Its lane ranks it **high value / M**, depending on the already-existing Files panel. It disappears from the ranked backlog and has no explicit roadmap owner or acceptance.
- E-30’s cheap broken `/fast` toggle is credited to the registry, but no later child clearly owns delivering that toggle.
- E-42 is likewise credited to the registry; C13 names hooks/plugins/skills viewers, not the agent-definition surface. C15’s Agents panel is **runs**, not definitions.
- G-51, held cross-session messages, is **high value / M** in its lane—“messages park where nobody sees them”—but has no explicit backlog or child assignment.
- Conversely G-37’s **low-value naming cleanup** is mandatory before anything, whereas G-02’s **high-value / S** distinction between failed and finished sessions waits in the large C15 bundle. That ordering does not follow the declared value/cost method.

Sources: ranking sections of `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/E-panel-commands-settings.md:3787–3853` and `/Users/new/Developer/GitHub/somersault/tui-to-gui/surfaces/G-fleet-and-agents.md:3514–3581`.

**Fix:** Add an audit-to-backlog-to-child trace table. Every audited defect needs an owner or an explicit deferral. Count a routing fix separately from the destination it exposes. Explain priority overrides rather than asserting that all rankings follow lane value/cost evidence.

## Additional findings

### 6. Medium — The synthesis makes wire/code claims contradicted by its own evidence

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:328`, `:547–556`.

- “All class R with data on the wire” sweeps in B-23, explicitly **D** for live Bash output, with conditional file-tail workarounds. A structured view does not remove that limitation.
- Rendering the engine’s status vocabulary inside afleet does **not** make afleet legible to other tools. G-47 explicitly says outbound presence is absent and publication was declined under the never-write rule.
- “Where afleet already leads” presents the Agents tab and live thinking-token estimate as shipped capabilities. G-21 says the panel is unbuilt. `/Users/new/developer/github/afleet/App/Timeline/Rendering/Rows/ThinkingDisclosure.swift:29–36` explicitly explains that `system/thinking_tokens` has no model route and the view renders duration instead. B-11 and H contain stale supporting claims; the source contradicts them.

**Fix:** Qualify class/data availability per card, separate inbound from outbound presence, and label designed advantages as designed. Correct stale cards rather than treating their agreement as independent verification.

### 7. Minor — “No selection anywhere” overstates B-58

**Location:** `/Users/new/Developer/GitHub/somersault/tui-to-gui/README.md:332`.

B-58 names four selection-enabled subviews. I confirmed `.textSelection(.enabled)` in `/Users/new/developer/github/afleet/App/Timeline/Rendering/Rows/ThinkingDisclosure.swift:61`. The missing capability is cross-row selection and dedicated copy actions, not all selection.

**Fix:** Use the card’s narrower description.

## Spot-check coverage

I opened more than ten §6-cited cards, including D-45, D-24, D-57, B-44, B-46, B-57, B-58, C-18, E-30, E-42, E-08, E-39, F-12, G-37, B-14, B-17, and G-47.

Direct source follow-through included:

- **D-24:** confirmed the truncated fallback in `/Users/new/developer/github/afleet/App/Decisions/PermissionCardView.swift:36,105–108`, and all four canon strings in `/Users/new/claude-code-bundle/2.1.263/cli.pretty.js:795345–795346`.
- **D-45:** confirmed the raw-payload hash and top-level `approvedHash` lookup in `/Users/new/developer/github/afleet/FleetKit/Sources/FleetSessions/Preconditions/ManagedSettingsReader.swift:12–22`. Its card body is stale, although its ranking row and README contain the correction.
- **D-57:** confirmed nil settings input and the existing environment override in `/Users/new/developer/github/afleet/App/Decisions/DialogCardView.swift:27–57`. “Every card claims five minutes” needs an environment-override qualification.
- **B-44/B-46:** confirmed interruption sentinels and waiting copy in `/Users/new/claude-code-bundle/2.1.263/cli.pretty.js:156656` and `:835189`.
- **B-57/B-58:** source checks refuted the claims described above.

## Strongest alternative cut

**A verified-defects release followed by user-journey slices beats the proposed region-based dependency structure.**

1. **Start and remain safely usable:** managed consent, accurate decision settlement, truthful deadlines, auth/rate-limit visibility, and reporting for dead commands.
2. **Understand and recover a turn:** waiting/interruption states, edit diffs, copy actions, rewind preview and recovery.
3. **Compose and steer:** completion, shell-running feedback, queue inspection and pull-back.
4. **Supervise the fleet:** distinguish failed/finished/waiting, background output, held messages, Activity actions, and the already-unblocked Agents panel.
5. **Inspect and configure the harness:** memory files, MCP authentication, permissions/provenance, and settings write classes.

Each slice should introduce only the shared components its acceptance needs. Keep regions as navigation and design-ownership tags, not universal prerequisite barriers.

This preserves the map’s valuable surface inventory while making each delivery demonstrably useful. A defects-only program would be too narrow as the entire roadmap, but it is the right first release. The proposed C9 barrier delays unrelated high-value work and can finish with abstractions that still do not let a user complete a journey.