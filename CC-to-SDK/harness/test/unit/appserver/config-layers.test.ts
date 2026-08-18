import { describe, it, expect } from "vitest";
import { layerPaths, readLayers, settingsMerge, effectiveView, type ConfigLayer } from "../../../src/appserver/configLayers.js";

const L = (name: ConfigLayer["name"], config?: Record<string, unknown>, disabledReason?: string): ConfigLayer =>
  ({ name, filePath: `/x/${name}.json`, ...(config ? { config } : {}), ...(disabledReason ? { disabledReason } : {}) });

describe("configLayers", () => {
  it("layerPaths: user+managed without cwd; all four with cwd; null managed (win32) omitted", () => {
    expect(layerPaths("/h", "/etc/m.json").map((p) => p.name)).toEqual(["user", "managed"]);
    const all = layerPaths("/h", "/etc/m.json", "/proj");
    expect(all.map((p) => p.name)).toEqual(["user", "project", "local", "managed"]);
    expect(all[0].filePath).toBe("/h/.claude/settings.json");
    expect(all[1].filePath).toBe("/proj/.claude/settings.json");
    expect(all[2].filePath).toBe("/proj/.claude/settings.local.json");
    expect(layerPaths("/h", null, "/proj").map((p) => p.name)).toEqual(["user", "project", "local"]);
  });
  it("settingsMerge: objects deep, scalars source-wins, arrays concat with SameValueZero uniq — parsed objects never dedupe", () => {
    expect(settingsMerge({ a: { x: 1 }, keep: 1 }, { a: { y: 2 } })).toEqual({ a: { x: 1, y: 2 }, keep: 1 });
    expect(settingsMerge({ p: ["A", "B"] }, { p: ["B", "C"] })).toEqual({ p: ["A", "B", "C"] });
    // structurally-equal OBJECT entries both survive (lodash uniq is identity-based; fresh parses never equal)
    expect(settingsMerge({ h: [{ m: "Bash" }] }, { h: [{ m: "Bash" }] })).toEqual({ h: [{ m: "Bash" }, { m: "Bash" }] });
    expect(settingsMerge({ m: "user" }, { m: "local" })).toEqual({ m: "local" });
    expect(settingsMerge(["A"], { o: 1 })).toEqual({ o: 1 });
  });
  it("effectiveView: deep merge with leaf origins; arrays name every contributor in order", () => {
    const { config, origins } = effectiveView([
      L("user", { permissions: { allow: ["WebFetch"] }, model: "opus" }),
      L("local", { permissions: { deny: ["Bash"] }, model: "sonnet" }),
    ]);
    expect(config).toEqual({ permissions: { allow: ["WebFetch"], deny: ["Bash"] }, model: "sonnet" });
    expect(origins["permissions.allow"]).toEqual(["user"]);
    expect(origins["permissions.deny"]).toEqual(["local"]);
    expect(origins["model"]).toBe("local");
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
