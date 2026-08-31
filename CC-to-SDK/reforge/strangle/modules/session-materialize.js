// reforge-owned reimplementation of the transcript store's session-file
// materializer (2.1.251, chunk-fy12d89p): the step that turns a session's
// buffered entries into the on-disk transcript, then announces it.
//
// W0a mechanism spike for the CLASS-METHOD target shape (campaign spec C1). A
// class method's body is written against its receiver, so the delegation passes
// `this` as the first argument. (The engine's Bash executor — the census's
// suggested class — keeps its whole state in PRIVATE fields, which are
// unreachable from outside the class body; such a method needs a declared
// accessor adapter rather than this transform. Noted for W10.)
//
// `transcripts` is the store instance: an `effectful-port` capture in the §2.4
// sense, and the largest one this splice takes — its far side is W9's
// `SessionPort`. The members this body touches are its contract:
//
//   shouldSkipPersistence()            -> boolean
//   ensureCurrentSessionFile()         creates/returns the session file path
//   reAppendSessionMetadataAsync(relocated, force, storageV5) -> Promise
//   pendingEntries                     [{ entry, storageV5 }] buffered pre-file
//   appendEntry(entry, sessionId, foreign, storageV5) -> Promise
//   currentSessionRelocatedCwd         truthy when the cwd moved mid-session
//   sessionFile                        current path, for the health record
//   store.writerHealth / store.sessionFileMaterialized
//
// The remaining captures are the graph's error plumbing, each an
// `effectful-port` edge:
//   errorCode(err)         -> short code for the log line
//   isExpected(err)        -> boolean: log it, or report it as a defect
//   logLine(text, opts)    structured log
//   formatError(err)       -> printable detail
//   reportError(err)       defect reporting
//   recordWriterHealth(health, stage, err, file)
//
// Contract detail: the emit half runs even when the write half threw — the two
// try blocks are sequential, not nested.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async materializeSessionFile(
    transcripts,
    storageV5,
    errorCode,
    isExpected,
    logLine,
    formatError,
    reportError,
    recordWriterHealth,
  ) {
    if (transcripts.shouldSkipPersistence()) return;

    try {
      transcripts.ensureCurrentSessionFile();
      await transcripts.reAppendSessionMetadataAsync(false, false, storageV5);
      if (transcripts.pendingEntries.length > 0) {
        const buffered = transcripts.pendingEntries;
        transcripts.pendingEntries = [];
        for (const { entry, storageV5: entryStorage } of buffered) {
          await transcripts.appendEntry(entry, undefined, undefined, entryStorage);
        }
        if (transcripts.currentSessionRelocatedCwd) {
          await transcripts.reAppendSessionMetadataAsync(true, false, storageV5);
        }
      }
    } catch (err) {
      const code = errorCode(err);
      if (isExpected(err)) logLine(`Session file materialize failed (${code}): ${formatError(err)}`, { level: "error" });
      else reportError(err);
      recordWriterHealth(transcripts.store.writerHealth, "materialize", err, transcripts.sessionFile);
    }

    try {
      transcripts.store.sessionFileMaterialized.emit();
    } catch (err) {
      if (isExpected(err)) {
        logLine(`Session file materialize listener failed (${errorCode(err)}): ${formatError(err)}`, { level: "error" });
      } else reportError(err);
    }
  },
});
