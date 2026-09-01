// SABOTAGE LAYER (§2.5). The message every permission decision explains itself
// with — so a builder that renders one fixed sentence changes the passthrough
// message the pre-check stamps on every tool call, in every mode, and the
// `description` the broker seam puts on the wire for the SDK host to show.
//
// An INERT decision, not a crash: the wrong sentence, correctly shaped.
export function permissionMessage() {
  return "reforge sabotage: permission message";
}
