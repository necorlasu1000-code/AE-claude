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
  it("empty project → { items: [], total: 0, hasMore: false, nextOffset: null }", () => {
    const ctx = { app: makeMockApp({ items: [] }) };
    const raw = ae_list_comps("{}", ctx);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      ok: true,
      output: { items: [], total: 0, hasMore: false, nextOffset: null },
    });
  });

  it("single comp → 1 entry with all fields populated + pagination meta", () => {
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
    expect(parsed.output.items).toHaveLength(1);
    expect(parsed.output).toMatchObject({ total: 1, hasMore: false, nextOffset: null });
    expect(parsed.output.items[0]).toEqual({
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

    expect(parsed.output.items).toHaveLength(1);
    expect(parsed.output.total).toBe(1);
    expect(parsed.output.items[0].name).toBe("Main");
    expect(parsed.output.items[0].id).toBe(1);
  });

  it("multiple comps → all returned in project-pane order (1-based iteration)", () => {
    const c1 = makeMockComp({ id: 10, name: "Intro" });
    const c2 = makeMockComp({ id: 11, name: "Body" });
    const c3 = makeMockComp({ id: 12, name: "Outro" });
    const ctx = { app: makeMockApp({ items: [c1, c2, c3] }) };
    const parsed = JSON.parse(ae_list_comps("{}", ctx));

    expect(parsed.output.items).toHaveLength(3);
    expect(parsed.output).toMatchObject({ total: 3, hasMore: false, nextOffset: null });
    expect(parsed.output.items.map((x: { name: string }) => x.name)).toEqual([
      "Intro",
      "Body",
      "Outro",
    ]);
    expect(parsed.output.items.map((x: { id: number }) => x.id)).toEqual([10, 11, 12]);
  });

  // ── Pagination (gate §5) ──────────────────────────────────────────
  it("limit windows the result + reports hasMore + nextOffset", () => {
    const comps = [];
    for (let n = 0; n < 5; n++) comps.push(makeMockComp({ id: n, name: "C" + n }));
    const ctx = { app: makeMockApp({ items: comps }) };

    const page1 = JSON.parse(ae_list_comps(JSON.stringify({ limit: 2, offset: 0 }), ctx));
    expect(page1.output.items.map((x: { id: number }) => x.id)).toEqual([0, 1]);
    expect(page1.output).toMatchObject({ total: 5, hasMore: true, nextOffset: 2 });

    const page2 = JSON.parse(ae_list_comps(JSON.stringify({ limit: 2, offset: 2 }), ctx));
    expect(page2.output.items.map((x: { id: number }) => x.id)).toEqual([2, 3]);
    expect(page2.output).toMatchObject({ total: 5, hasMore: true, nextOffset: 4 });

    const page3 = JSON.parse(ae_list_comps(JSON.stringify({ limit: 2, offset: 4 }), ctx));
    expect(page3.output.items.map((x: { id: number }) => x.id)).toEqual([4]);
    expect(page3.output).toMatchObject({ total: 5, hasMore: false, nextOffset: null });
  });

  it("offset past the end → empty page, total still reported", () => {
    const comps = [makeMockComp({ id: 1, name: "A" }), makeMockComp({ id: 2, name: "B" })];
    const ctx = { app: makeMockApp({ items: comps }) };
    const parsed = JSON.parse(ae_list_comps(JSON.stringify({ offset: 10 }), ctx));
    expect(parsed.output).toMatchObject({ items: [], total: 2, hasMore: false, nextOffset: null });
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
