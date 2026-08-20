import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { tmpdir } from "node:os";
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    testTimeout: 120_000, // live SDK runs are slow
    // fileParallelism:false — run test files SEQUENTIALLY. The ink `useInput`-driven tui tests (chat/components)
    // subscribe in a passive effect and `waitFor` rendered state on a 2s budget; in parallel workers several
    // ink-heavy files contend for CPU and starve each other's event loops (the useInput-timing flake), so this
    // is carried over verbatim from the retiring cc-harness-tui's vitest.config.ts.
    fileParallelism: false,
    // The tui tests assert on the raw inverse-video escape (\x1b[7m) because that IS the selection
    // highlight — there is nothing else in the frame that says which row is picked. Ink strips color
    // when it decides stdout is not color-capable, which is exactly what a piped CI/agent stdout looks
    // like, so those assertions fail for a reason that has nothing to do with the code under test.
    // Pin a color-capable terminal for the suite instead of weakening the assertions.
    // Per-FILE throwaway CCX_FLEET_ROOT (t7). The t5 backstop was one static path shared by the whole run,
    // which was enough while only a couple of tests wrote there; the composer now appends prompt history on
    // every submit and seeds from it at mount, so a shared root couples test files through the filesystem.
    // See the file for the full argument. A file that wants to see its own writes still pins its own root.
    setupFiles: ["./test/setup/fleetRoot.ts"],
    env: {
      FORCE_COLOR: "3",
      // Pin a dark-reporting terminal (F8 Task 9): `auto` now resolves live off COLORFGBG
      // (see src/tui/theme.ts resolveThemeId), so any suite asserting on literal color byte
      // sequences under the default theme would otherwise flip colours on a light-reporting
      // machine or CI runner. Same rationale as FORCE_COLOR above — pin the env, don't weaken
      // the assertions.
      COLORFGBG: "15;0",
      // Still set here as the pre-setup fallback: `setupFiles` runs after the env block is applied, and this
      // guarantees that nothing evaluated in between can reach the real ~/.claude/ccx.
      CCX_FLEET_ROOT: join(tmpdir(), "ccx-vitest-fleet-backstop"),
    },
  },
});
