import { runProbe, brief } from "./lib/runProbe.ts";
const r = await runProbe("Reply with exactly the word OK and nothing else.", { maxTurns: 2 });
console.log("result.subtype:", r.result?.subtype);
console.log("result.result:", brief(r.result?.result, 120));
console.log("init.tools.count:", r.systemInit?.tools?.length);
console.log("init.model:", r.systemInit?.model);
console.log("init.slash_commands.count:", r.systemInit?.slash_commands?.length);
