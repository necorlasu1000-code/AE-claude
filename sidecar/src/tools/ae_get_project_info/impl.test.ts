// Phase 5.2.1 -- unit tests for ae_get_project_info impl.
//
// 6 cases covering: saved happy path, unsaved (file null), defensive
// defaults (older fixtures), enum branches (extendscript vs
// javascript-1.0), bitsPerChannel variations (8/16/32), hostVersion.

import { describe, it, expect } from "vitest";
import { ae_get_project_info } from "./impl";
import { makeMockApp } from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_get_project_info", () => {
  it("saved project -> file { path, name } populated + all fields surfaced", () => {
    const ctx = {
      app: makeMockApp({
        version: "22.6.0",
        file: { fsName: "C:\\Users\\me\\Projects\\Hero.aep", name: "Hero.aep" },
        bitsPerChannel: 16,
        expressionEngine: "javascript-1.0",
        displayStartFrame: 0,
      }),
    };
    const parsed = JSON.parse(ae_get_project_info(JSON.stringify({}), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({
      file: { path: "C:\\Users\\me\\Projects\\Hero.aep", name: "Hero.aep" },
      numItems: 0,                      // no items[] passed -> 0
      bitsPerChannel: 16,
      expressionEngine: "javascript-1.0",
      displayStartFrame: 0,
      hostVersion: "22.6.0",
    });
  });

  it("unsaved project (file === null) -> file: null, other fields normal", () => {
    const ctx = {
      app: makeMockApp({
        version: "22.0.0",
        file: null,                     // explicit unsaved
        bitsPerChannel: 8,
        expressionEngine: "extendscript",
        displayStartFrame: 1,
      }),
    };
    const parsed = JSON.parse(ae_get_project_info(JSON.stringify({}), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.file).toBeNull();
    expect(parsed.output.expressionEngine).toBe("extendscript");
    expect(parsed.output.bitsPerChannel).toBe(8);
    expect(parsed.output.displayStartFrame).toBe(1);
    expect(parsed.output.hostVersion).toBe("22.0.0");
  });

  it("defensive defaults when older fixture omits Phase 5.2.1 fields", () => {
    // makeMockApp() with no 5.2.1 fields -> impl.ts defaults fire:
    //   numItems = 0 / bitsPerChannel = 8 / expressionEngine = "javascript-1.0"
    //   / displayStartFrame = 0 / hostVersion = "" / file = null (omitted)
    const ctx = { app: makeMockApp({}) };
    const parsed = JSON.parse(ae_get_project_info(JSON.stringify({}), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({
      file: null,
      numItems: 0,
      bitsPerChannel: 8,
      expressionEngine: "javascript-1.0",
      displayStartFrame: 0,
      hostVersion: "",
    });
  });

  it("expressionEngine 'extendscript' branch passes through unchanged", () => {
    const ctx = {
      app: makeMockApp({ expressionEngine: "extendscript" }),
    };
    const parsed = JSON.parse(ae_get_project_info(JSON.stringify({}), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.expressionEngine).toBe("extendscript");
  });

  it("32-bit color depth + non-zero displayStartFrame", () => {
    const ctx = {
      app: makeMockApp({
        bitsPerChannel: 32,
        displayStartFrame: 1000,
      }),
    };
    const parsed = JSON.parse(ae_get_project_info(JSON.stringify({}), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.bitsPerChannel).toBe(32);
    expect(parsed.output.displayStartFrame).toBe(1000);
  });

  it("file with korean filename -> fsName/name pass through unchanged", () => {
    // jsx layer is ASCII-only (Gate §12) but USER DATA flowing through
    // (file paths, layer names, expressions) is not constrained.
    // Production AE returns korean filenames unchanged via File.name.
    const ctx = {
      app: makeMockApp({
        file: { fsName: "D:\\작업\\프로젝트.aep", name: "프로젝트.aep" },
      }),
    };
    const parsed = JSON.parse(ae_get_project_info(JSON.stringify({}), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.file).toEqual({
      path: "D:\\작업\\프로젝트.aep",
      name: "프로젝트.aep",
    });
  });
});
