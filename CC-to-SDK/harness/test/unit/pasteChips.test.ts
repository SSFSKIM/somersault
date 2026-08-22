// harness/test/unit/pasteChips.test.ts — F9 T-IMAGE Task 5 (I3b) fix wave: the review's third
// (optional but distinct) finding — `assembleSubmission`'s `image-failed` branch had no test at all
// (only its `type:"image"` ready-path is covered, via useChat.test.tsx's queued-image cell). This file
// pins the failed branch: an `image-failed` entry's chip label is substituted in place with its failure
// text, exactly like `substituteChips` treats a plain text chip, while a READY image entry alongside it
// still becomes a real image block.
import { describe, expect, it } from "vitest";
import { assembleSubmission, imageChipLabel } from "../../src/tui/pasteChips.js";
import type { PastedMap } from "../../src/tui/editor.js";

describe("assembleSubmission — the image-failed branch", () => {
  it("substitutes an image-failed entry's chip label with its failure text, in place, and returns a plain string when no ready images are present", () => {
    const pastedContents: PastedMap = { 1: { id: 1, type: "image-failed", reason: "clipboard image exceeds the paste-time ladder" } };
    const text = `look at this ${imageChipLabel(1)}`;
    const result = assembleSubmission(text, pastedContents);
    expect(result).toBe("look at this [Image could not be processed: clipboard image exceeds the paste-time ladder]");
  });

  it("an image-failed entry alongside a READY image: the failed one degrades to text in place, the ready one still becomes a real image block", () => {
    const pastedContents: PastedMap = {
      1: { id: 1, type: "image-failed", reason: "oversize" },
      2: { id: 2, type: "image", content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 2, height: 2 } },
    };
    const text = `${imageChipLabel(1)} and ${imageChipLabel(2)}`;
    const result = assembleSubmission(text, pastedContents);
    expect(Array.isArray(result)).toBe(true);
    const blocks = result as { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[];
    expect(blocks[0]).toEqual({ type: "text", text: "[Image could not be processed: oversize] and [Image #2]" });
    expect(blocks[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "QkFTRTY0" } });
  });
});
