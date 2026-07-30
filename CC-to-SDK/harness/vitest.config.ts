import { defineConfig } from "vitest/config";
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
    env: { FORCE_COLOR: "3" },
  },
});
