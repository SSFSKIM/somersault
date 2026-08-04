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
    env: {
      FORCE_COLOR: "3",
      // Safety net, not a substitute for per-file temp roots (t5 review): every fleet-writing test pins its
      // own CCX_FLEET_ROOT or passes an explicit env, so this shared static root stays EMPTY on a clean run —
      // its whole job is to catch the next composer test that pastes a chip without pinning, which would
      // otherwise write into the real ~/.claude/ccx (the t5 footgun). Verified: full suite identical with it.
      CCX_FLEET_ROOT: join(tmpdir(), "ccx-vitest-fleet-backstop"),
    },
  },
});
