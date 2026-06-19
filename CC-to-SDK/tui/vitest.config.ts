import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  // fileParallelism:false — run test files SEQUENTIALLY. The ink `useInput`-driven app tests
  // (chat/app/useChat/components) subscribe in a passive effect and `waitFor` rendered state on a
  // 2 s budget; run in parallel workers, several ink-heavy files contend for CPU and starve each
  // other's event loops, so a render that normally lands in ~300 ms can exceed 2 s and time out
  // (the recurring useInput-timing flake). Sequential execution gives each test an uncontended core.
  test: { environment: "node", include: ["test/**/*.test.ts", "test/**/*.test.tsx"], fileParallelism: false },
});
