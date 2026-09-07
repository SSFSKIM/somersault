// Structural micro-differential assertion for owned table captures.
//
// Tables need more than Object.is: their contract is their exact key tree,
// primitive leaves, ordered Set members, RegExp values, and the presence of
// callable slots. Function IDENTITY is deliberately not compared because the
// graph and owned modules necessarily construct different functions; behavior
// belongs to a pinned-byte contract test.

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propertyPath(parent, key) {
  return IDENTIFIER.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function render(value) {
  if (typeof value === "function") return "[callable]";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return String(value);
  if (value instanceof Set) return `Set(${JSON.stringify([...value])})`;
  if (value instanceof RegExp) return String(value);
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function firstDifference(graph, owned, path) {
  if (typeof graph === "function" || typeof owned === "function") {
    return typeof graph === "function" && typeof owned === "function"
      ? null
      : { path, graph, owned };
  }

  if (graph instanceof Set || owned instanceof Set) {
    if (!(graph instanceof Set) || !(owned instanceof Set)) {
      return { path, graph, owned };
    }
    const graphMembers = [...graph];
    const ownedMembers = [...owned];
    const length = Math.max(graphMembers.length, ownedMembers.length);
    for (let index = 0; index < length; index++) {
      if (index >= graphMembers.length || index >= ownedMembers.length) {
        return {
          path: `${path}[${index}]`,
          graph: graphMembers[index],
          owned: ownedMembers[index],
        };
      }
      const difference = firstDifference(
        graphMembers[index],
        ownedMembers[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }

  if (graph instanceof RegExp || owned instanceof RegExp) {
    if (!(graph instanceof RegExp) || !(owned instanceof RegExp)) {
      return { path, graph, owned };
    }
    if (graph.source !== owned.source) {
      return {
        path: `${path}.source`,
        graph: graph.source,
        owned: owned.source,
      };
    }
    if (graph.flags !== owned.flags) {
      return { path: `${path}.flags`, graph: graph.flags, owned: owned.flags };
    }
    return null;
  }

  if (Array.isArray(graph) || Array.isArray(owned)) {
    if (!Array.isArray(graph) || !Array.isArray(owned)) {
      return { path, graph, owned };
    }
    const length = Math.max(graph.length, owned.length);
    for (let index = 0; index < length; index++) {
      if (index >= graph.length || index >= owned.length) {
        return {
          path: `${path}[${index}]`,
          graph: graph[index],
          owned: owned[index],
        };
      }
      const difference = firstDifference(
        graph[index],
        owned[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }

  const graphObject = graph !== null && typeof graph === "object";
  const ownedObject = owned !== null && typeof owned === "object";
  if (graphObject || ownedObject) {
    if (!graphObject || !ownedObject) return { path, graph, owned };
    const graphKeys = Object.keys(graph);
    const ownedKeys = Object.keys(owned);
    const length = Math.max(graphKeys.length, ownedKeys.length);
    for (let index = 0; index < length; index++) {
      if (graphKeys[index] !== ownedKeys[index]) {
        const key = graphKeys[index] ?? ownedKeys[index];
        return {
          path: propertyPath(path, key),
          graph: graphKeys[index] === undefined ? undefined : graphKeys[index],
          owned: ownedKeys[index] === undefined ? undefined : ownedKeys[index],
        };
      }
    }
    for (const key of graphKeys) {
      const difference = firstDifference(
        graph[key],
        owned[key],
        propertyPath(path, key),
      );
      if (difference) return difference;
    }
    return null;
  }

  return Object.is(graph, owned) ? null : { path, graph, owned };
}

/**
 * Compare one graph-side table with its independently owned copy.
 *
 * Returns `owned` so an adapter can assert and select its copy in one
 * expression. On drift, the error identifies the adapter, table, and first
 * changed path; callers never have to diff a serialized 30KB table by hand.
 */
export function assertStructuredEqual(splice, table, graph, owned) {
  const difference = firstDifference(graph, owned, table);
  if (!difference) return owned;
  throw new Error(
    `reforge ${splice}: table '${table}' no longer matches the owned structure at ${difference.path}.\n` +
      `  graph: ${render(difference.graph)}\n` +
      `  owned: ${render(difference.owned)}\n` +
      "  Re-verify the table declaration and callable behavior against the pinned bundle before updating the owned copy.",
  );
}
