import { describe, it, expect } from "vitest";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";

describe("tui toolchain", () => {
  it("renders an ink component to a frame string", () => {
    const { lastFrame } = render(<Text>hello-tui</Text>);
    expect(lastFrame()).toContain("hello-tui");
  });
});
