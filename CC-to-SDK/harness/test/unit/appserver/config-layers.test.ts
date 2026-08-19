import { describe, it, expect } from "vitest";
import { layerPaths, readLayers, settingsMerge, effectiveView, type ConfigLayer } from "../../../src/appserver/configLayers.js";
import type { Dirent } from "node:fs";

const L = (name: ConfigLayer["name"], config?: Record<string, unknown>, disabledReason?: string): ConfigLayer =>
  ({ name, filePath: `/x/${name}.json`, ...(config ? { config } : {}), ...(disabledReason ? { disabledReason } : {}) });
/** A `readdir(…, {withFileTypes:true})` stand-in. `kind` is what the drop-in filter actually asks about,
 *  so the fake answers those three questions and nothing else. */
const ent = (name: string, kind: "file" | "dir" | "link" = "file"): Dirent =>
  ({ name, isFile: () => kind === "file", isSymbolicLink: () => kind === "link", isDirectory: () => kind === "dir" } as Dirent);
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: fake`), { code });

describe("configLayers", () => {
  it("layerPaths: user+managed without cwd; all four with cwd; null managed (win32) omitted", async () => {
    const noDropIns = { readdir: async () => { throw errno("ENOENT"); } };
    // The user layer's parameter is the `.claude` DIRECTORY ITSELF, not the home above it: CLAUDE_CONFIG_DIR
    // replaces that directory outright, so a home-shaped parameter cannot express where a user who exports
    // it keeps settings. `fr-config-root.test.ts` pins who supplies this value in production.
    expect((await layerPaths("/h/.claude", "/etc/m.json", undefined, noDropIns)).map((p) => p.name)).toEqual(["user", "managed"]);
    const all = await layerPaths("/h/.claude", "/etc/m.json", "/proj", noDropIns);
    expect(all.map((p) => p.name)).toEqual(["user", "project", "local", "managed"]);
    expect(all[0].filePath).toBe("/h/.claude/settings.json");
    expect(all[1].filePath).toBe("/proj/.claude/settings.json");
    expect(all[2].filePath).toBe("/proj/.claude/settings.local.json");
    expect((await layerPaths("/elsewhere/cfgdir", "/etc/m.json", undefined, noDropIns))[0].filePath).toBe("/elsewhere/cfgdir/settings.json");
    expect((await layerPaths("/h/.claude", null, "/proj", noDropIns)).map((p) => p.name)).toEqual(["user", "project", "local"]);
  });
  it("layerPaths: managed drop-ins join the managed layer, base file FIRST then *.json sorted", async () => {
    let listed = "";
    const deps = { readdir: async (p: string) => { listed = p; return [ent("20-b.json"), ent("2-b.json"), ent("10-a.json"), ent("link.json", "link"), ent("skip.txt"), ent(".hidden.json"), ent("subdir.json", "dir")]; } };
    const paths = await layerPaths("/h/.claude", "/etc/claude-code/managed-settings.json", undefined, deps);
    expect(listed).toBe("/etc/claude-code/managed-settings.d");
    // Every entry is the MANAGED layer — the drop-ins are that layer's later files, not a fifth precedence
    // step — and the order is the loader's: base, then alphabetical, so `20-b` beats `2-b` beats `10-a`.
    expect(paths.map((p) => `${p.name}:${p.filePath}`)).toEqual([
      "user:/h/.claude/settings.json",
      "managed:/etc/claude-code/managed-settings.json",
      "managed:/etc/claude-code/managed-settings.d/10-a.json",
      "managed:/etc/claude-code/managed-settings.d/2-b.json",
      "managed:/etc/claude-code/managed-settings.d/20-b.json",
      "managed:/etc/claude-code/managed-settings.d/link.json",
    ]);
    // A null managed path (win32) asks for no listing at all — there is no directory to derive.
    let asked = false;
    await layerPaths("/h/.claude", null, undefined, { readdir: async () => { asked = true; return []; } });
    expect(asked).toBe(false);
  });
  it("layerPaths: a MISSING drop-in directory is silence; an UNREADABLE one is a disabled layer", async () => {
    // Both sides matter and they are not the same answer. ENOENT/ENOTDIR is every unmanaged machine, and
    // upstream's loader ignores exactly those two. Anything else is a policy source that EXISTS and could
    // not be read, and reporting that as "no drop-ins" is the absence/unreadability collapse this milestone
    // is not allowed to make twice.
    for (const code of ["ENOENT", "ENOTDIR"])
      expect((await layerPaths("/h/.claude", "/etc/m.json", undefined, { readdir: async () => { throw errno(code); } })).map((p) => p.name)).toEqual(["user", "managed"]);
    const denied = await layerPaths("/h/.claude", "/etc/m.json", undefined, { readdir: async () => { throw errno("EACCES"); } });
    expect(denied.map((p) => p.filePath)).toEqual(["/h/.claude/settings.json", "/etc/m.json", "/etc/managed-settings.d"]);
    expect(denied[2].disabledReason).toMatch(/EACCES/);
    // …and `readLayers` carries that verdict through instead of trying to read a directory as a file.
    const layers = await readLayers(denied, { readFile: async () => { throw errno("ENOENT"); } });
    expect(layers.map((l) => [l.name, l.disabledReason])).toEqual([["managed", denied[2].disabledReason]]);
  });
  it("settingsMerge: objects deep, scalars source-wins, arrays concat with SameValueZero uniq — parsed objects never dedupe", () => {
    expect(settingsMerge({ a: { x: 1 }, keep: 1 }, { a: { y: 2 } })).toEqual({ a: { x: 1, y: 2 }, keep: 1 });
    expect(settingsMerge({ p: ["A", "B"] }, { p: ["B", "C"] })).toEqual({ p: ["A", "B", "C"] });
    // structurally-equal OBJECT entries both survive (lodash uniq is identity-based; fresh parses never equal)
    expect(settingsMerge({ h: [{ m: "Bash" }] }, { h: [{ m: "Bash" }] })).toEqual({ h: [{ m: "Bash" }, { m: "Bash" }] });
    expect(settingsMerge({ m: "user" }, { m: "local" })).toEqual({ m: "local" });
  });
  it("settingsMerge: an OBJECT over an ARRAY keeps the array — upstream's answer, not the obvious one", () => {
    // Measured against real lodash 4.18.1 driven by upstream's own `settingsMergeCustomizer`: lodash walks
    // the source object's keys ONTO the array, so the array survives, an index key patches an element, an
    // index past the end extends with holes, and a non-index key becomes a property JSON never shows. Ours
    // returned the object, so `config/read` served `{"PreToolUse":1}` where the engine holds `["x","y"]`.
    // Asserted through JSON because JSON is what a client of this server actually receives.
    const j = (v: unknown) => JSON.stringify(settingsMerge(...(v as [unknown, unknown])));
    expect(j([{ hooks: ["x", "y"] }, { hooks: { PreToolUse: 1 } }])).toBe('{"hooks":["x","y"]}');
    expect(j([["A"], { o: 1 }])).toBe('["A"]');
    expect(j([{ h: ["x", "y"] }, { h: { 0: "z" } }])).toBe('{"h":["z","y"]}');       // an index key PATCHES
    expect(j([{ h: ["x"] }, { h: { 3: "z" } }])).toBe('{"h":["x",null,null,"z"]}');  // …and can extend it
    expect(j([{ h: ["x"] }, { h: {} }])).toBe('{"h":["x"]}');
    // The REVERSE direction is a plain replacement and always agreed with upstream — one row per side, so a
    // repair that made both directions keep the array would fail here.
    expect(j([{ h: { PreToolUse: 1 } }, { h: ["x", "y"] }])).toBe('{"h":["x","y"]}');
    // A scalar on either side of an array is still a replacement (lodash rows H and I).
    expect(j([{ h: ["x"] }, { h: "s" }])).toBe('{"h":"s"}');
    expect(j([{ h: "s" }, { h: ["x"] }])).toBe('{"h":["x"]}');
  });
  it("settingsMerge / effectiveView: an own __proto__ key is dropped, whatever its value, and no prototype moves", () => {
    // What the ENGINE does with such a file, measured at both steps of its pipeline: zod's object build
    // drops the key for an object value AND for a scalar one (zod 4.4.3, the reference's pin), and lodash's
    // `safeGet` drops it again for object values. So the merged view must not carry it — and, before this,
    // `out[k] = v` on that key invoked Object.prototype's SETTER, which is how `origins` came to name
    // `__proto__.polluted` for a leaf `config` did not carry.
    const objValued = JSON.parse('{"__proto__":{"polluted":"yes"},"model":"m"}');
    const scalarValued = JSON.parse('{"__proto__":"str","model":"m"}');
    for (const src of [objValued, scalarValued]) {           // BOTH value shapes — the setter ignores one and obeys the other
      const merged = settingsMerge({}, src) as Record<string, unknown>;
      expect(JSON.stringify(merged)).toBe('{"model":"m"}');
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    }
    const view = effectiveView([L("user", objValued), L("local", scalarValued)]);
    expect(view.config).toEqual({ model: "m" });
    expect(Object.keys(view.origins)).toEqual(["model"]);     // NOT `__proto__.polluted` — attribution for a leaf that is not there
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // `constructor` and `prototype` are NOT screened: upstream keeps them (lodash only drops `constructor`
    // when its value is a function, which JSON cannot produce) and assigning either shadows harmlessly.
    const kept = settingsMerge({}, JSON.parse('{"constructor":{"x":1},"prototype":2,"model":"m"}')) as Record<string, unknown>;
    expect(JSON.stringify(kept)).toBe('{"constructor":{"x":1},"prototype":2,"model":"m"}');
  });
  it("effectiveView: deep merge with leaf origins; arrays name every contributor in order", () => {
    // `ask` is the half the TITLE is about and the fixture used to be missing: allow and deny each come
    // from ONE layer, so a contributor list collapsed to "the last layer to touch this array" answered
    // identically for both and this row stayed green. Only a key TWO layers contribute to can tell the
    // two apart, and acceptance criterion 1 names exactly that case.
    const { config, origins } = effectiveView([
      L("user", { permissions: { allow: ["WebFetch"], ask: ["Edit"] }, model: "opus" }),
      L("local", { permissions: { deny: ["Bash"], ask: ["Bash(git:*)"] }, model: "sonnet" }),
    ]);
    expect(config).toEqual({ permissions: { allow: ["WebFetch"], deny: ["Bash"], ask: ["Edit", "Bash(git:*)"] }, model: "sonnet" });
    expect(origins["permissions.allow"]).toEqual(["user"]);
    expect(origins["permissions.deny"]).toEqual(["local"]);
    expect(origins["permissions.ask"]).toEqual(["user", "local"]); // BOTH, in precedence order — not just the winner
    expect(origins["model"]).toBe("local");
  });
  it("effectiveView: an object merged over an array is a CONTRIBUTOR to it, not a replacement of it", () => {
    const { config, origins } = effectiveView([
      L("user", { hooks: ["x"] }),
      L("project", { hooks: { 1: "y", PreToolUse: "invisible" } }),
    ]);
    // Through JSON, because JSON is what a client receives: the index key landed, and the named key rides
    // on the array as a property no serialization shows (upstream's shape, kept rather than tidied away).
    expect(JSON.stringify(config)).toBe('{"hooks":["x","y"]}');
    expect(origins["hooks"]).toEqual(["user", "project"]);         // an array path names every layer that merged into it
    expect(origins["hooks.PreToolUse"]).toBeUndefined();           // …and NOT the keys JSON drops, which is the B4 lesson
  });
  it("effectiveView: a REPLACEMENT resets the replaced subtree's contributors", () => {
    const { config, origins } = effectiveView([
      L("user", { thing: { deep: ["A"] } }),   // object subtree from user…
      L("local", { thing: "flat" }),           // …replaced wholesale by a scalar in local
    ]);
    expect(config).toEqual({ thing: "flat" });
    expect(origins["thing"]).toBe("local");
    expect(origins["thing.deep"]).toBeUndefined(); // user's discarded leaf is NOT falsely attributed
  });
  it("effectiveView: an object-over-scalar replacement leaves NO stale origin AT the replaced path", () => {
    const { config, origins } = effectiveView([
      L("user", { a: { b: ["X"] } }),     // object subtree from user…
      L("local", { a: "flat" }),          // …flattened to a scalar by local…
      L("managed", { a: { b: ["Y"] } }),  // …and replaced by an object again in managed
    ]);
    expect(config).toEqual({ a: { b: ["Y"] } });
    expect(origins["a.b"]).toEqual(["managed"]);
    // local's scalar is discarded, so `a` must name no contributor. effectiveView's re-walk cannot drop
    // this entry — its only guard is `v === undefined` and `a` now resolves to a defined OBJECT — so the
    // origins reset inside mergeTracked is the sole thing keeping it out.
    expect(origins["a"]).toBeUndefined();
  });
  it("readLayers: absent omitted; BOM stripped; blank file = empty layer; unparseable = disabledReason with raw retained", async () => {
    const files: Record<string, string> = {
      "/x/user.json": "﻿" + `{"model":"opus"}`, "/x/project.json": "   \n", "/x/local.json": `{not json`,
    };
    const deps = { readFile: async (p: string) => { if (p in files) return files[p]; const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; } };
    const layers = await readLayers([
      { name: "user", filePath: "/x/user.json" }, { name: "project", filePath: "/x/project.json" },
      { name: "local", filePath: "/x/local.json" }, { name: "managed", filePath: "/x/managed.json" },
    ], deps);
    expect(layers.map((l) => l.name)).toEqual(["user", "project", "local"]);
    expect(layers[0].config).toEqual({ model: "opus" });
    expect(layers[1].config).toEqual({});            // blank = empty layer, not disabled
    expect(layers[2].config).toBeUndefined();
    expect(layers[2].disabledReason).toMatch(/JSON/);
    expect(layers[2].raw).toBe(`{not json`);          // raw retained — the CAS token hashes bytes, not parses
  });
});
