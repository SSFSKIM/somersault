// cli/serveMain.ts — `ccx serve`'s implementation: binds the appserver's WebSocket transport (Task 10)
// to a real port, mints or loads its auth token, and records where a client can find both (spec §11).
// Dynamic-imported from main.ts (like the TUI's chatMain) so no headless `ccx` invocation ever loads the
// WebSocket stack. Not unit-tested directly (real fs/network/SIGINT) — Task 10's suite covers listenWs,
// this file's own parse-level policy is covered pure in test/unit/cli/serveArgs.test.ts, and the live
// end-to-end path is Task 13's.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppServer } from "../appserver/server.js";
import { listenWs } from "../appserver/transport/ws.js";
import { runDir } from "../fleet/paths.js";
import type { CcxInvocation } from "./args.js";

/** Reuses an existing token file verbatim (the operator's own stable secret — the point of pinning one
 *  for a non-localhost bind that must survive restarts); otherwise mints a fresh 32-hex token and writes
 *  it 0o600. Either way the run-file (below) only ever records the PATH, never the token itself. */
function loadOrMintToken(path: string | undefined, dir: string): { token: string; tokenFile: string } {
  const tokenFile = path ?? join(dir, "appserver.token");
  if (existsSync(tokenFile)) return { token: readFileSync(tokenFile, "utf8").trim(), tokenFile };
  const token = randomBytes(16).toString("hex"); // 16 bytes -> 32 hex chars
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, token, { mode: 0o600 });
  return { token, tokenFile };
}

/** Runs until SIGINT closes the listener, then resolves — main.ts awaits this for the whole `serve`
 *  command's lifetime (the process's ordinary Ctrl-C exit, not a crash path). */
export async function runServe(inv: CcxInvocation): Promise<void> {
  const dir = runDir();
  mkdirSync(dir, { recursive: true });
  const { token, tokenFile } = loadOrMintToken(inv.tokenFile, dir);
  const server = new AppServer({ token });
  const { port, close } = await listenWs(server, { host: inv.listen.host, port: inv.listen.port, allowOrigins: inv.allowOrigins, token });
  console.log(`appserver listening ws://${inv.listen.host}:${port}`);
  // Run-file deliberately excludes the token itself (global constraint) — a reader gets `tokenFile` and
  // must have filesystem access to that separate, narrower-permissioned (0o600) file to learn the secret.
  writeFileSync(join(dir, "appserver.json"), JSON.stringify({ port, tokenFile }), { mode: 0o600 });
  await new Promise<void>((resolve) => { process.once("SIGINT", () => { void close().then(resolve); }); });
}
