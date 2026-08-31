// Deliberately WRONG variant — proves the session-materialize splice is live:
// it never creates the session file and never flushes the buffered entries, so
// the first query's transcript is not on disk and the `resume` scenario cannot
// find the session it is told to resume.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async materializeSessionFile() {},
});
