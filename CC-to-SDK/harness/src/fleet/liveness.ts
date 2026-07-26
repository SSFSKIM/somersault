import { execFile } from "node:child_process";
import { connect as netConnect } from "node:net";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

type PsRun = (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeout: number }) => Promise<{ stdout: string }>;

/** MUST be C locale + UTC: the binary compares against `LC_ALL=C TZ=UTC ps -o lstart=`, and a
 *  locale-formatted value silently fails the comparison (this cost us a wrong roadmap finding). */
export async function procStartOf(pid: number, deps: { run: PsRun } = { run: execFileP }): Promise<string | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await deps.run("ps", ["-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" }, timeout: 1000,
    }));
  } catch (e: any) {
    // `ps -p <gone pid>` exits non-zero with no output — that IS the answer. But a `ps` we could not
    // run at all (ENOENT) or one the timeout killed tells us nothing, and answering "gone" there would
    // report every live session as dead. Distinguish, and let the caller fail safe.
    if (typeof e?.code === "number" && !e?.killed) return undefined;
    throw e;
  }
  const s = stdout.trim();
  return s.length ? s : undefined;
}

export async function isPidLive(pid: number, procStart: string | undefined,
  deps: { procStartOf: (p: number) => Promise<string | undefined> } = { procStartOf }): Promise<boolean> {
  if (procStart === undefined) return true;          // matches the binary's gB(): unknown start ⇒ assume live
  try {
    const actual = await deps.procStartOf(pid);
    return actual !== undefined && actual === procStart;
  } catch { return true; }                           // a broken probe must not declare a live session dead
}

const CONNECT_TIMEOUT_MS = 250;                       // the binary uses 250ms
async function realConnect(path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const sock = netConnect({ path });
    const done = (fn: () => void) => { sock.destroy(); fn(); };
    sock.once("connect", () => done(() => resolve("ok")));
    sock.once("error", (e) => done(() => reject(e)));
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => done(() => reject(new Error("timeout"))));
  });
}

export async function socketAnswers(path: string,
  deps: { connect: (p: string) => Promise<string> } = { connect: realConnect }): Promise<boolean> {
  try { await deps.connect(path); return true; }
  catch (e: any) { return e?.code === "EBUSY"; }      // busy ⇒ someone is listening ⇒ alive
}
