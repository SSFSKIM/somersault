import { execFile } from "node:child_process";
import { connect as netConnect } from "node:net";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

type PsRun = (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; timeout: number }) => Promise<{ stdout: string }>;

/** MUST be C locale + UTC: the binary compares against `LC_ALL=C TZ=UTC ps -o lstart=`, and a
 *  locale-formatted value silently fails the comparison (this cost us a wrong roadmap finding). */
export async function procStartOf(pid: number, deps: { run: PsRun } = { run: execFileP }): Promise<string | undefined> {
  try {
    const { stdout } = await deps.run("ps", ["-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" }, timeout: 1000,
    });
    const s = stdout.trim();
    return s.length ? s : undefined;
  } catch { return undefined; }
}

export async function isPidLive(pid: number, procStart: string | undefined,
  deps: { procStartOf: (p: number) => Promise<string | undefined> } = { procStartOf }): Promise<boolean> {
  if (procStart === undefined) return true;          // matches the binary's gB(): unknown start ⇒ assume live
  const actual = await deps.procStartOf(pid);
  return actual !== undefined && actual === procStart;
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
