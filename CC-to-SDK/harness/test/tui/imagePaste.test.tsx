// test/tui/imagePaste.test.tsx — F9 T-IMAGE Task 3 (I2): the composer-level acceptance for the structural
// carrier. Pure editor/pasteChips/queue/promptHistory coverage (chip mint/delete/orphan-sweep, persistence
// exclusion, the queue round-trip) lives in its own home file — paste-chips.test.ts, queue-composer.test.tsx,
// prompt-history.test.ts — each extended by this same task. What belongs HERE is the WIRING those pieces ride
// through: a real Enter keypress reaching `onSubmit` with the structural object intact (the review-mandated
// cell that must fail against the pre-task flatten), and the Ctrl-V cascade (image / image-failed / text /
// none) driven through the same `readClipboardImage` DI seam `editExternal` already established.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { insertImageChip, initialEditorState, type ComposerSubmission, type EditorState } from "../../src/tui/editor.js";
import { noImageInClipboardText } from "../../src/tui/keys/hints.js";
import type { ClipboardPasteOutcome } from "../../src/tui/clipboardImage.js";

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const frame = (f: () => string | undefined) => f() ?? "";
const CTRL_V = "\x16";

const READY_OUTCOME: ClipboardPasteOutcome = { kind: "image", content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 4, height: 4 } };

describe("the Enter-path structural cell (review-mandated)", () => {
  it("a real Enter keypress on a composer holding one image chip reaches onSubmit with pastedContents intact", async () => {
    // Pre-populate the buffer with a minted image chip exactly as Ctrl-V would have left it — the mint
    // itself is Task 3's other half, covered separately; this cell is ONLY about what Enter does with it.
    const withImage = insertImageChip(initialEditorState(), { kind: "image", content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 4, height: 4 } });
    const editorStateRef = { current: withImage } as React.MutableRefObject<EditorState>;
    const submitted: (ComposerSubmission | string)[] = [];
    const { stdin } = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={(sub) => submitted.push(sub)} cwd="/" commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));                        // let useInput subscribe
    stdin.write("\r");                                                  // a REAL Enter keypress, not applyKey called directly
    await waitFor(() => submitted.length > 0);
    expect(submitted.length).toBe(1);
    // Before I2, `submitTurn` flattened every chip to a string BEFORE `onSubmit` ever saw it — an image
    // entry, unreconstructable from its label, was unreachable past the editor no matter what ChatComposer
    // did with it. This assertion is the one that FAILS against that flatten.
    expect(typeof submitted[0]).not.toBe("string");
    const sub = submitted[0] as ComposerSubmission;
    expect(sub.display).toBe("[Image #1]");
    expect(sub.submitText).toBe("[Image #1]");                          // substituteChips leaves an image label literal
    expect(sub.pastedContents[1]).toEqual({ id: 1, type: "image", content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 4, height: 4 } });
  });

  it("a plain text-only submit is STILL structural, with an empty pastedContents — every existing string-only caller normalizes via `sub.submitText`, byte-identical to the pre-task flatten", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const submitted: (ComposerSubmission | string)[] = [];
    const { stdin } = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={(sub) => submitted.push(sub)} cwd="/" commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hello");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => submitted.length > 0);
    const sub = submitted[0] as ComposerSubmission;
    expect(sub.submitText).toBe("hello");
    expect(sub.pastedContents).toEqual({});
  });
});

describe("the Ctrl-V cascade", () => {
  it("image → a ready chip is minted and lands in pastedContents", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]} readClipboardImage={async () => READY_OUTCOME} columns={() => 120} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(CTRL_V);
    await waitFor(() => frame(lastFrame).includes("[Image #1]"));
    expect(editorStateRef.current.pastedContents[1]).toEqual({ id: 1, type: "image", content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 4, height: 4 } });
  });

  it("image-failed → STILL mints a chip (the turn degrades at build time, never a silent no-op)", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "image-failed", reason: "image could not be reduced to fit the request size limit" })} columns={() => 120} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(CTRL_V);
    await waitFor(() => frame(lastFrame).includes("[Image #1]"));
    expect(editorStateRef.current.pastedContents[1]).toEqual({ id: 1, type: "image-failed", reason: "image could not be reduced to fit the request size limit" });
  });

  it("text → pastes through the ORDINARY paste path (short text inserts literally)", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]} readClipboardImage={async () => ({ kind: "text", text: "hello clipboard" })} columns={() => 120} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(CTRL_V);
    await waitFor(() => frame(lastFrame).includes("hello clipboard"));
    expect(Object.keys(editorStateRef.current.pastedContents)).toEqual([]);   // no chip — the text was short enough to insert
  });

  it("none → toasts canon's copy, naming the live chord", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]} readClipboardImage={async () => ({ kind: "none" })} columns={() => 120} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(CTRL_V);
    await waitFor(() => frame(lastFrame).includes("No image found in clipboard."));
    expect(frame(lastFrame)).toContain("ctrl+v");
    expect(Object.keys(editorStateRef.current.pastedContents)).toEqual([]);
  });

  it("none, under SSH_CONNECTION → the SSH variant, not the ctrl+v hint", async () => {
    const prior = process.env.SSH_CONNECTION;
    process.env.SSH_CONNECTION = "10.0.0.1 52341 22";
    try {
      const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
      const { stdin, lastFrame } = render(
        <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]} readClipboardImage={async () => ({ kind: "none" })} columns={() => 120} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      stdin.write(CTRL_V);
      await waitFor(() => frame(lastFrame).includes("You're SSH'd; try scp?"));
      expect(frame(lastFrame)).not.toContain("ctrl+v");
    } finally {
      if (prior === undefined) delete process.env.SSH_CONNECTION; else process.env.SSH_CONNECTION = prior;
    }
  });
});

describe("noImageInClipboardText — canon L607379 verbatim", () => {
  it("composes the non-SSH sentence with the live chord, lower-case grammar", () => {
    expect(noImageInClipboardText(["ctrl+v"], false, "darwin")).toBe("No image found in clipboard. Use ctrl+v to paste images.");
  });
  it("an unbound chord still completes the sentence honestly", () => {
    expect(noImageInClipboardText([], false, "darwin")).toBe("No image found in clipboard.");
  });
  it("the SSH variant ignores the chord entirely", () => {
    expect(noImageInClipboardText(["ctrl+v"], true, "darwin")).toBe("No image found in clipboard. You're SSH'd; try scp?");
  });
});
