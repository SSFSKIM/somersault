// Graph adapter installer for C13b's eleven independently owned Bash tables.
//
// Every declarator evaluates the pinned graph initializer once and passes that
// value to one of these structural assertions. The one effectful table port is
// `homeDirectory`: pL's owned callbacks retain the graph's native OS provider.
// Bnn's sed callback instead uses the independently owned read-only classifier.
import { homedir } from "node:os";
import { isSedReadOnly } from "./bash-read-only/reference.js";
import {
  createBashSafetyTableAdapters,
  createBashSafetyTableSabotageAdapters,
} from "./bash-safety-tables/adapter.js";

const dependencies = { homeDirectory: homedir, isSedReadOnly };
const healthy = createBashSafetyTableAdapters(dependencies);
const sabotage = createBashSafetyTableSabotageAdapters(dependencies);

function withHomeDirectory(factory) {
  return (graphValue, graphHomeDirectory) =>
    factory({ ...dependencies, homeDirectory: graphHomeDirectory })
      .assertPathArgumentExtractors(graphValue);
}

const healthyInstalled = {
  ...healthy,
  assertPathArgumentExtractors: withHomeDirectory(
    createBashSafetyTableAdapters,
  ),
};
const sabotageInstalled = {
  ...sabotage,
  assertPathArgumentExtractors: withHomeDirectory(
    createBashSafetyTableSabotageAdapters,
  ),
};

globalThis.__reforge = Object.assign(
  globalThis.__reforge ?? {},
  healthyInstalled,
);

export function installBashSafetyTableSabotage(adapterName) {
  globalThis.__reforge[adapterName] = sabotageInstalled[adapterName];
}
