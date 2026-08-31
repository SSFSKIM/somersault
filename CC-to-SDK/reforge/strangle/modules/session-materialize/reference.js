// PARITY LAYER (§2.5 `reference`) — the transcript store's session-file
// materializer (2.1.251, chunk-fy12d89p): the step that turns a session's
// buffered entries into the on-disk transcript, then announces it.
//
// W0a's mechanism spike for the CLASS-METHOD target shape. A class method's body
// is written against its receiver, so the delegation passes `this` as the first
// argument. (The engine's Bash executor — the census's suggested class — keeps
// its whole state in PRIVATE fields, which are unreachable from outside the
// class body; such a method needs a declared accessor adapter rather than this
// transform. Noted for W10.)
//
// C4's retrofit owns the three pure error predicates the body used to call on
// the graph. What still crosses the adapter are typed ports:
//
//   transcripts   the store instance — the largest port here, whose far side is
//                 W9's `SessionPort`. The members this body touches are its
//                 contract:
//                   shouldSkipPersistence()            -> boolean
//                   ensureCurrentSessionFile()         creates/returns the session file path
//                   reAppendSessionMetadataAsync(relocated, force, storageV5) -> Promise
//                   pendingEntries                     [{ entry, storageV5 }] buffered pre-file
//                   appendEntry(entry, sessionId, foreign, storageV5) -> Promise
//                   currentSessionRelocatedCwd         truthy when the cwd moved mid-session
//                   sessionFile                        current path, for the health record
//                   store.writerHealth / store.sessionFileMaterialized
//   logLine(text, opts)                       structured log
//   reportError(err)                          defect reporting
//   recordWriterHealth(health, stage, err, file)
//
// Contract detail: the emit half runs even when the write half threw — the two
// try blocks are sequential, not nested.

/** Upstream `E` (chunk-qr1avfxy.js): the short code carried by a node fs error. */
export function errorCode(err) {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") return err.code;
  return undefined;
}

/**
 * Upstream `$o`: is this an EXPECTED failure (a real errno from the filesystem)
 * rather than a defect? Anything without a numeric `errno` is reported, not
 * logged — which is what keeps a programming error from being swallowed as
 * "disk was busy".
 */
export function isExpected(err) {
  return err !== null && typeof err === "object" && "errno" in err && typeof err.errno === "number";
}

/** Upstream `l`: the printable detail for a caught value of any shape. */
export function formatError(err) {
  return err instanceof Error ? err.message : String(err);
}

export async function materializeSessionFile(transcripts, storageV5, logLine, reportError, recordWriterHealth) {
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
}
