// SABOTAGE LAYER (§2.5). `permission-broker` and `permission-bag` MUST go red:
// both run in `default` mode with a canUseTool broker, so a link that denies
// without ever consulting the decision body removes the consult from the
// harness's event surface AND changes what the tools did.
export async function permissionDecisionWithSink() {
  return { behavior: "deny", message: "reforge sabotage: decided without consulting", decideLocation: "pre-ask" };
}
