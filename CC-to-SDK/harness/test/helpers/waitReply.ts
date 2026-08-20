// test/helpers/waitReply.ts — wait for ONE request's reply frame on a sink's captured lines.
//
// Most appserver handlers, under DI'd deps, finish within a microtask of the request being fed, which is
// why so much of this suite reads a reply after a single `setTimeout(0)`. `thread/list` stopped being one
// of them at M5 Task 10: it reads the archive marker DIRECTORY before it replies, per request and never
// cached (D-M5-3, so another ccx process's archive is visible to the very next list), and that is a real
// filesystem round-trip. A fixed tick then passes or fails on how warm the OS cache happens to be — the
// same file passed alone and failed after a file that had just hammered the disk — and a green that
// depends on that is not evidence of anything. Polling waits for the frame the assertion is about instead
// of for a duration someone guessed.
//
// It throws rather than returning undefined on timeout: an unanswered request must read as "no reply",
// not as a confusing property access on undefined three lines later.
export async function waitReply(lines: string[], id: number, budgetMs = 2_000): Promise<any> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const found = lines.map((l) => JSON.parse(l) as Record<string, any>).find((m) => m.id === id);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no reply to request id ${id} within ${budgetMs}ms`);
    await new Promise((r) => setTimeout(r, 2));
  }
}
