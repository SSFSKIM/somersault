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
  },
});
