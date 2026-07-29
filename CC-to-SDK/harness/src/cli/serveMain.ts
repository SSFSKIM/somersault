// cli/serveMain.ts — `ccx serve`'s implementation: binds the appserver's WebSocket transport (Task 10)
// to a real port, mints or loads its auth token, and records where a client can find both (spec §11).
// Dynamic-imported from main.ts (like the TUI's chatMain) so no headless `ccx` invocation ever loads the
// WebSocket stack. Not unit-tested directly (real fs/network/SIGINT) — Task 10's suite covers listenWs,
// this file's own parse-level policy is covered pure in test/unit/cli/serveArgs.test.ts, and the live
// end-to-end path is Task 13's.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppServer } from "../appserver/server.js";
import { listenWs } from "../appserver/transport/ws.js";
import { runDir } from "../fleet/paths.js";
import type { CcxInvocation } from "./args.js";

/** Reuses an existing token file verbatim (the operator's own stable secret — the point of pinning one
 *  for a non-localhost bind that must survive restarts); otherwise mints a fresh 32-hex token and writes
 *  it 0o600. Either way the run-file (below) only ever records the PATH, never the token itself.
 *
 *  An existing file that holds no secret is FATAL, never a silent mint and never an empty token: the
 *  `--listen`-non-loopback refusal only checks that the flag was passed, so `touch tok && ccx serve
 *  --listen ws://0.0.0.0:9001 --token-file tok` would otherwise have served a fully open control plane on
 *  every interface — and thread/start forwards a client's whole `config` (cwd, permissionMode, settings,
 *  mcpServers) straight into openSession. Exported for the unit suite (fs-only, no port). */
export function loadOrMintToken(path: string | undefined, dir: string): { token: string; tokenFile: string } {
  const tokenFile = path ?? join(dir, "appserver.token");
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, "utf8").trim();
    if (!token) throw new Error(`token file ${tokenFile} is empty — write a secret to it or delete it to have one minted`);
    return { token, tokenFile };
  }
  const token = randomBytes(16).toString("hex"); // 16 bytes -> 32 hex chars
  mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile, token, { mode: 0o600 });
  return { token, tokenFile };
}

/** Remove the serve run-file. `force` — a missing file is not an error (a crashed previous serve, or
 *  an operator's manual cleanup, must not turn shutdown into a throw). Exported for the unit suite. */
export function removeRunFile(path: string): void { rmSync(path, { force: true }); }

/** The signals that mean "stop serving". SIGINT alone was wrong: a service manager (systemd, launchd), a
 *  container runtime, and a plain `kill` all send SIGTERM, and an unhandled SIGTERM kills the process
 *  outright — server.shutdown() never runs, so parked decisions are never settled and no subscriber ever
 *  gets thread/closed. Both signals route through ONE guarded `stop`: whichever arrives first wins, a
 *  second (or the other) signal is a no-op rather than a second concurrent shutdown, and BOTH listeners
 *  are removed so the surviving one cannot go on suppressing the default kill behavior after we are done.
 *  Exported (with the emitter injected) so the unit suite can drive it without a process or a port. */
export function onStopSignals(stop: () => void, proc: NodeJS.EventEmitter = process): void {
  const once = () => { proc.off("SIGINT", once); proc.off("SIGTERM", once); stop(); };
  proc.on("SIGINT", once);
  proc.on("SIGTERM", once);
}

/** Runs until SIGINT/SIGTERM closes the listener, then resolves — main.ts awaits this for the whole
 *  `serve` command's lifetime (the process's ordinary stop, not a crash path). */
export async function runServe(inv: CcxInvocation): Promise<void> {
  const dir = runDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { token, tokenFile } = loadOrMintToken(inv.tokenFile, dir);
  const server = new AppServer({ token });
  const { port, close } = await listenWs(server, { host: inv.listen.host, port: inv.listen.port, allowOrigins: inv.allowOrigins, token });
  // Hosts are stored unbracketed (args.ts strips IPv6 brackets so the bind and the loopback check agree);
  // a URL needs them back or `ws://::1:9001` is unparseable.
  const shown = inv.listen.host.includes(":") ? `[${inv.listen.host}]` : inv.listen.host;
  console.log(`appserver listening ws://${shown}:${port}`);
  // Run-file deliberately excludes the token itself (global constraint) — a reader gets `tokenFile` and
  // must have filesystem access to that separate, narrower-permissioned (0o600) file to learn the secret.
  const runFile = join(dir, "appserver.json");
  writeFileSync(runFile, JSON.stringify({ port, tokenFile }), { mode: 0o600 });
  // Shut the THREADS down before the listener: closing the socket alone leaves every SDK session and its
  // `claude` child process alive, which also keeps the event loop alive — so a first Ctrl-C on a serve with
  // an open thread might not exit at all (I7).
  await new Promise<void>((resolve) => {
    onStopSignals(() => {
      void (async () => {
        await server.shutdown();
        await close().catch(() => {});
        removeRunFile(runFile); // gap 9: an operator listing the run dir after shutdown must not see a
        // stale entry for a server that is no longer listening.
        resolve();
      })();
    });
  });
}
