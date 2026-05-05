// @vitest-environment jsdom
// Phase 2.7.1.0 setup verification — confirms jsdom environment is active
// when a test file opts in via the directive above. Other panel tests
// (e.g., launcher.test.ts) stay in the default node environment per
// vitest.config.ts.

import { describe, it, expect } from "vitest";

describe("jsdom environment setup", () => {
  it("document is available", () => {
    expect(typeof document).toBe("object");
    expect(document.createElement).toBeTypeOf("function");
  });

  it("createElement('div') returns an HTMLDivElement", () => {
    const div = document.createElement("div");
    expect(div.tagName).toBe("DIV");
    div.style.width = "100px";
    expect(div.style.width).toBe("100px");
  });

  it("window object exists", () => {
    expect(typeof window).toBe("object");
    expect(window.document).toBe(document);
  });
});
