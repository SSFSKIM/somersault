// Human byte sizes, owned outright (§2.4 `pure-helper`).
//
// Upstream: a single-export chunk (chunk-n2te6bm7.js, `Ft` at 2.1.251) with no
// I/O and no state. Two reforge-owned formatters reach it — the Read tool's
// result formatter (PDF sizes) and the Bash tool's persisted-output notice — so
// it lives here rather than in either.
//
// Behaviour is unit-exact and the rounding is load-bearing: one decimal place,
// with a trailing ".0" stripped, and the unit chosen by successive division by
// 1024. Below 1 KiB the ORIGINAL byte count is printed with the word "bytes".
export function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")}GB`;
}
