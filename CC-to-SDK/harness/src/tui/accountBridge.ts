// harness/src/tui/accountBridge.ts — F10 T-MAINT item 1: the LIVE `accountInfo()` promise, carried
// from the launch that owns the host to the REPL that outlives its banner.
//
// WHY A BRIDGE AND NOT A VALUE. `main.ts` races that promise against ACCOUNT_LABEL_BUDGET_MS (1500) so
// a slow handshake can never cost first paint — correct for the banner, whose billing label is chrome
// and is Static-seeded with no late fill. But the RESULT of that race was also the only thing the
// auto-mode notice ever saw (`hookOpts.initialTokenSource`), and a cold launch that overran the budget
// left it undefined forever: a real subscription user, told for the life of the session that their
// sessions are "slightly more expensive". One `accountInfo()` call, two consumers, two deadlines —
// the banner's, unchanged, and the notice's own (`ACCOUNT_NOTICE_DEADLINE_MS`), which is generous
// because nothing is waiting on it.
//
// THE DEADLINE IS NOT HERE. This object has no timers: the notice's budget is measured from the notice
// effect's own arming instant, which only `useChat` knows. Same division of labour as `promptLatch`
// (read(), no notification) and `NoticeBridge` (queue, no policy).
import type { AccountFacts } from "./banner.js";

export interface AccountBridge {
  /** The launch hands over the LIVE, unraced `host.accountInfo()` promise. Called at most once, by the
   *  process that owns the host (`runForegroundImpl`); `ccx attach` creates no bridge at all. */
  offer(p: Promise<AccountFacts | undefined>): void;
  /** Never rejects and never throws: a rejected offer resolves `undefined`, and so does a read with
   *  nothing offered. The CALLER owns the deadline — this side has no timers. */
  read(): Promise<AccountFacts | undefined>;
}

export function createAccountBridge(): AccountBridge {
  let live: Promise<AccountFacts | undefined> | undefined;
  return {
    // `.catch` attached HERE, not at read time: on a resume launch or an engine with no credentials
    // nobody may ever read this, and an unhandled rejection would take the process's exit code with it.
    offer(p) { live = p.catch(() => undefined); },
    read() { return live ?? Promise.resolve(undefined); },
  };
}
