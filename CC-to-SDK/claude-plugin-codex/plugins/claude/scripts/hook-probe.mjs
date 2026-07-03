import fs from "node:fs"; import os from "node:os"; import path from "node:path";
let input = ""; process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = { argv: process.argv, cwd: process.cwd(), env: Object.keys(process.env).sort(), stdin: (() => { try { return JSON.parse(input); } catch { return input.slice(0, 400); } })() };
  fs.writeFileSync(path.join(os.homedir(), ".codex", "claude-hook-probe.json"), JSON.stringify(out, null, 2));
});
