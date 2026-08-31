// SABOTAGE LAYER (§2.5). It never creates the session file and never flushes the
// buffered entries, so the first query's transcript is not on disk and the
// `resume` scenario cannot find the session it is told to resume.
export async function materializeSessionFile() {}
