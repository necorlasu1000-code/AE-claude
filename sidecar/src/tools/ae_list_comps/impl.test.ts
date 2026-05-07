// Phase 5.1.4 — unit tests for ae_list_comps impl.
//
// 4 cases per Phase 5.1.4 spec: empty project / one comp / mixed (filter
// validation) / multiple comps (order preservation).
//
// Mock fixture extends Phase 3.3 _mockApp.ts with items[] support
// (makeMockApp({items}) routes through makeMockProject).

import { describe, it, expect } from "vitest";
import { ae_list_comps } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockNonCompItem,
} from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_list_comps", () => {
  it("empty project → { comps: [] } in {ok:true,output} envelope", () => {
    const ctx = { app: makeMockApp({ items: [] }) };
    const raw = ae_list_comps("{}", ctx);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ ok: true, output: { comps: [] } });
  });

  it("single comp → 1 entry with all fields populated", () => {
    const c = makeMockComp({
      id: 1,
      name: "Main",
      width: 1920,
      height: 1080,
      duration: 5,
      frameRate: 30,
      numLayers: 3,
    });
    const ctx = { app: makeMockApp({ items: [c] }) };
    const parsed = JSON.parse(ae_list_comps("{}", ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.comps).toHaveLength(1);
    expect(parsed.output.comps[0]).toEqual({
      id: 1,
      name: "Main",
      width: 1920,
      height: 1080,
      durationSec: 5,
      frameRate: 30,
      numLayers: 3,
    });
  });

  it("CompItem + FootageItem mixed → CompItem only filtered (typeName check)", () => {
    const c = makeMockComp({ id: 1, name: "Main" });
    const f = makeMockNonCompItem("Footage", { id: 2, name: "input.mp4" });
    const folder = makeMockNonCompItem("Folder", { id: 3, name: "Bin" });
    // Order: footage, comp, folder — comp is in the middle to verify filter
    // doesn't depend on iteration position.
    const ctx = { app: makeMockApp({ items: [f, c, folder] }) };
    const parsed = JSON.parse(ae_list_comps("{}", ctx));

    expect(parsed.output.comps).toHaveLength(1);
    expect(parsed.output.comps[0].name).toBe("Main");
    expect(parsed.output.comps[0].id).toBe(1);
  });

  it("multiple comps → all returned in project-pane order (1-based iteration)", () => {
    const c1 = makeMockComp({ id: 10, name: "Intro" });
    const c2 = makeMockComp({ id: 11, name: "Body" });
    const c3 = makeMockComp({ id: 12, name: "Outro" });
    const ctx = { app: makeMockApp({ items: [c1, c2, c3] }) };
    const parsed = JSON.parse(ae_list_comps("{}", ctx));

    expect(parsed.output.comps).toHaveLength(3);
    expect(parsed.output.comps.map((x: { name: string }) => x.name)).toEqual([
      "Intro",
      "Body",
      "Outro",
    ]);
    expect(parsed.output.comps.map((x: { id: number }) => x.id)).toEqual([10, 11, 12]);
  });

  // Phase 5.1.4 fix (mistakes #17) — this-binding regression guard.
  // Confirms makeMockProject's item() throws when invoked with the wrong
  // receiver (detached call). If a future impl rewrite re-introduces
  // `var fn = project.item; fn(i)`, this test catches it before AE
  // dogfood — no more "Function global.item() cannot work with this
  // class" surprise from production.
  it("this-binding mock guard — detached project.item call throws (mistakes #17 regression case)", () => {
    const c = makeMockComp({ id: 1, name: "Main" });
    const app = makeMockApp({ items: [c] });

    // Sanity: bound call works.
    expect(app.project.item!(1)).toBe(c);

    // Detached: var fn = project.item; fn(1) — receiver = undefined.
    const detached = app.project.item;
    expect(() => detached!(1)).toThrowError(/this-binding violation/i);
  });
});
