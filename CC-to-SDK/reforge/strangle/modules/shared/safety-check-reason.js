// RE-EXPORT. The implementation moved to `../safety-check-reason/reference.js`
// when C9's fix round showed the function was live and gave it a manifest row of
// its own — every spliced module keeps its one implementation at
// `<name>/reference.js`, which is also where the attestation instrumenter looks.
// This path stays because the owned decision modules import the helper directly
// rather than receiving it as a port, and `shared/` is where they look for it.
export { findSafetyCheckReason } from "../safety-check-reason/reference.js";
