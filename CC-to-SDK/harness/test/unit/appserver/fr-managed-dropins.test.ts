// test/unit/appserver/fr-managed-dropins.test.ts — whole-branch review F5 / verifier cluster 2 (D-M5-23b):
// the managed layer is `managed-settings.json` PLUS `managed-settings.d/*.json`, and a machine whose
// administrator ships policy as drop-in fragments must get the same answers as one that ships a base file.
//
// Driven through the real wire, with the managed root pointed at a temp directory by `managedSettingsPath`.
// NOTHING here goes near `/Library/Application Support/ClaudeCode`: creating that path needs root and would
// take effect on the operator's own Claude Code. So the ENGINE half of this finding rests on the drop-in
// loader read out of the shipped SDK bundle and the reference's `loadManagedFileSettings` — code-derived,
// not observed end to end — and these rows pin OUR half against a control that installs the identical bytes
// the way the domain already handled.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Does `chmod 000` actually deny THIS process a read? Measured, never assumed (root reads regardless). */
const modeDenies = (() => {
  const dir = mkdtempSync(join(tmpdir(), "m5dropperm-"));
  try {
    const probe = join(dir, "sub"); mkdirSync(probe); chmodSync(probe, 0o000);
    try { readFileSync(join(probe, "x"), "utf8"); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === "EACCES"; }
  } finally { chmodSync(join(dir, "sub"), 0o755); rmSync(dir, { recursive: true, force: true }); }
})();

const servers: AppServer[] = [];
let root = "", home = "", managedRoot = "", dropInDir = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "m5drop-"));
  home = join(root, "home"); managedRoot = join(root, "ClaudeCode"); dropInDir = join(managedRoot, "managed-settings.d");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(dropInDir, { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "USER-CHOICE" }));
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.shutdown().catch(() => {});
  chmodSync(dropInDir, 0o755);
  rmSync(root, { recursive: true, force: true });
});

function boot(): (method: string, params: unknown) => Promise<any> {
  const srv = new AppServer({} as never, { configHome: home, managedSettingsPath: join(managedRoot, "managed-settings.json"), ccxDir: join(root, "ccx") });
  servers.push(srv);
  const lines: string[] = [];
  const conn = srv.connect({ write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  let nextId = 100;
  return async (method, params) => {
    const id = nextId++;
    conn.feed(JSON.stringify({ id, method, params }) + "\n");
    for (let i = 0; i < 400; i++) {
      const hit = lines.map((l) => JSON.parse(l)).find((m: any) => m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no reply to ${method}`);
  };
}
const POLICY = { model: "POLICY-PINNED", permissions: { deny: ["Bash"] } };

describe("managed drop-ins are part of the managed layer", () => {
  it("policy shipped as a DROP-IN answers exactly as the same bytes shipped as the base file", async () => {
    // The control is the arrangement the domain already handled, so this row cannot pass by both halves
    // being broken the same way — it compares two REPLIES, not a reply against a literal.
    const ask = async () => {
      const send = boot();
      const rd = await send("config/read", {});
      const wr = await send("config/value/write", { keyPath: ["model"], value: "USER-TRIES-AGAIN", mergeStrategy: "replace" });
      return { config: rd.result.config, origins: rd.result.origins, status: wr.result.status, by: wr.result.overriddenMetadata, masked: wr.result.maskedEditIndexes };
    };
    writeFileSync(join(managedRoot, "managed-settings.json"), JSON.stringify(POLICY));
    const control = await ask();
    rmSync(join(managedRoot, "managed-settings.json"));
    rmSync(join(home, ".claude", "settings.json"));                       // the write above changed it back
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "USER-CHOICE" }));
    writeFileSync(join(dropInDir, "10-policy.json"), JSON.stringify(POLICY));
    const dropIn = await ask();
    expect(dropIn).toEqual(control);
    // …and the answer both give is the one the finding says was wrong: policy in force, the user's write masked.
    expect(dropIn.config).toEqual(POLICY);
    expect(dropIn.origins).toEqual({ model: "managed", "permissions.deny": ["managed"] });
    expect(dropIn.status).toBe("okOverridden");
    expect(dropIn.by.overridingLayer).toBe("managed");
    expect(dropIn.masked).toEqual([0]);
  });
  it("the base file is the BASE: drop-ins merge on top of it, alphabetically, later files winning", async () => {
    writeFileSync(join(managedRoot, "managed-settings.json"), JSON.stringify({ model: "BASE", permissions: { deny: ["Bash"] } }));
    writeFileSync(join(dropInDir, "10-a.json"), JSON.stringify({ model: "TEN" }));
    writeFileSync(join(dropInDir, "20-b.json"), JSON.stringify({ model: "TWENTY", permissions: { deny: ["Write"] } }));
    writeFileSync(join(dropInDir, "2-c.json"), JSON.stringify({ model: "TWO" }));       // sorts BETWEEN them, as a string
    const send = boot();
    const rd = await send("config/read", { includeLayers: true });
    expect(rd.result.config.model).toBe("TWENTY");                                       // last file wins…
    expect(rd.result.config.permissions.deny).toEqual(["Bash", "Write"]);                // …and arrays still concatenate across them
    expect(rd.result.layers.map((l: any) => l.name)).toEqual(["user", "managed", "managed", "managed", "managed"]);
    expect(rd.result.layers.slice(1).map((l: any) => l.filePath.split("/").pop())).toEqual(["managed-settings.json", "10-a.json", "2-c.json", "20-b.json"]);
    // The managed family is not a writable target, so it contributes no CAS token however many files it has.
    expect(Object.keys(rd.result.versions)).toEqual(["user"]);
  });
  it("drop-ins with no base file work alone, and non-JSON, dotfiles and directories are not drop-ins", async () => {
    writeFileSync(join(dropInDir, "10-policy.json"), JSON.stringify({ model: "FROM-DROP-IN" }));
    writeFileSync(join(dropInDir, "notes.txt"), "model: nope");
    writeFileSync(join(dropInDir, ".hidden.json"), JSON.stringify({ model: "HIDDEN" }));
    mkdirSync(join(dropInDir, "subdir.json"));
    const send = boot();
    const rd = await send("config/read", { includeLayers: true });
    expect(rd.result.config.model).toBe("FROM-DROP-IN");
    expect(rd.result.layers.map((l: any) => l.filePath.split("/").pop())).toEqual(["settings.json", "10-policy.json"]);
  });
  it.skipIf(!modeDenies)("a drop-in directory that cannot be LISTED is a disabled layer, not an absence", async () => {
    // The other side of "a missing directory is silence": a policy source that exists and cannot be read is
    // reported. Absence and unreadability are the pair this milestone is not allowed to collapse twice.
    writeFileSync(join(dropInDir, "10-policy.json"), JSON.stringify({ model: "POLICY" }));
    chmodSync(dropInDir, 0o000);
    const send = boot();
    const rd = await send("config/read", { includeLayers: true });
    const dropInLayer = rd.result.layers.find((l: any) => l.filePath.endsWith("managed-settings.d"));
    expect(dropInLayer.name).toBe("managed");
    expect(dropInLayer.disabledReason).toMatch(/could not be read/);
    expect(dropInLayer.config, "a layer that could not be read contributes nothing").toBeUndefined();
    expect(rd.result.config.model, "…and does not silently become the user's value being in force").toBe("USER-CHOICE");
    expect(rd.result.incomplete).toBe(true);
  });
});
