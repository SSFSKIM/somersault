// PARITY LAYER (§2.5 `reference`) — the Bash tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the Bash tool's
// object literal (2.1.251, chunk-fy12d89p). Its anchor is the one non-unique
// anchor in the manifest — the same "<error>Command was aborted…</error>" string
// also appears in the Windows/PowerShell sibling tool — so its row is scoped by
// a co-occurring literal (strangle/anchor.ts).
//
// FIVE pure helpers and THREE primitives are owned here (§2.4): the image-result
// builder with its data-URL parse and magic-byte sniff, the preview splitter,
// the persisted-output notice, the background notice, the task-ack policy
// predicate, and the preview budget / newline / Read-tool-name constants. The
// three constants are still forwarded so the adapter can equality-assert them.
//
// THREE TYPED PORTS cross the adapter, all belonging to the background-task
// subsystem a later wave owns:
//
//   backgroundOutputPath(taskId) -> string
//       reads the live output-path registry, falling back to the session dir.
//   taskAckEnvelope(taskId, text, {backgroundedByUser, ending}) -> string
//       builds the structured task acknowledgement; reaches a gate and the
//       configured Bash timeout.
//   taskAckEnding(endsWithFinalResponse) -> "final_response" | "session" | undefined
//       gate-dependent.
//
// The task-ack branch is DEAD in this build — upstream's own predicate is a
// constant `false` — and it is kept as an owned predicate rather than folded
// away, so the branch stays visible and a future flip is a diff rather than a
// rediscovery.
//
// Corpus coverage, said plainly: the four covering scenarios all render the
// plain stdout path. The image, persisted-output, interrupted and background
// arms are graded by strangle/contracts.test.ts.
import { formatBytes } from "../shared/format-bytes.js";
import { READ_TOOL_NAME } from "../shared/tool-names.js";

/** Upstream `$De`: the persisted-output preview budget, in characters. */
export const PREVIEW_BYTES = 2000;
/** Upstream `kK`: the separator between stderr and the abort marker. */
export const NEWLINE = "\n";
/**
 * Upstream `_t`: the Read tool's name, as it appears in prose. Re-exported from
 * the shared catalog since W2, which owns the same literals for the description
 * functions — one binding rather than two transcriptions (see shared/tool-names.js).
 */
export { READ_TOOL_NAME };

const PERSISTED_OPEN = "<persisted-output>";
const PERSISTED_CLOSE = "</persisted-output>";
const DATA_URL = /^data:([^;]+);base64,(.+)$/;

/** Upstream `iyt`: a bare `data:<type>;base64,<payload>` line, or null. */
function parseDataUrl(text) {
  const m = text.trim().match(DATA_URL);
  if (!m || !m[1] || !m[2]) return null;
  return { mediaType: m[1], data: m[2] };
}

/**
 * Upstream `$v` (chunk-h4c9751g.js): media type from magic bytes.
 * Note this DISCARDS the type the data URL declared — the sniff wins, so a
 * mislabelled payload is either corrected or rejected.
 */
function sniffImageMediaType(b) {
  if (b.length < 4) return null;
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (b.length >= 6 && b[0] === 71 && b[1] === 73 && b[2] === 70 && b[3] === 56 && (b[4] === 55 || b[4] === 57) && b[5] === 97) {
    return "image/gif";
  }
  if (b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 && b.length >= 12 && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80) {
    return "image/webp";
  }
  return null;
}

/** Upstream `y1t`: stdout that is a single image data URL, as an image block. */
export function imageResultBlock(stdout, toolUseId) {
  const parsed = parseDataUrl(stdout);
  if (!parsed) return null;
  const mediaType = sniffImageMediaType(Buffer.from(parsed.data, "base64"));
  if (mediaType === null) return null;
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: parsed.data } }],
  };
}

/**
 * Upstream `Vze` (chunk-9bs8dvhj.js): cut a preview at `limit`, preferring the
 * last newline inside it — but only when that newline is past the halfway mark,
 * so a single very long first line is not collapsed to almost nothing.
 */
export function splitPreview(text, limit) {
  if (text.length <= limit) return { preview: text, hasMore: false };
  const lastNewline = text.slice(0, limit).lastIndexOf("\n");
  const cut = lastNewline > limit * 0.5 ? lastNewline : limit;
  return { preview: text.slice(0, cut), hasMore: true };
}

/**
 * Upstream `rue` (chunk-9bs8dvhj.js): the notice standing in for output that was
 * written to a file instead of inlined. `isJson` is part of the caller's object
 * upstream and is not read here — reproduced, not tidied away.
 */
export function persistedOutputNotice({ filepath, originalSize, preview, hasMore }) {
  let out = `${PERSISTED_OPEN}\n`;
  out += `Output too large (${formatBytes(originalSize)}). Full output saved to: ${filepath}\n\n`;
  out += `Preview (first ${formatBytes(PREVIEW_BYTES)}):\n`;
  out += preview;
  out += hasMore ? `\n...\n` : `\n`;
  out += PERSISTED_CLOSE;
  return out;
}

/** Upstream `b1t`: the prose describing a backgrounded command. Parameters only. */
export function backgroundNotice({
  backgroundTaskId,
  outputPath,
  backgroundedByUser,
  backgroundedToDeliverMessage,
  timedOutAfterMs,
  reapedAtFinalResponse,
  readToolName,
}) {
  const why = backgroundedByUser
    ? `Command was manually backgrounded by user with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}.`
    : backgroundedToDeliverMessage
      ? `Command was moved to the background (ID: ${backgroundTaskId}) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: ${outputPath}.`
      : timedOutAfterMs !== undefined
        ? `Command did not complete within its ${Math.max(1, Math.round(timedOutAfterMs / 1000))}s timeout and was moved to the background (ID: ${backgroundTaskId}). Output is being written to: ${outputPath}.`
        : `Command running in background with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}.`;
  const notification = reapedAtFinalResponse
    ? "If it exits while you are still working you will be notified, but it is terminated when you give your final response and no notification can follow that — so do not end your turn to wait for it; if you need its result, wait for it before giving your final response."
    : backgroundedByUser
      ? undefined
      : "You will be notified when it completes.";
  const howToCheck = backgroundedByUser ? undefined : `To check interim output, use ${readToolName} on that file path.`;
  return [why, notification, howToCheck].filter(Boolean).join(" ");
}

/**
 * Upstream `FE` (chunk-2z83fvw5.js): whether a backgrounded command answers with
 * the structured task acknowledgement instead of the plain notice. A constant
 * `false` in this build, but a POLICY predicate rather than a constant by
 * nature, so it is owned as a predicate and the branch it guards is kept.
 */
export function useTaskAck() {
  return false;
}

export function bashToolResultBlock(output, toolUseId, backgroundOutputPath, taskAckEnvelope, taskAckEnding) {
  const {
    interrupted,
    stdout,
    stderr,
    isImage,
    backgroundTaskId,
    backgroundedByUser,
    backgroundedToDeliverMessage,
    timedOutAfterMs,
    backgroundEndsWithFinalResponse,
    backgroundCwdHint,
    structuredContent,
    persistedOutputPath,
    persistedOutputSize,
    staleReadFileStateHint,
    ghRateLimitHint,
  } = output;

  if (structuredContent && structuredContent.length > 0) {
    return { tool_use_id: toolUseId, type: "tool_result", content: structuredContent };
  }

  if (isImage) {
    const image = imageResultBlock(stdout, toolUseId);
    if (image) {
      const trailing = typeof stderr === "string" ? stderr.trim() : "";
      if (trailing) {
        return {
          ...image,
          content: [...(Array.isArray(image.content) ? image.content : []), { type: "text", text: trailing }],
        };
      }
      return image;
    }
    // A non-image payload falls THROUGH to the text path rather than erroring.
  }

  let out = stdout;
  if (stdout) {
    out = stdout.replace(/^(\s*\n)+/, "");
    out = out.trimEnd();
  }
  if (persistedOutputPath) {
    const split = splitPreview(out, PREVIEW_BYTES);
    out = persistedOutputNotice({
      filepath: persistedOutputPath,
      originalSize: persistedOutputSize ?? 0,
      isJson: false,
      preview: split.preview,
      hasMore: split.hasMore,
    });
  }

  let err = stderr.trim();
  if (interrupted) {
    if (stderr) err += NEWLINE;
    err += "<error>Command was aborted before completion</error>";
  }

  let background = "";
  if (backgroundTaskId) {
    background = backgroundNotice({
      backgroundTaskId,
      outputPath: backgroundOutputPath(backgroundTaskId),
      backgroundedByUser,
      backgroundedToDeliverMessage,
      timedOutAfterMs,
      reapedAtFinalResponse: backgroundEndsWithFinalResponse,
      readToolName: READ_TOOL_NAME,
    });
    if (backgroundCwdHint) background += `\n${backgroundCwdHint}`;
    if (useTaskAck()) {
      return {
        tool_use_id: toolUseId,
        type: "tool_result",
        content: taskAckEnvelope(backgroundTaskId, [err, background].filter(Boolean).join("\n"), {
          backgroundedByUser,
          ending: taskAckEnding(backgroundEndsWithFinalResponse === true),
        }),
      };
    }
  }

  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: [out, err, background, staleReadFileStateHint, ghRateLimitHint].filter(Boolean).join("\n"),
    is_error: interrupted,
  };
}
