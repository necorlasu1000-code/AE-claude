// Phase 5.2.3 -- unit tests for ae_set_active_comp impl (write, comp
// lane 3/3 -- 5.2 comp lane completion).
//
// Coverage:
//   1. compId happy path: itemByID resolves -> openInViewer called.
//   2. compName happy path: scan finds match -> openInViewer called.
//   3. compId takes precedence when both supplied (compName ignored even
//      when present in items).
//   4. compId unknown -> AENotFoundError (itemByID throws).
//   5. compId resolves to non-Composition (Folder/Footage) -> AENotFoundError.
//   6. compName not in items -> AENotFoundError.
//   7. compName matches a non-Composition item (typeName guard kicks in
//      during scan, candidate skipped) -> AENotFoundError.
//   8. Receiver guard (mistakes #17): direct comp.openInViewer() form
//      passes the mock this-binding check.
//
// destructive: false on the handler -- this impl never invokes
// beginUndoGroup/endUndoGroup, so we don't spy them.

import { describe, it, expect, vi } from "vitest";
import { ae_set_active_comp } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockNonCompItem,
} from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_set_active_comp", () => {
  it("compId: itemByID resolves -> openInViewer called", () => {
    const onOpenInViewer = vi.fn();
    const comp = makeMockComp({ id: 42, name: "Hero", onOpenInViewer });
    const ctx = {
      app: makeMockApp({ items: [comp] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compId: 42 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ id: 42, name: "Hero" });
    expect(onOpenInViewer).toHaveBeenCalledTimes(1);
  });

  it("compName: scan finds match -> openInViewer called", () => {
    const onOpenInViewer = vi.fn();
    const compA = makeMockComp({ id: 10, name: "Other" });
    const compB = makeMockComp({ id: 20, name: "TargetComp", onOpenInViewer });
    const ctx = {
      app: makeMockApp({ items: [compA, compB] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compName: "TargetComp" }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ id: 20, name: "TargetComp" });
    expect(onOpenInViewer).toHaveBeenCalledTimes(1);
  });

  it("compId takes precedence when both supplied", () => {
    const onOpenA = vi.fn();
    const onOpenB = vi.fn();
    const compA = makeMockComp({ id: 100, name: "A", onOpenInViewer: onOpenA });
    const compB = makeMockComp({ id: 200, name: "B", onOpenInViewer: onOpenB });
    const ctx = {
      app: makeMockApp({ items: [compA, compB] }),
    };
    // compId=100 should win even though compName="B" exists.
    const parsed = JSON.parse(
      ae_set_active_comp(
        JSON.stringify({ compId: 100, compName: "B" }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ id: 100, name: "A" });
    expect(onOpenA).toHaveBeenCalledTimes(1);
    expect(onOpenB).not.toHaveBeenCalled();
  });

  it("compId unknown -> AENotFoundError", () => {
    const comp = makeMockComp({ id: 42, name: "Hero", onOpenInViewer: vi.fn() });
    const ctx = {
      app: makeMockApp({ items: [comp] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compId: 999 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toContain("999");
  });

  it("compId resolves to non-Composition -> AENotFoundError", () => {
    const folder = makeMockNonCompItem("Folder", { id: 7, name: "Assets" });
    const ctx = {
      app: makeMockApp({ items: [folder] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compId: 7 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.developerHint).toContain("non-Composition");
  });

  it("compName not in items -> AENotFoundError", () => {
    const compA = makeMockComp({ id: 10, name: "Other" });
    const ctx = {
      app: makeMockApp({ items: [compA] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compName: "Missing" }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toContain("Missing");
  });

  it("compName matches a non-Composition item -> AENotFoundError (typeName guard)", () => {
    // A Folder named "TargetName" exists; scan skips it because typeName
    // !== "Composition". No comp with that name -> not found.
    const folder = makeMockNonCompItem("Folder", { id: 5, name: "TargetName" });
    const compA = makeMockComp({ id: 11, name: "Different" });
    const ctx = {
      app: makeMockApp({ items: [folder, compA] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compName: "TargetName" }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toContain("TargetName");
  });

  it("receiver guard: direct openInViewer call form passes mock guard", () => {
    // If impl ever rewrote to `var fn = comp.openInViewer; fn()`, the
    // mock's receiver check throws and this test catches it.
    const onOpenInViewer = vi.fn();
    const comp = makeMockComp({ id: 1, name: "RG", onOpenInViewer });
    const ctx = {
      app: makeMockApp({ items: [comp] }),
    };
    const parsed = JSON.parse(
      ae_set_active_comp(JSON.stringify({ compId: 1 }), ctx),
    );
    expect(parsed.ok).toBe(true);
    expect(onOpenInViewer).toHaveBeenCalledTimes(1);
  });
});
