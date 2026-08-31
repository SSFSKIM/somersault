// ADAPTER — the graph-facing seam for the session-file materializer.
//
// Delegation signature (class-method shape, so `this` leads):
//   materializeSessionFile(transcripts, storageV5, logLine, reportError, recordWriterHealth)
//
// The three pure error predicates are owned (§2.4 `pure-helper`) and no longer
// forwarded; what remains are the store instance and the graph's log/report
// sinks, all typed ports.
import { materializeSessionFile } from "./session-materialize/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async materializeSessionFile(transcripts, storageV5, logLine, reportError, recordWriterHealth) {
    return materializeSessionFile(transcripts, storageV5, logLine, reportError, recordWriterHealth);
  },
});
