// Probe 71 helper — a stand-in for the `claude` CLI subprocess. It exists to REPORT its own fate:
// heartbeats while alive, and records stdin-EOF / SIGTERM / SIGHUP as they arrive. argv: <dir> <tag>.
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const [dir, tag] = process.argv.slice(2);
const ev = (name) => appendFileSync(join(dir, `${tag}.events`), `${name} @${Date.now()}\n`);
writeFileSync(join(dir, `${tag}.pid`), String(process.pid));
ev("start");

process.stdin.resume();
process.stdin.on("end", () => ev("stdin-end"));
process.stdin.on("close", () => ev("stdin-close"));
process.on("SIGTERM", () => { ev("SIGTERM"); process.exit(0); });
process.on("SIGHUP", () => { ev("SIGHUP"); process.exit(0); });
process.on("SIGINT", () => { ev("SIGINT"); process.exit(0); });

// Heartbeat file proves liveness independently of ps.
setInterval(() => { try { writeFileSync(join(dir, `${tag}.beat`), String(Date.now())); } catch {} }, 300);
setTimeout(() => { ev("selftimeout"); process.exit(0); }, 180_000);
