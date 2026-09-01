// SABOTAGE LAYER (§2.5). The handshake is ANSWERED, and nothing it asked for is
// applied.
//
// Two properties this twin has and the obvious ones do not. It still enqueues a
// well-formed response, so the session proceeds and the gate reads a graded
// verdict rather than a timeout — a twin that simply returned would leave the
// SDK waiting on a promise that never settles, which C9's tightened liveness
// rule accepts as RED but only as a proxy. And it drops the CONFIGURATION rather
// than the payload, which is the half no other splice covers: the appended
// system prompt never reaches the launch options, so the very next request body
// is missing it.
export async function handleInitialize(request, requestId, isReinitialize, outbound) {
  outbound.enqueue({ type: "control_response", response: { subtype: "success", request_id: requestId, response: {} } });
  return {};
}
