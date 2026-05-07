// Phase 3.3 -- test-only mock factories for AE Application + items.
//
// Used by per-tool handler.test.ts files. Phase 5 (30 tools) reuses the
// same factory shape -- extend fields here, not per-tool. Production jsx
// code never imports this (only tests do; bolt-cep build excludes via
// the shared *.test.ts pattern).

import type { JsxAppLike, JsxCompItem, JsxItemLike, JsxProjectLike } from "./_define";

export interface MockCompOpts {
  name?: string;
  id?: number;
  duration?: number;
  frameRate?: number;
  width?: number;
  height?: number;
  numLayers?: number;
}

export function makeMockComp(opts?: MockCompOpts): JsxCompItem {
  var o = opts || {};
  return {
    typeName: "Composition",
    name: o.name !== undefined ? o.name : "MockComp",
    id: o.id !== undefined ? o.id : 1,
    duration: o.duration !== undefined ? o.duration : 5,
    frameRate: o.frameRate !== undefined ? o.frameRate : 30,
    width: o.width !== undefined ? o.width : 1920,
    height: o.height !== undefined ? o.height : 1080,
    numLayers: o.numLayers !== undefined ? o.numLayers : 0,
  };
}

/** Non-comp item (Folder, Footage) for negative path tests. */
export function makeMockNonCompItem(typeName: "Folder" | "Footage", opts?: { name?: string; id?: number }): JsxItemLike {
  var o = opts || {};
  return {
    typeName: typeName,
    name: o.name !== undefined ? o.name : "MockItem",
    id: o.id !== undefined ? o.id : 99,
  };
}

export interface MockProjectOpts {
  activeItem?: JsxItemLike | null;
  /** Phase 5.1.4 — ItemCollection mock. items[0] becomes item(1) (1-based
   *  per ExtendScript convention); numItems = items.length. ae_list_comps
   *  test fixtures pass [] for empty project, [comp] for single comp,
   *  [comp, footage] for filter validation. */
  items?: JsxItemLike[];
}

export function makeMockProject(opts?: MockProjectOpts): JsxProjectLike {
  var o = opts || {};
  var items = o.items || [];
  // Phase 5.1.4 fix (mistakes #17) -- enforce method receiver identity
  // so detached method calls (var fn = project.item; fn(i)) fail at the
  // unit-test layer. Production ExtendScript SpiderMonkey throws
  // "Function global.item() cannot work with this class" on the same
  // pattern; vanilla vitest JS does not enforce, so without this guard
  // the bug rides through unit tests and only surfaces in real AE.
  // Apply the same guard to any future method we add to this mock
  // (currently just project.item; 30-tool growth may add more).
  var project: JsxProjectLike;
  project = {
    activeItem: o.activeItem !== undefined ? o.activeItem : null,
    numItems: items.length,
    item: function (this: unknown, index: number) {
      if (this !== project) {
        throw new Error(
          "Mock this-binding violation: project.item called with wrong " +
          "receiver. ExtendScript SpiderMonkey throws 'Function global." +
          "item() cannot work with this class' on detached calls. " +
          "Use project.item(i) directly, NOT var fn = project.item; fn(i). " +
          "See mistakes.md #17."
        );
      }
      // 1-based; production AE throws on out-of-range. Tests don't
      // exercise out-of-range so we return the array slot unchecked.
      return items[index - 1] as JsxItemLike;
    },
  };
  return project;
}

export interface MockAppOpts {
  /** activeItem default = null (no comp selected). Pass `makeMockComp()`
   *  for happy path or `makeMockNonCompItem("Folder")` for negative path. */
  activeItem?: JsxItemLike | null;
  /** Phase 5.1.4 — see MockProjectOpts.items. */
  items?: JsxItemLike[];
}

export function makeMockApp(opts?: MockAppOpts): JsxAppLike {
  var o = opts || {};
  return {
    project: makeMockProject({
      activeItem: o.activeItem,
      items: o.items,
    }),
  };
}
