// Phase 3.3 — test-only mock factories for AE Application + items.
//
// Used by per-tool handler.test.ts files. Phase 5 (30 tools) reuses the
// same factory shape — extend fields here, not per-tool. Production jsx
// code never imports this (only tests do; bolt-cep build excludes via
// the shared *.test.ts pattern).

import type { JsxAppLike, JsxCompItem, JsxItemLike } from "./_define";

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

export interface MockAppOpts {
  /** activeItem default = null (no comp selected). Pass `makeMockComp()`
   *  for happy path or `makeMockNonCompItem("Folder")` for negative path. */
  activeItem?: JsxItemLike | null;
}

export function makeMockApp(opts?: MockAppOpts): JsxAppLike {
  var o = opts || {};
  return {
    project: {
      activeItem: o.activeItem !== undefined ? o.activeItem : null,
    },
  };
}
